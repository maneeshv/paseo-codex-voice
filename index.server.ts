import type { PluginServerContext } from '@getpaseo/plugin/server';
import { VoiceSessions } from '@/server/sessions';
import { startVoice, pollVoice, stopVoice, sendText, voiceSettings, getVoices, listVoiceSessions } from '@/shared/contracts';

export default function contribute(server: PluginServerContext) {
  const sessions = new VoiceSessions();
  const settings = server.registerSettings(voiceSettings);
  server.handle(getVoices, () => sessions.voices());
  server.handle(listVoiceSessions, () => ({ sessions: sessions.list() }));
  server.handle(startVoice, async (input, { paseo }) => {
    const preference = await settings.read();
    if (preference.status !== 'ready') throw new Error('Voice settings are invalid. Reset the voice preference and retry.');
    return sessions.start(input, paseo, preference.values.voice);
  });
  server.handle(pollVoice, ({ sessionId, after }) => sessions.poll(sessionId, after));
  server.handle(stopVoice, async ({ sessionId }) => { await sessions.stop(sessionId); return {}; });
  server.handle(sendText, async ({ sessionId, text }) => { await sessions.sendText(sessionId, text); return {}; });
  const turnEnded = async ({ agent, outcome }: { agent: { id: string }; outcome: { kind: string } }) => sessions.workerEnded(agent.id, outcome.kind);
  const needsPermission = async ({ agent }: { agent: { id: string } }) => sessions.workerNeedsPermission(agent.id);
  // Published 0.14.0 has only on; newer hosts use the non-deprecated hooks.
  const removers = 'addHook' in server && typeof server.addHook === 'function'
    ? [server.addHook('agent.turn.after', turnEnded), server.addHook('agent.permission.before', needsPermission)]
    : [server.on('agent.turn_ended', turnEnded), server.on('agent.permission_requested', needsPermission)];
  return () => { removers.forEach((remove) => remove()); sessions.dispose(); };
}
