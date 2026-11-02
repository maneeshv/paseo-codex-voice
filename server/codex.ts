import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export type RpcMessage = { id?: number | string; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message?: string } };
export interface CodexConnection {
  request(method: string, params: unknown, timeoutMs?: number): Promise<unknown>;
  notify(method: string, params?: unknown): void;
  respond(id: string | number, result: unknown): void;
  reject(id: string | number, message: string): void;
  close(): void;
}

export function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/(?:sk-[\w-]+|Bearer\s+[\w.\-]+)/gi, '[redacted]')
    .slice(0, 500);
}

/** JSON-RPC over the coordinator's own stdio connection; never borrows Paseo's provider process. */
export class CodexProcess implements CodexConnection {
  private child: ChildProcessWithoutNullStreams;
  private buffer = '';
  private nextId = 1;
  private closed = false;
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();

  constructor(private onMessage: (message: RpcMessage) => void, private onExit: (message: string) => void) {
    this.child = spawn('codex', ['app-server', '--stdio', '--enable', 'realtime_conversation'], { stdio: 'pipe', windowsHide: true, detached: process.platform !== 'win32' });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => this.receive(chunk));
    // Diagnostics can include account or workspace context. They are deliberately not logged.
    this.child.stderr.resume();
    this.child.stdin.on('error', () => this.fail('Codex input connection closed.'));
    this.child.on('error', (error) => this.fail(`Could not start Codex CLI: ${errorText(error)}`));
    this.child.on('exit', (code) => this.fail(`Codex voice process exited (${code ?? 'signal'}).`));
  }

  request(method: string, params: unknown, timeoutMs = 25_000): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('Codex voice connection is closed.'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex ${method} timed out.`)); }, timeoutMs);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, method, params });
    });
  }
  notify(method: string, params?: unknown): void { this.send({ method, ...(params === undefined ? {} : { params }) }); }
  respond(id: string | number, result: unknown): void { this.send({ id, result }); }
  reject(id: string | number, message: string): void { this.send({ id, error: { code: -32601, message } }); }

  private send(message: unknown): void {
    if (!this.closed) this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }
  private receive(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > 8_000_000) { this.fail('Codex sent an oversized protocol message.'); return; }
    let end: number;
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
      if (!line.trim()) continue;
      let message: RpcMessage;
      try { message = JSON.parse(line) as RpcMessage; }
      catch { this.fail('Codex sent an invalid protocol message.'); return; }
      if (!message || typeof message !== 'object' || Array.isArray(message)) { this.fail('Codex sent an invalid protocol message.'); return; }
      if (typeof message.id === 'number' && !message.method) {
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id); clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(errorText(message.error.message ?? 'Codex request failed.')));
        else pending.resolve(message.result);
      } else this.onMessage(message);
    }
  }
  private fail(message: string): void {
    if (this.closed) return;
    this.close(); this.onExit(message);
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Codex voice connection closed.')); }
    this.pending.clear();
    this.child.stdin.end(); this.killOwnedProcess('SIGTERM');
    const kill = setTimeout(() => { if (this.child.exitCode === null) this.killOwnedProcess('SIGKILL'); }, 1500);
    kill.unref();
  }
  private killOwnedProcess(signal: NodeJS.Signals): void {
    try {
      // A private POSIX process group also owns any coordinator MCP subprocesses.
      if (process.platform !== 'win32' && this.child.pid) process.kill(-this.child.pid, signal);
      else this.child.kill(signal);
    } catch { /* The process may have exited before cleanup. */ }
  }
}
