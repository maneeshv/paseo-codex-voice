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
  // ponytail: legacy `on` names keep 0.14 support (0.14 has no addHook). 0.15 maps them to
  // agent.turn.after / agent.permission.before. Move to addHook and raise the minimum before removal after 2027-04-30.
  const ended = server.on('agent.turn_ended', ({ agent, outcome }) => sessions.workerEnded(agent.id, outcome.kind));
  const permission = server.on('agent.permission_requested', ({ agent }) => sessions.workerNeedsPermission(agent.id));
  return () => { ended(); permission(); sessions.dispose(); };
}
