import assert from 'node:assert/strict';
import test from 'node:test';
import type { PluginServerContext } from '@getpaseo/plugin/server';
import contribute from '@/index.server';
import { VoiceSessions } from '@/server/sessions';

for (const modern of [false, true]) {
  test(`${modern ? 'current hooks' : '0.14 events'} forward worker identity/outcomes and release sessions`, async (t) => {
    const ended = t.mock.method(VoiceSessions.prototype, 'workerEnded', async () => {});
    const permission = t.mock.method(VoiceSessions.prototype, 'workerNeedsPermission', async () => {});
    const dispose = t.mock.method(VoiceSessions.prototype, 'dispose');
    const handlers = new Map<string, (event: any) => Promise<void>>();
    const removed: string[] = [];
    const register = (name: string, handler: (event: any) => Promise<void>) => {
      assert.ok(!handlers.has(name));
      handlers.set(name, handler);
      return () => { handlers.delete(name); removed.push(name); };
    };
    const server = {
      registerSettings: () => ({}), handle() {},
      on: modern ? () => { throw new Error('Modern hosts must not use deprecated events'); } : register,
      ...(modern ? { addHook: register } : {}),
    } as unknown as PluginServerContext;
    const cleanup = contribute(server);
    const names = modern
      ? ['agent.turn.after', 'agent.permission.before']
      : ['agent.turn_ended', 'agent.permission_requested'];
    try {
      assert.deepEqual([...handlers.keys()], names);
      for (const kind of ['completed', 'failed', 'cancelled']) {
        await handlers.get(names[0])!({ agent: { id: 'worker-a' }, outcome: { kind }, turnId: 'turn' });
      }
      assert.deepEqual(ended.mock.calls.map((call) => call.arguments), [
        ['worker-a', 'completed'], ['worker-a', 'failed'], ['worker-a', 'cancelled'],
      ]);
      await handlers.get(names[1])!({ agent: { id: 'worker-b' }, request: { id: 'request' } });
      assert.deepEqual(permission.mock.calls[0].arguments, ['worker-b']);
    } finally { cleanup(); }
    assert.deepEqual(removed, names);
    assert.equal(handlers.size, 0);
    assert.equal(dispose.mock.callCount(), 1);
  });
}
