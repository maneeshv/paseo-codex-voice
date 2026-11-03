import { z } from 'zod';
import type { CodexConnection } from '@/server/codex';

const voice = z.string().min(1).max(100);
const response = z.object({ voices: z.object({
  v1: z.array(voice).min(1), v3: z.array(voice).min(1).optional(), defaultV1: voice,
}) });

export async function initializeCodex(connection: CodexConnection): Promise<void> {
  await connection.request('initialize', {
    clientInfo: { name: 'paseo_codex_voice', title: 'Paseo Codex Voice', version: '0.1.0' },
    capabilities: { experimentalApi: true },
  });
  connection.notify('initialized');
}

export async function readVoices(connection: CodexConnection) {
  const { voices } = response.parse(await connection.request('thread/realtime/listVoices', {}));
  // Codex 0.162.1 uses V1 voices for V3; newer releases expose a separate V3 list.
  const supported = voices.v3 ?? voices.v1;
  if (!supported.includes(voices.defaultV1)) throw new Error('Codex returned an unsupported default voice.');
  return { voices: supported, defaultVoice: voices.defaultV1 };
}
