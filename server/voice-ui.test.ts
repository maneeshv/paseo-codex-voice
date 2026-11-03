import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import * as contracts from '@/shared/contracts';
import * as targets from '@/client/call-targets';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
const descendants = (node: any): any[] => Array.isArray(node) ? node.flatMap(descendants) : node && typeof node === 'object' ? [node, ...descendants(node.props?.children)] : node == null ? [] : [node];

// Minimal hook host: run the real effects with controllable RPCs and timers, without React Native.
function load(file: string, rpc: () => Promise<unknown>, overrides: Record<string, unknown> = {}) {
  let cursor = 0;
  const slots: any[] = [], effects: Array<() => void> = [];
  const timers = new Map<number, { run(): void; ms: number }>();
  let timerId = 0;
  const react = {
    useMemo(factory: () => unknown) { cursor++; return factory(); },
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value: any) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      return slots[index] ??= { current: initial };
    },
    useEffect(effect: () => (() => void) | undefined, deps: unknown[]) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
        effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: effect() }; });
      }
    },
  };
  const modules: Record<string, unknown> = {
    react, 'react-native': {},
    'react/jsx-runtime': { jsx: (type: unknown, props: unknown) => ({ type, props }), jsxs: (type: unknown, props: unknown) => ({ type, props }) },
    '@getpaseo/plugin/client': { useRpc: () => rpc },
    '@getpaseo/plugin/client/ui': { SettingsSelect: 'select', SettingsAction: 'action', SettingsRow: 'row' },
    '@/client/voice-selector': {}, '@/shared/contracts': {},
    ...overrides,
  };
  const js = ts.transpileModule(readFileSync(resolve(file), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports: Record<string, any> = {};
  new Function('exports', 'require', 'setTimeout', 'clearTimeout', js)(exports, (name: string) => {
    assert.ok(name in modules, `Unexpected dependency: ${name}`); return modules[name];
  }, (run: () => void, ms: number) => { timers.set(++timerId, { run, ms }); return timerId; }, (id: number) => timers.delete(id));
  return {
    exports, timers,
    render<T>(run: () => T): T { cursor = 0; const result = run(); while (effects.length) effects.shift()!(); return result; },
    fireTimer() { const [id, timer] = [...timers][0]; timers.delete(id); timer.run(); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test('active-call polling avoids overlap, clears stale rows on error, and ignores old-host responses', async () => {
  const requests: ReturnType<typeof deferred<any>>[] = [];
  const f = load('client/active-sessions.tsx', () => { const request = deferred<any>(); requests.push(request); return request.promise; });
  let host = 'first';
  const render = () => f.render(() => f.exports.useActiveSessions(host));
  assert.equal(render().sessions, null);
  assert.equal(requests.length, 1);
  assert.equal(f.timers.size, 0, 'a pending request must not schedule another poll');
  requests[0].resolve({ sessions: [{ sessionId: 'first-call' }] }); await settle();
  assert.deepEqual(render().sessions, [{ sessionId: 'first-call' }]);
  assert.equal([...f.timers.values()][0].ms, 1500);
  f.fireTimer(); assert.equal(f.timers.size, 0);
  requests[1].reject(new Error('Host offline')); await settle();
  assert.deepEqual(render().sessions, null);
  assert.equal(render().error, 'Host offline');
  f.fireTimer();
  host = 'second'; render();
  assert.equal(render().sessions, null);
  requests[2].resolve({ sessions: [{ sessionId: 'stale-first-host-call' }] }); await settle();
  assert.equal(render().sessions, null, 'a response from the previous daemon must be ignored');
  assert.equal(f.timers.size, 0, 'old-host responses must not restart polling');
  requests[3].resolve({ sessions: [{ sessionId: 'second-call' }] }); await settle();
  assert.deepEqual(render().sessions, [{ sessionId: 'second-call' }]);
  f.unmount(); assert.equal(f.timers.size, 0);
});

test('voice selector uses the returned catalog and saves the selected value with the current revision', async () => {
  const catalog = deferred<any>();
  const f = load('client/voice-selector.tsx', () => catalog.promise);
  const saved: unknown[][] = [];
  const settings = { status: 'ready', values: { voice: '' }, revision: 'revision-7', saving: false, saveError: null, save: (...args: unknown[]) => { saved.push(args); } };
  let disabled = false;
  const render = () => f.render(() => f.exports.VoiceSelector({ hostId: 'host', settings, disabled }));
  assert.equal(render().type, 'row');
  catalog.resolve({ voices: ['first', 'only-on-this-host'], defaultVoice: 'first' }); await settle();
  const ready = render();
  assert.equal(ready.type, 'select');
  assert.deepEqual(ready.props.options.map((option: any) => option.value), ['', 'first', 'only-on-this-host']);
  ready.props.onValueChange('only-on-this-host');
  assert.deepEqual(saved, [[{ voice: 'only-on-this-host' }, 'revision-7']]);
  disabled = true; assert.equal(render().props.disabled, true);
  disabled = false; settings.saving = true;
  const saving = render(); assert.equal(saving.props.disabled, true);
  saving.props.onValueChange('first'); assert.equal(saved.length, 1);
  settings.saving = false; settings.values.voice = 'old-host-voice';
  const unavailable = render();
  assert.match(unavailable.props.error, /not available on this host/);
  assert.equal(unavailable.props.options.at(-1).value, 'old-host-voice');
  f.unmount();
});

test('voice view owns its resumable panel only during the call and never registers a canceled late start', async () => {
  for (const cancelBeforeStart of [false, true]) {
    const sessionId = `owned-panel-${cancelBeforeStart}`;
    const started = deferred<any>(), polled = deferred<any>();
    const stopped: unknown[] = [];
    let signal!: AbortSignal;
    const f = load('client/panel.tsx', async () => ({}), {
      '@/shared/contracts': contracts,
      '@/client/call-targets': targets,
      '@/client/web': {
        isVoiceSupported: () => true,
        async createVoicePeer(options: { signal: AbortSignal }) {
          signal = options.signal;
          return { offerSdp: 'offer', async acceptAnswer() {}, close() {} };
        },
      },
      '@getpaseo/plugin/client': {
        useSettings: () => ({ status: 'ready', values: { voice: '' }, saving: false }),
        useRpc: (definition: unknown) => {
          if (definition === contracts.startVoice) return () => started.promise;
          if (definition === contracts.pollVoice) return () => polled.promise;
          if (definition === contracts.stopVoice) return async (input: unknown) => { stopped.push(input); return {}; };
          assert.equal(definition, contracts.sendText); return async () => ({});
        },
      },
    });
    const render = () => f.render(() => f.exports.VoiceView({ theme: { colors: {} }, layout: { compact: false }, host: { id: 'host' }, workspaceId: 'workspace', agentId: 'agent' }));
    const findStart = (node: any): any => {
      if (!node || typeof node !== 'object') return undefined;
      if (node.props?.accessibilityLabel === 'Start voice call') return node;
      for (const child of [node.props?.children].flat()) { const match = findStart(child); if (match) return match; }
    };
    findStart(render()).props.onPress(); await settle();
    assert.equal(targets.getCallTarget(sessionId), undefined);
    if (cancelBeforeStart) f.unmount();
    started.resolve({ sessionId, answerSdp: 'answer' }); await settle();
    if (!cancelBeforeStart) {
      assert.deepEqual(targets.getCallTarget(sessionId), { panelId: 'codex-voice-agent', workspaceId: 'workspace', agentId: 'agent' });
      f.unmount();
    }
    assert.equal(targets.getCallTarget(sessionId), undefined);
    assert.ok(signal.aborted);
    assert.deepEqual(stopped, [{ sessionId }]);
    polled.resolve({ events: [], cursor: 0, status: 'closed' }); await settle();
    assert.equal(f.timers.size, 0);
  }
});

test('sidebar shows accurate live and connecting badges but makes no claim for empty or unavailable inventory', () => {
  let inventory: any = { sessions: [], error: null };
  const f = load('client/screen.tsx', async () => ({}), {
    '@/client/active-sessions': { useActiveSessions: () => inventory },
    '@getpaseo/plugin/client/ui': { SidebarRow: 'sidebar' },
  });
  const render = () => f.render(() => f.exports.VoiceSidebarItem({ theme: { colors: { statusSuccess: 'green', statusWarning: 'amber' } }, host: { id: 'host' }, openScreen() {} }));
  assert.equal(render().props.trailing, undefined);
  inventory = { sessions: null, error: null }; assert.equal(render().props.trailing, undefined);
  inventory = { sessions: [{ status: 'live' }], error: null };
  let badge = descendants(render().props.trailing);
  assert.ok(badge.includes('Live'));
  assert.ok(badge.some((node) => node.props?.style?.backgroundColor === 'green'));
  inventory.sessions = [{ status: 'connecting' }]; badge = descendants(render().props.trailing);
  assert.ok(badge.includes('Connecting'));
  assert.ok(badge.some((node) => node.props?.style?.backgroundColor === 'amber'));
  inventory.sessions = [{ status: 'live' }, { status: 'connecting' }];
  assert.ok(descendants(render().props.trailing).includes('1 Live · 1 Connecting'));
  inventory.error = 'Host offline';
  assert.equal(render().props.trailing, undefined);
  assert.match(render().props.label, /status unavailable/);
  f.unmount();
});

test('existing-call management never exposes a launcher and distinguishes ended calls from unavailable status', async () => {
  let workspaceReads = 0;
  const screen = load('client/screen.tsx', async () => ({}), {
    '@/client/active-sessions': { ActiveSessions: 'sessions' },
    '@/client/voice-selector': { VoiceSelector: 'selector' },
    '@getpaseo/plugin/client': {
      usePaseo: () => ({ workspaces: { list() { workspaceReads++; return Promise.resolve({ entries: [] }); } } }),
      useSettings: () => ({ status: 'ready' }),
    },
  });
  const nodes = descendants(screen.render(() => screen.exports.VoiceScreen({ theme: { colors: {} }, layout: { compact: false }, host: { id: 'host' }, params: { sessionId: 'existing' } })));
  assert.equal(workspaceReads, 0);
  assert.equal(nodes.some((node) => node.type === 'selector'), false);
  assert.equal(nodes.find((node) => node.type === 'sessions').props.sessionId, 'existing');
  assert.equal(nodes.some((node) => /Start voice/.test(node.props?.accessibilityLabel ?? '')), false);
  screen.unmount();

  let offline = false;
  const active = load('client/active-sessions.tsx', async () => {
    if (offline) throw new Error('Host offline');
    return { sessions: [] };
  });
  const render = () => active.render(() => active.exports.ActiveSessions({ theme: { colors: {} }, host: { id: 'host', label: 'Host' }, sessionId: 'existing' }));
  assert.equal(render(), null); await settle();
  assert.ok(descendants(render()).includes('This call has ended or is no longer available.'));
  offline = true; active.fireTimer(); await settle();
  assert.ok(descendants(render()).includes('Host offline'));
  assert.equal(descendants(render()).includes('This call has ended or is no longer available.'), false);
  active.unmount();
});
