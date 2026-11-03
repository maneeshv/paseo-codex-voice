import { defineRpc, defineSettings } from '@getpaseo/plugin';
import { z } from 'zod';

const sessionId = z.string().uuid();
export const voiceEvent = z.object({
  id: z.number().int(), kind: z.enum(['transcript', 'status', 'tool', 'error']),
  text: z.string(), role: z.enum(['user', 'assistant']).optional(), itemId: z.string().optional(),
});
export type VoiceEvent = z.infer<typeof voiceEvent>;
export const startVoice = defineRpc({
  name: 'voice.start',
  input: z.object({ workspaceId: z.string().min(1), agentId: z.string().optional(), sdp: z.string().min(1).max(100_000) }),
  output: z.object({ sessionId, answerSdp: z.string() }),
});
export const pollVoice = defineRpc({
  name: 'voice.poll', input: z.object({ sessionId, after: z.number().int().nonnegative() }),
  output: z.object({ events: z.array(voiceEvent), cursor: z.number().int(), status: z.enum(['connecting', 'live', 'closed', 'error']) }),
});
export const stopVoice = defineRpc({ name: 'voice.stop', input: z.object({ sessionId }), output: z.object({}) });
export const sendText = defineRpc({ name: 'voice.text', input: z.object({ sessionId, text: z.string().trim().min(1).max(20_000) }), output: z.object({}) });

export const voiceSettings = defineSettings({
  id: 'voice', scope: 'host', version: 1,
  schema: z.object({ voice: z.string().max(100).default('') }),
});
export const getVoices = defineRpc({
  name: 'voice.voices', input: z.object({}),
  output: z.object({ voices: z.array(z.string()), defaultVoice: z.string() }),
});
const activeVoiceSession = z.object({
  sessionId, workspaceId: z.string(), workspaceName: z.string(), agentId: z.string().optional(),
  threadId: z.string().optional(), voice: z.string().optional(),
  status: z.enum(['connecting', 'live']), createdAt: z.number(),
});
export type ActiveVoiceSession = z.infer<typeof activeVoiceSession>;
export const listVoiceSessions = defineRpc({
  name: 'voice.list', input: z.object({}), output: z.object({ sessions: z.array(activeVoiceSession) }),
});
