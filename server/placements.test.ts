import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

type Observer = { snapshot(value: any): void; update(value: any): void };
type Button = { contribution: any; removed: boolean };

function fixture() {
  const registrations = new Map<string, { contribution: any; removed: boolean }>();
  const headers: Button[] = [], pills: Button[] = [], opened: unknown[][] = [];
  const components = { AgentVoicePanel() {}, WorkspaceVoicePanel() {}, VoiceScreen() {}, VoiceSidebarItem() {} };
  let workspaceObserver!: Observer, agentObserver!: Observer;
  let resolveWorkspaces!: (result: unknown) => void;
  let workspaceOptions: any, agentOptions: any, releases = 0;
  const workspaceResult = new Promise((resolve) => { resolveWorkspaces = resolve; });
  const client: any = {
    openPanel: (...args: unknown[]) => opened.push(args),
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
      const registration = { contribution, removed: false };
      buttons.push(registration);
      return { remove() { registration.removed = true; } };
    };
  }
  const source = readFileSync(resolve('index.client.tsx'), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, any> = {};
  // Replace only host-rendered components; execute the real registration and lifecycle code.
  new Function('exports', 'require', js)(exports, (name: string) => {
    assert.ok(name === '@/client/panel' || name === '@/client/screen', `Unexpected runtime dependency: ${name}`);
    return components;
  });
  const cleanup = exports.default(client);
  return {
    registrations, components, headers, pills, opened, cleanup,
    get workspaceOptions() { return workspaceOptions; }, get agentOptions() { return agentOptions; },
    get workspaceObserver() { return workspaceObserver; }, get agentObserver() { return agentObserver; },
    get releases() { return releases; },
    async ready() {
      resolveWorkspaces({ subscription: {
        subscribe(observer: Observer) { workspaceObserver = observer; },
        release() { releases++; },
      } });
      await Promise.resolve();
    },
  };
}

test('workspace and sidebar entry points preserve the existing chat and command entry points', async () => {
  const f = fixture(); await f.ready();
  assert.deepEqual(f.workspaceOptions, { sync: {}, subscribe: {} });
  assert.equal(f.registrations.get('Screen')!.contribution.Component, f.components.VoiceScreen);
  assert.equal(f.registrations.get('SidebarHeaderItem')!.contribution.Component, f.components.VoiceSidebarItem);
  assert.equal(f.registrations.get('Screen')!.contribution.id, 'codex-voice');
  f.workspaceObserver.snapshot({ entries: [{ id: 'workspace-only' }] });
  assert.equal(f.headers.length, 1);
  assert.equal(f.pills.length, 0);
  f.headers[0].contribution.button.behavior.onPress();
  assert.deepEqual(f.opened.pop(), ['codex-voice', { workspaceId: 'workspace-only' }]);

  f.agentObserver.snapshot({ entries: [{ agent: { id: 'agent-1', workspaceId: 'workspace-only' } }] });
  f.pills[0].contribution.button.behavior.onPress();
  assert.deepEqual(f.opened.pop(), ['codex-voice-agent', { workspaceId: 'workspace-only', agentId: 'agent-1' }]);
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
