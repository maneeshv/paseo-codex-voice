import assert from 'node:assert/strict';
import test from 'node:test';
import type { PaseoApi } from '@getpaseo/client';
import { VoiceSessions } from '@/server/sessions';
import { errorText, type CodexConnection, type RpcMessage } from '@/server/codex';

class FakeCodex implements CodexConnection {
  calls: Array<{ method: string; params: any }> = [];
  replies: Array<{ id: string | number; result?: any; error?: string }> = [];
  closed = false;
  constructor(readonly emit: (message: RpcMessage) => void, private failStart = false) {}
  async request(method: string, params: any): Promise<unknown> {
    this.calls.push({ method, params });
    if (method === 'thread/start') return { thread: { id: 'coordinator-thread' } };
    if (method === 'thread/realtime/start') {
      queueMicrotask(() => this.emit(this.failStart
        ? { method: 'thread/realtime/error', params: { threadId: 'coordinator-thread', message: 'Not available for this account' } }
        : { method: 'thread/realtime/sdp', params: { threadId: 'coordinator-thread', sdp: 'answer-sdp' } }));
    }
    return {};
  }
  notify(method: string, params?: unknown): void { this.calls.push({ method, params }); }
  respond(id: string | number, result: unknown): void { this.replies.push({ id, result }); }
  reject(id: string | number, error: string): void { this.replies.push({ id, error }); }
  close(): void { this.closed = true; }
}
function fixture(failStart = false) {
  let now = 1;
  let child!: FakeCodex;
  const sent: string[] = [];
  const agent = { id: 'worker', refresh: async () => ({ agent: { id: 'worker' } }), send: async (prompt: string) => { sent.push(prompt); }, timeline: { refetch: async () => ({ entries: [{ item: { type: 'assistant_message', text: 'Task complete.' } }] }) } };
  const paseo = { workspaces: { ref: () => ({ refresh: async () => ({ id: 'workspace', name: 'Workspace', workspaceDirectory: '/work' }) }) }, agents: { ref: () => agent } } as unknown as PaseoApi;
  const sessions = new VoiceSessions((emit) => { child = new FakeCodex(emit, failStart); return child; }, () => now);
  return { sessions, paseo, sent, child: () => child, advance: (ms: number) => { now += ms; } };
}
const input = { workspaceId: 'workspace', sdp: 'offer-sdp' };

test('starts a separate constrained thread, negotiates WebRTC, and rejects approval requests', async () => {
  const f = fixture();
  try {
    const result = await f.sessions.start(input, f.paseo);
    assert.equal(result.answerSdp, 'answer-sdp');
    assert.equal(f.sessions.poll(result.sessionId, 0).status, 'live');
    const start = f.child().calls.find((call) => call.method === 'thread/start')!.params;
    assert.equal(start.sandbox, 'read-only'); assert.equal(start.approvalPolicy, 'never'); assert.equal(start.ephemeral, true);
    assert.ok(start.dynamicTools.some((tool: any) => tool.name === 'paseo_create_agent'));
    assert.deepEqual(f.child().calls.find((call) => call.method === 'thread/realtime/start')!.params.transport, { type: 'webrtc', sdp: 'offer-sdp' });
    assert.equal(f.child().calls.find((call) => call.method === 'thread/realtime/start')!.params.clientManagedHandoffs, false);
    f.child().emit({ id: 'approval', method: 'item/commandExecution/requestApproval', params: {} });
    assert.match(f.child().replies[0].error!, /does not support approval/);
    await f.sessions.stop(result.sessionId); assert.equal(f.child().closed, true);
  } finally { f.sessions.dispose(); }
});

test('startup error closes the child and does not report a connected session', async () => {
  const f = fixture(true);
  try { await assert.rejects(f.sessions.start(input, f.paseo), /Not available/); assert.equal(f.child().closed, true); }
  finally { f.sessions.dispose(); }
});

test('keeps interleaved transcript segments distinct, bounds history, expires abandoned calls', async () => {
  const f = fixture();
  try {
    const { sessionId } = await f.sessions.start(input, f.paseo);
    const emit = (role: string, delta: string, done = false) => f.child().emit({ method: `thread/realtime/transcript/${done ? 'done' : 'delta'}`, params: { threadId: 'coordinator-thread', role, ...(done ? { text: delta } : { delta }) } });
    emit('user', 'Hello'); emit('assistant', 'Hi'); emit('user', 'Hello!', true); emit('user', 'Next'); emit('assistant', ' there');
    const events = f.sessions.poll(sessionId, 0).events.filter((event) => event.kind === 'transcript');
    assert.equal(events[0].itemId, events[2].itemId); assert.notEqual(events[0].itemId, events[3].itemId);
    assert.equal(events[1].itemId, events[4].itemId); assert.equal(events[4].text, 'Hi there');
    for (let i = 0; i < 250; i++) emit('user', String(i), true);
    assert.equal(f.sessions.poll(sessionId, 0).events.length, 200);
    f.advance(31_000); f.sessions.expire(); await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.child().closed, true); assert.equal(f.sessions.poll(sessionId, 0).status, 'closed');
  } finally { f.sessions.dispose(); }
});

