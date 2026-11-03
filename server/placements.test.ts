import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import * as contracts from '@/shared/contracts';
import { getCallTarget, rememberCallTarget } from '@/client/call-targets';

type Observer = { snapshot(value: any): void; update(value: any): void };
type Button = { contribution: any; removed: boolean };
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
const call = (sessionId: string, workspaceId = 'workspace', agentId?: string, status = 'live') => ({
  sessionId, workspaceId, workspaceName: workspaceId, agentId, status, createdAt: 100,
});

function fixture(pendingInventory?: Promise<{ sessions: ReturnType<typeof call>[] }>) {
  const registrations = new Map<string, { contribution: any; removed: boolean }>();
  const headers: Button[] = [], pills: Button[] = [], opened: unknown[][] = [];
  const screens: unknown[] = [], rpcCalls: unknown[] = [];
  const timers = new Map<number, { run(): void; ms: number }>();
  let timerId = 0, sessions: ReturnType<typeof call>[] = [], rpcError: Error | undefined;
  let failRegistration: 'add' | 'update' | undefined;
  const errors: unknown[][] = [];
  const validateButton = (button: any) => {
    if (button.behavior?.kind !== 'menu') return;
    for (const entry of button.behavior.items) {
      // The native host rejects digit-leading UUIDs as menu item IDs.
      assert.match(entry.id, /^[a-z][a-z0-9-]*$/);
      if (entry.kind === 'item') validateButton(entry);
    }
  };
  const components = { AgentVoicePanel() {}, WorkspaceVoicePanel() {}, VoiceScreen() {}, VoiceSidebarItem() {} };
  let workspaceObserver!: Observer, agentObserver!: Observer;
  let resolveWorkspaces!: (result: unknown) => void;
  let workspaceOptions: any, agentOptions: any, releases = 0;
  const workspaceResult = new Promise((resolve) => { resolveWorkspaces = resolve; });
  const client: any = {
    openPanel: (...args: unknown[]) => opened.push(args),
    openScreen: (screen: unknown) => screens.push(screen),
    async rpc(definition: unknown) {
      rpcCalls.push(definition);
      assert.equal(definition, contracts.listVoiceSessions, 'entry points must only inspect inventory, never start or heartbeat a call');
      if (pendingInventory) return pendingInventory;
      if (rpcError) throw rpcError;
      return { sessions };
    },
    paseo: {
      workspaces: { list(options: unknown) { workspaceOptions = options; return workspaceResult; } },
      agents: { async list(options: unknown) {
        agentOptions = options;
        return { subscription: { subscribe(observer: Observer) { agentObserver = observer; } } };
      } },
    },
  };
  for (const kind of ['Screen', 'SidebarHeaderItem', 'WorkspacePanel', 'AgentPanel', 'CommandCenterItem']) {
    client[`add${kind}`] = (contribution: unknown) => {
      const registration = { contribution, removed: false };
      registrations.set(kind, registration);
      return () => { registration.removed = true; };
    };
  }
  for (const [kind, buttons] of [['HeaderButton', headers], ['ComposerPill', pills]] as const) {
    client[`add${kind}`] = (contribution: unknown) => {
      if (kind === 'ComposerPill' && failRegistration === 'add') { failRegistration = undefined; throw new Error('Transient add failure'); }
      validateButton((contribution as any).button);
      const registration = { contribution, removed: false };
      buttons.push(registration);
      return { remove() { registration.removed = true; }, update(patch: unknown) {
        if (kind === 'ComposerPill' && failRegistration === 'update') { failRegistration = undefined; throw new Error('Transient update failure'); }
        validateButton(patch);
        Object.assign((registration.contribution as any).button, patch);
      } };
    };
  }
  const jsx = { jsx: (type: unknown, props: unknown) => ({ type, props }), jsxs: (type: unknown, props: unknown) => ({ type, props }) };
  const helper: Record<string, any> = {};
  const helperJs = ts.transpileModule(readFileSync(resolve('client/live-status.tsx'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('exports', 'require', helperJs)(helper, (name: string) => {
    if (name === 'react/jsx-runtime') return jsx;
    if (name === 'react-native') return { View: 'View' };
    if (name === '@getpaseo/plugin/client/ui') return { Icon: 'Icon' };
    assert.equal(name, '@/client/voice-selector');
    return { voiceLabel: (voice: string) => voice[0].toUpperCase() + voice.slice(1) };
  });
  const source = readFileSync(resolve('index.client.tsx'), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports: Record<string, any> = {};
  // Replace only host-rendered components; execute the real registration and lifecycle code.
  new Function('exports', 'require', 'setTimeout', 'clearTimeout', 'console', js)(exports, (name: string) => {
    if (name === '@/shared/contracts') return contracts;
    if (name === '@/client/call-targets') return { getCallTarget };
    if (name === '@/client/live-status') return helper;
    if (name === 'react/jsx-runtime') return jsx;
    assert.ok(name === '@/client/panel' || name === '@/client/screen', `Unexpected runtime dependency: ${name}`);
    return components;
  }, (run: () => void, ms: number) => { timers.set(++timerId, { run, ms }); return timerId; }, (id: number) => timers.delete(id), { error: (...args: unknown[]) => errors.push(args) });
  const cleanup = exports.default(client);
  return {
    registrations, components, headers, pills, opened, screens, rpcCalls, timers, cleanup, errors,
    failNextRegistration(operation: 'add' | 'update') { failRegistration = operation; },
    activePills: () => pills.filter((pill) => !pill.removed),
    async poll(next: ReturnType<typeof call>[], failure?: Error) {
      sessions = next; rpcError = failure;
      const entry = [...timers][0];
      assert.ok(entry, 'inventory must schedule the next poll');
      const [id, timer] = entry; assert.equal(timer.ms, 1500); timers.delete(id); timer.run();
      await settle();
    },
    setInventory(next: ReturnType<typeof call>[], failure?: Error) { sessions = next; rpcError = failure; },
    setPendingInventory(pending: Promise<{ sessions: ReturnType<typeof call>[] }>) { pendingInventory = pending; },
    get workspaceOptions() { return workspaceOptions; }, get agentOptions() { return agentOptions; },
    get workspaceObserver() { return workspaceObserver; }, get agentObserver() { return agentObserver; },
    get releases() { return releases; },
    async ready() {
      resolveWorkspaces({ subscription: {
        subscribe(observer: Observer) { workspaceObserver = observer; },
        release() { releases++; },
      } });
      await settle();
    },
  };
}

test('workspace and sidebar launchers remain available without creating an unconditional chat pill', async () => {
  const f = fixture(); await f.ready();
  assert.deepEqual(f.workspaceOptions, { sync: {}, subscribe: {} });
  assert.equal(typeof f.registrations.get('Screen')!.contribution.Component, 'function');
  assert.equal(f.registrations.get('SidebarHeaderItem')!.contribution.Component, f.components.VoiceSidebarItem);
  assert.equal(f.registrations.get('Screen')!.contribution.id, 'codex-voice');
  f.workspaceObserver.snapshot({ entries: [{ id: 'workspace-only' }] });
  assert.equal(f.headers.length, 1);
  assert.equal(f.pills.length, 0);
  f.headers[0].contribution.button.behavior.onPress();
  assert.deepEqual(f.opened.pop(), ['codex-voice', { workspaceId: 'workspace-only' }]);

  f.agentObserver.snapshot({ entries: [{ agent: { id: 'agent-1', workspaceId: 'workspace-only' } }] });
  assert.equal(f.pills.length, 0);
  f.registrations.get('CommandCenterItem')!.contribution.onSelect({ openPanel: (...args: unknown[]) => f.opened.push(args) });
  assert.deepEqual(f.opened.pop(), ['codex-voice']);
  f.cleanup();
});

test('workspace updates target the right header and disposal releases every entry point', async () => {
  const f = fixture(); await f.ready();
  f.workspaceObserver.snapshot({ entries: [{ id: 'first' }, { id: 'second' }] });
  f.workspaceObserver.update({ type: 'workspace_update', payload: { kind: 'upsert', workspace: { id: 'first' } } });
  assert.equal(f.headers.length, 2, 'upserts must not duplicate the header');
  f.workspaceObserver.update({ type: 'workspace_update', payload: { kind: 'remove', id: 'first' } });
  assert.equal(f.headers[0].removed, true);
  assert.equal(f.headers[1].removed, false);
  f.workspaceObserver.update({ type: 'workspace_update', payload: { kind: 'upsert', workspace: { id: 'third' } } });
  assert.equal(f.headers[2].contribution.workspaceId, 'third');
  f.agentObserver.snapshot({ entries: [{ agent: { id: 'agent-1', workspaceId: 'second' } }] });
  f.cleanup();
  assert.ok(f.agentOptions.signal.aborted);
  assert.equal(f.timers.size, 0);
  assert.equal(f.releases, 1);
  assert.ok(f.headers.every((button) => button.removed));
  assert.ok(f.pills.every((button) => button.removed));
  assert.ok([...f.registrations.values()].every((entry) => entry.removed));
  f.workspaceObserver.update({ type: 'workspace_update', payload: { kind: 'upsert', workspace: { id: 'late' } } });
  assert.equal(f.headers.length, 3, 'late events must not recreate disposed buttons');
});

test('disposing during workspace bootstrap releases the late subscription', async () => {
  const f = fixture();
  f.cleanup();
  await f.ready();
  assert.equal(f.releases, 1);
  assert.equal(f.workspaceObserver, undefined);
  assert.equal(f.headers.length, 0);
  assert.ok(f.agentOptions.signal.aborted);
});

test('chat pills reflect only related existing calls and disappear when inventory is empty or unavailable', async () => {
  const f = fixture(); await f.ready();
  try {
    f.agentObserver.snapshot({ entries: [
      { agent: { id: 'first', workspaceId: 'workspace' } },
      { agent: { id: 'second', workspaceId: 'workspace' } },
      { agent: { id: 'elsewhere', workspaceId: 'other' } },
    ] });
    assert.equal(f.activePills().length, 0);
    await f.poll([call('agent-call', 'workspace', 'first')]);
    assert.deepEqual(f.activePills().map((pill) => pill.contribution.agentId), ['first']);
    assert.match(f.activePills()[0].contribution.button.label ?? f.activePills()[0].contribution.button.title, /Live/);
    const firstRegistration = f.activePills()[0];
    await f.poll([call('agent-call', 'workspace', 'first', 'connecting')]);
    assert.equal(f.activePills()[0], firstRegistration, 'status changes update the existing registration');
    assert.match(f.activePills()[0].contribution.button.label ?? f.activePills()[0].contribution.button.title, /Connecting/);
    await f.poll([call('workspace-call')]);
    assert.deepEqual(f.activePills().map((pill) => pill.contribution.agentId).sort(), ['first', 'second']);
    await f.poll([call('workspace-call'), call('agent-call', 'workspace', 'first')]);
    const menu = f.activePills().find((pill) => pill.contribution.agentId === 'first')!.contribution.button;
    assert.match(`${menu.label} ${menu.title}`, /2/);
    assert.equal(menu.behavior.kind, 'menu');
    assert.equal(menu.behavior.items.filter((entry: any) => entry.kind === 'item').length, 2);
    await f.poll([]); assert.equal(f.activePills().length, 0);
    await f.poll([call('workspace-call')]); assert.equal(f.activePills().length, 2);
    await f.poll([], new Error('Host offline')); assert.equal(f.activePills().length, 0);
  } finally { f.cleanup(); }
});

test('opening a call rechecks inventory, reveals its owned panel, or opens management without starting audio', async () => {
  const f = fixture(); await f.ready();
  const forget = rememberCallTarget('owned', { panelId: 'codex-voice-agent', workspaceId: 'workspace', agentId: 'first' });
  try {
    f.agentObserver.snapshot({ entries: [{ agent: { id: 'first', workspaceId: 'workspace' } }] });
    await f.poll([call('owned', 'workspace', 'first')]);
    const before = f.rpcCalls.length;
    await f.activePills()[0].contribution.button.behavior.onPress();
    await settle();
    assert.equal(f.rpcCalls.length, before + 1);
    assert.deepEqual(f.opened.pop(), ['codex-voice-agent', { workspaceId: 'workspace', agentId: 'first' }]);
    await f.poll([call('remote')]);
    await f.activePills()[0].contribution.button.behavior.onPress(); await settle();
    assert.deepEqual(f.screens.pop(), { screenId: 'codex-voice', params: { sessionId: 'remote' } });
    await f.poll([call('owned', 'workspace', 'first')]);
    const staleClick = f.activePills()[0].contribution.button.behavior.onPress;
    f.setInventory([]);
    await staleClick(); await settle();
    assert.deepEqual(f.screens.pop(), { screenId: 'codex-voice', params: { sessionId: 'owned' } });
    assert.equal(f.opened.length, 0, 'an ended call must not open a panel capable of starting another call');
    f.setInventory([], new Error('Host offline'));
    await staleClick(); await settle();
    assert.equal(f.opened.length, 0);
    assert.ok(f.rpcCalls.every((rpc) => rpc === contracts.listVoiceSessions));
  } finally { forget(); f.cleanup(); }
});

test('call targets are owned by the latest mounted view and old cleanup cannot remove its replacement', () => {
  const first = { panelId: 'codex-voice' as const, workspaceId: 'workspace' };
  const replacement = { panelId: 'codex-voice-agent' as const, workspaceId: 'workspace', agentId: 'agent' };
  const forgetFirst = rememberCallTarget('target-test', first);
  assert.equal(getCallTarget('target-test'), first);
  const forgetReplacement = rememberCallTarget('target-test', replacement);
  forgetFirst(); assert.equal(getCallTarget('target-test'), replacement);
  forgetReplacement(); assert.equal(getCallTarget('target-test'), undefined);
});

test('a pending inventory request never overlaps or restores pills after unload', async () => {
  let resolveInventory!: (value: { sessions: ReturnType<typeof call>[] }) => void;
  const f = fixture(new Promise((resolve) => { resolveInventory = resolve; }));
  await f.ready();
  f.agentObserver.snapshot({ entries: [{ agent: { id: 'agent', workspaceId: 'workspace' } }] });
  assert.equal(f.rpcCalls.length, 1);
  assert.equal(f.timers.size, 0);
  f.cleanup(); resolveInventory({ sessions: [call('late')] }); await settle();
  assert.equal(f.activePills().length, 0);
  assert.equal(f.timers.size, 0);
});

test('unloading during a call-opening recheck prevents late navigation', async () => {
  const f = fixture(); await f.ready();
  const forget = rememberCallTarget('pending-click', { panelId: 'codex-voice', workspaceId: 'workspace' });
  try {
    f.agentObserver.snapshot({ entries: [{ agent: { id: 'agent', workspaceId: 'workspace' } }] });
    await f.poll([call('pending-click')]);
    let resolveInventory!: (value: { sessions: ReturnType<typeof call>[] }) => void;
    f.setPendingInventory(new Promise((resolve) => { resolveInventory = resolve; }));
    f.activePills()[0].contribution.button.behavior.onPress();
    f.cleanup(); resolveInventory({ sessions: [call('pending-click')] }); await settle();
    assert.deepEqual(f.opened, []);
    assert.deepEqual(f.screens, []);
  } finally { forget(); }
});

test('multiple-call menus satisfy native IDs while opening the original digit-leading session UUID', async () => {
  const f = fixture(); await f.ready();
  const sessionId = '12345678-1234-4234-8234-123456789abc';
  try {
    f.agentObserver.snapshot({ entries: [{ agent: { id: 'agent', workspaceId: 'workspace' } }] });
    await f.poll([call(sessionId), call('abcdefab-1234-4234-8234-123456789abc')]);
    assert.equal(f.errors.length, 0);
    const menu = f.activePills()[0].contribution.button.behavior;
    assert.equal(menu.kind, 'menu');
    assert.equal(menu.items.length, 2);
    for (const item of menu.items) assert.match(item.id, /^[a-z][a-z0-9-]*$/);
    menu.items[0].behavior.onPress(); await settle();
    assert.deepEqual(f.screens.pop(), { screenId: 'codex-voice', params: { sessionId } });
  } finally { f.cleanup(); }
});

test('inventory polling recovers after transient host add and update failures', async () => {
  const f = fixture(); await f.ready();
  try {
    f.agentObserver.snapshot({ entries: [{ agent: { id: 'agent', workspaceId: 'workspace' } }] });
    f.failNextRegistration('add');
    await f.poll([call('existing')]);
    assert.equal(f.activePills().length, 0);
    assert.equal(f.errors.length, 1);
    assert.equal(f.timers.size, 1);
    await f.poll([call('existing')]);
    assert.equal(f.activePills().length, 1);
    f.failNextRegistration('update');
    await f.poll([call('existing', 'workspace', undefined, 'connecting')]);
    assert.equal(f.errors.length, 2);
    assert.equal(f.timers.size, 1);
    await f.poll([call('existing', 'workspace', undefined, 'connecting')]);
    assert.equal(f.activePills().length, 1);
    assert.match(f.activePills()[0].contribution.button.label, /Connecting/);
    await f.poll([]); assert.equal(f.activePills().length, 0);
  } finally { f.cleanup(); }
});
