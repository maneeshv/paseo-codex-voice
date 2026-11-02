import { defineRpc } from '@getpaseo/plugin';
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