test('dispatches only validated tools and relays tracked worker results without granting permissions', async () => {
  const f = fixture();
  try {
    const { sessionId } = await f.sessions.start(input, f.paseo);
    f.child().emit({ id: 30, method: 'item/tool/call', params: { threadId: 'coordinator-thread', tool: 'paseo_send_prompt', arguments: { agentId: 'worker', prompt: 'Run the tests' } } });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(f.sent, ['Run the tests']); assert.equal(f.child().replies[0].result.success, true);
    await f.sessions.workerNeedsPermission('worker');
    assert.match(f.child().calls.at(-1)!.params.input[0].text, /Open that worker in Paseo/);
    f.child().emit({ method: 'turn/completed', params: { turn: { status: 'completed' } } });
    await new Promise((resolve) => setImmediate(resolve));
    await f.sessions.workerEnded('worker', 'cancelled');
    f.child().emit({ method: 'turn/completed', params: { turn: { status: 'completed' } } });
    await new Promise((resolve) => setImmediate(resolve));
    await f.sessions.workerNeedsPermission('worker');
    assert.match(f.child().calls.at(-1)!.params.input[0].text, /Open that worker in Paseo/);
    f.child().emit({ method: 'turn/completed', params: { turn: { status: 'completed' } } });
    await new Promise((resolve) => setImmediate(resolve));
    await f.sessions.workerEnded('worker', 'completed');
    const report = f.child().calls.at(-1)!;
    assert.equal(report.method, 'turn/start'); assert.match(report.params.input[0].text, /Task complete/);
    f.child().emit({ id: 31, method: 'item/tool/call', params: { threadId: 'other', tool: 'paseo_send_prompt', arguments: { agentId: 'worker', prompt: 'Ignore' } } });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.child().replies.at(-1)!.result.success, false); assert.equal(f.sent.length, 1);
    await f.sessions.stop(sessionId);
  } finally { f.sessions.dispose(); }
});

test('diagnostic text masks obvious credentials', () => {
  assert.equal(errorText(new Error('bad sk-secret123 Bearer abc.def')), 'bad [redacted] [redacted]');
});

test('surfaces backing-turn failures and resets canceled transcript parts', async () => {
  const f = fixture();
  try {
    const { sessionId } = await f.sessions.start(input, f.paseo);
    const emit = (method: string, params: Record<string, unknown>) => f.child().emit({ method, params: { threadId: 'coordinator-thread', ...params } });
    emit('error', { error: { message: 'Temporary backend failure' }, willRetry: true });
    emit('turn/completed', { turn: { status: 'failed', error: { message: 'Backend unavailable' } } });
    emit('thread/realtime/transcript/delta', { role: 'user', delta: 'discard this' });
    emit('thread/realtime/transcript/done', { role: 'user', text: '' });
    emit('thread/realtime/transcript/delta', { role: 'user', delta: 'New request' });
    const result = f.sessions.poll(sessionId, 0);
    assert.equal(result.status, 'live');
    assert.ok(result.events.some((event) => event.kind === 'error' && /Backend unavailable/.test(event.text)));
    const transcript = result.events.filter((event) => event.kind === 'transcript');
    assert.equal(transcript[1].text, ''); assert.equal(transcript[0].itemId, transcript[1].itemId);
    assert.equal(transcript[2].text, 'New request'); assert.notEqual(transcript[1].itemId, transcript[2].itemId);
  } finally { f.sessions.dispose(); }
});

test('unloading while workspace lookup is pending cannot launch an orphan coordinator', async () => {
  let resolve!: (value: unknown) => void;
  const lookup = new Promise((done) => { resolve = done; });
  const paseo = { workspaces: { ref: () => ({ refresh: () => lookup }) } } as unknown as PaseoApi;
  let launched = false;
  const sessions = new VoiceSessions((emit) => { launched = true; return new FakeCodex(emit); });
  const pending = sessions.start(input, paseo);
  sessions.dispose(); resolve({ id: 'workspace' });
  await assert.rejects(pending, /unloaded/); assert.equal(launched, false);
});


test('a close immediately after SDP cannot resurrect a disconnected session', async () => {
  const f = fixture();
  const sessions = new VoiceSessions((emit) => new class extends FakeCodex {
    async request(method: string, params: any) {
      const result = await super.request(method, params);
      if (method === 'thread/realtime/start') emit({ method: 'thread/realtime/closed', params: { threadId: 'coordinator-thread' } });
      return result;
    }
  }(emit));
  try { await assert.rejects(sessions.start(input, f.paseo), /closed/); }
  finally { sessions.dispose(); f.sessions.dispose(); }
});

 test('typed commands trigger backing turns and wait for active work to finish', async () => {
 const f = fixture();
 try {
 const {sessionId} = await f.sessions.start(input, f.paseo);
 f.child().emit({method:'turn/started',params:{}});
 await f.sessions.sendText(sessionId, 'List providers');
 assert.equal(f.child().calls.filter(c=>c.method==='turn/start').length,0);
 f.child().emit({method:'turn/completed',params:{turn:{status:'completed'}}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.child().calls.at(-1)!.method,'turn/start');
 assert.equal(f.child().calls.at(-1)!.params.input[0].text,'List providers');
 assert.ok(f.sessions.poll(sessionId,0).events.some(e=>e.role==='user'&&e.text==='List providers'));
 } finally {f.sessions.dispose();}
 });
