import type { PluginServerContext } from '@getpaseo/plugin/server';
import { VoiceSessions } from '@/server/sessions';
import { startVoice, pollVoice, stopVoice, sendText } from '@/shared/contracts';

export default function contribute(server: PluginServerContext) {
  const sessions = new VoiceSessions();
  server.handle(startVoice, (input, { paseo }) => sessions.start(input, paseo));
  server.handle(pollVoice, ({ sessionId, after }) => sessions.poll(sessionId, after));
  server.handle(stopVoice, async ({ sessionId }) => { await sessions.stop(sessionId); return {}; });
  server.handle(sendText, async ({ sessionId, text }) => { await sessions.sendText(sessionId, text); return {}; });
  const ended = server.on('agent.turn_ended', ({ agent, outcome }) => sessions.workerEnded(agent.id, outcome.kind));
  const permission = server.on('agent.permission_requested', ({ agent }) => sessions.workerNeedsPermission(agent.id));
  return () => { ended(); permission(); sessions.dispose(); };
}
