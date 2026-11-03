import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import type { PaseoApi } from '@getpaseo/client';
import type { CodexConnection, RpcMessage } from '@/server/codex';
import { VoiceSessions } from '@/server/sessions';
import { readVoices } from '@/server/voices';
import * as contracts from '@/shared/contracts';

const catalog = { voices: { v1: ['default', 'legacy'], v2: ['not-v3'], v3: ['default', 'selected'], defaultV1: 'default' } };
class Connection implements CodexConnection {
  calls: Array<{ method: string; params: any }> = [];
  closed = false;
  constructor(readonly emit: (message: RpcMessage) => void, readonly exit: (message: string) => void, readonly voices = catalog, readonly initializing?: Promise<void>) {}
  async request(method: string, params: any) {
    this.calls.push({ method, params });
    if (method === 'initialize') await this.initializing;
    if (method === 'thread/realtime/listVoices') return this.voices;
    if (method === 'thread/start') return { thread: { id: 'thread' } };
    if (method === 'thread/realtime/start') queueMicrotask(() => this.emit({ method: 'thread/realtime/sdp', params: { threadId: 'thread', sdp: 'answer' } }));
    return {};
  }
  notify(method: string, params: any) { this.calls.push({ method, params }); }
  respond() {}
  reject() {}
  close() { this.closed = true; }
}
function fixture(initializing?: Promise<void>) {
  let now = 100;
  const children: Connection[] = [];
  const sessions = new VoiceSessions((emit, exit) => {
    const child = new Connection(emit, exit, catalog, initializing);
    children.push(child); return child;
  }, () => now);
  const paseo = { workspaces: { ref: (id: string) => ({ refresh: async () => ({ id, name: 'Directory', title: 'Friendly workspace', workspaceDirectory: '/work' }) }) } } as unknown as PaseoApi;
  return { sessions, paseo, children, advance(ms: number) { now += ms; } };
}
const input = { workspaceId: 'workspace', sdp: 'offer' };

test('voice discovery uses exact V3 choices, falls back to V1, and excludes V2', async () => {
  assert.deepEqual(await readVoices(new Connection(() => {}, () => {})), { voices: ['default', 'selected'], defaultVoice: 'default' });
  const legacy = new Connection(() => {}, () => {}, { voices: { v1: ['default', 'legacy'], v2: ['not-v3'], defaultV1: 'default' } } as typeof catalog);
  assert.deepEqual(await readVoices(legacy), { voices: ['default', 'legacy'], defaultVoice: 'default' });
  const invalid = new Connection(() => {}, () => {}, { voices: { ...catalog.voices, defaultV1: 'missing' } });
  await assert.rejects(readVoices(invalid), /unsupported default voice/);
});

test('catalog discovery shares one temporary process and leaves no active session', async () => {
  const f = fixture();
  try {
    const [first, concurrent] = await Promise.all([f.sessions.voices(), f.sessions.voices()]);
    assert.deepEqual(first, concurrent);
    assert.deepEqual(await f.sessions.voices(), first);
    assert.equal(f.children.length, 1);
    assert.ok(f.children[0].closed);
    assert.deepEqual(f.children[0].calls.map((call) => call.method), ['initialize', 'initialized', 'thread/realtime/listVoices']);
    assert.deepEqual(f.sessions.list(), []);
  } finally { f.sessions.dispose(); }
  await assert.rejects(f.sessions.voices(), /unloaded/);
});

test('selected voice is validated on its session connection and forwarded without choosing a model', async () => {
  const f = fixture();
  try {
    await f.sessions.start(input, f.paseo, 'selected');
    assert.equal(f.children.length, 1);
    assert.equal(f.children[0].calls.filter((call) => call.method === 'thread/realtime/listVoices').length, 1);
    const realtime = f.children[0].calls.find((call) => call.method === 'thread/realtime/start')!.params;
    assert.equal(realtime.voice, 'selected');
    assert.equal(realtime.version, 'v3');
    assert.equal('model' in realtime, false);
    assert.equal('model' in f.children[0].calls.find((call) => call.method === 'thread/start')!.params, false);
    assert.equal(f.sessions.list()[0].voice, 'selected');
    await assert.rejects(f.sessions.start(input, f.paseo, 'not-v3'), /saved voice is not supported/);
    assert.ok(f.children[1].closed);
    assert.equal(f.children[1].calls.some((call) => call.method === 'thread/start'), false);
    assert.equal(f.sessions.list().length, 1);
  } finally { f.sessions.dispose(); }
});

test('Codex default omits the voice override and does not need catalog discovery', async () => {
  const f = fixture();
  try {
    await f.sessions.start(input, f.paseo, '');
    const child = f.children[0];
    assert.equal('voice' in child.calls.find((call) => call.method === 'thread/realtime/start')!.params, false);
    assert.equal(child.calls.some((call) => call.method === 'thread/realtime/listVoices'), false);
    assert.equal(f.sessions.list()[0].voice, undefined);
  } finally { f.sessions.dispose(); }
});

test('active inventory includes connecting metadata and removes independently stopped or disconnected calls', async () => {
  let initialized!: () => void;
  const f = fixture(new Promise((resolve) => { initialized = resolve; }));
  try {
    const pending = f.sessions.start({ ...input, agentId: 'agent' }, f.paseo);
    await Promise.resolve();
    const connecting = f.sessions.list()[0];
    assert.equal(connecting.status, 'connecting');
    assert.equal(connecting.workspaceName, 'Friendly workspace');
    assert.equal(connecting.agentId, 'agent');
    assert.equal(connecting.createdAt, 100);
    initialized();
    const first = await pending;
    const second = await f.sessions.start({ ...input, workspaceId: 'other' }, f.paseo);
    assert.deepEqual(f.sessions.list().map((session) => session.status), ['live', 'live']);
    assert.equal(f.sessions.list()[0].threadId, 'thread');
    await f.sessions.stop(first.sessionId);
    assert.deepEqual(f.sessions.list().map((session) => session.sessionId), [second.sessionId]);
    assert.ok(f.children[0].closed);
    assert.equal(f.children[1].closed, false);
    f.children[1].exit('disconnected');
    assert.deepEqual(f.sessions.list(), []);
    assert.ok(f.children[1].closed);
  } finally { f.sessions.dispose(); }
});

test('inventory reads never renew a call lease and restart does not restore old calls', async () => {
  const f = fixture();
  try {
    await f.sessions.start(input, f.paseo);
    f.advance(20_000); assert.equal(f.sessions.list().length, 1);
    f.advance(11_000); assert.deepEqual(f.sessions.list(), []);
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(f.children[0].closed);
    await f.sessions.start(input, f.paseo);
    f.sessions.dispose();
    assert.deepEqual(f.sessions.list(), []);
    assert.ok(f.children.every((child) => child.closed));
    const restarted = fixture();
    try { assert.deepEqual(restarted.sessions.list(), []); } finally { restarted.sessions.dispose(); }
  } finally { f.sessions.dispose(); }
});

test('server reads host voice preference for each start and refuses invalid settings', async () => {
  const handlers = new Map<unknown, (...args: any[]) => any>();
  const starts: unknown[][] = [];
  let preference: any = { status: 'ready', values: { voice: 'selected' } };
  let disposed = false;
  class Sessions {
    start(...args: unknown[]) { starts.push(args); return {}; }
    dispose() { disposed = true; }
  }
  const source = readFileSync(resolve('index.server.ts'), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, any> = {};
  new Function('exports', 'require', js)(exports, (name: string) => {
    if (name === '@/server/sessions') return { VoiceSessions: Sessions };
    assert.equal(name, '@/shared/contracts'); return contracts;
  });
  const cleanup = exports.default({
    registerSettings(definition: unknown) { assert.equal(definition, contracts.voiceSettings); return { read: async () => preference }; },
    handle(definition: unknown, handler: (...args: any[]) => any) { handlers.set(definition, handler); },
    on() { return () => {}; },
  });
  try {
    const start = handlers.get(contracts.startVoice)!;
    const paseo = {};
    await start(input, { paseo });
    assert.deepEqual(starts[0], [input, paseo, 'selected']);
    preference = { status: 'ready', values: { voice: '' } };
    await start(input, { paseo });
    assert.deepEqual(starts[1], [input, paseo, '']);
    preference = { status: 'invalid' };
    await assert.rejects(start(input, { paseo }), /settings are invalid/);
    assert.equal(starts.length, 2);
  } finally { cleanup(); }
  assert.equal(disposed, true);
});
