import { useRpc, type SettingsState } from '@getpaseo/plugin/client';
import { SettingsAction, SettingsRow, SettingsSelect } from '@getpaseo/plugin/client/ui';
import { useEffect, useState } from 'react';
import { getVoices, voiceSettings } from '@/shared/contracts';

export type VoiceSettingsState = SettingsState<typeof voiceSettings.schema>;

/** Codex voice ids are plain lowercase words; capitalize only the first letter. */
export const voiceLabel = (voice: string) => (voice ? voice[0].toUpperCase() + voice.slice(1) : voice);

type Catalog =
  | { phase: 'loading' }
  | { phase: 'error'; error: string }
  | { phase: 'ready'; voices: string[]; defaultVoice: string };

const message = (error: unknown) =>
  error instanceof Error && error.message ? error.message : 'Could not load the voice list.';

export function VoiceSelector({
  hostId,
  settings,
  disabled,
}: {
  hostId: string;
  settings: VoiceSettingsState;
  disabled?: boolean;
}) {
  const fetchVoices = useRpc(getVoices);
  const [catalog, setCatalog] = useState<Catalog>({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setCatalog({ phase: 'loading' });
    fetchVoices({})
      .then((result) => {
        if (!cancelled) setCatalog({ phase: 'ready', ...result });
      })
      .catch((failure) => {
        if (!cancelled) setCatalog({ phase: 'error', error: message(failure) });
      });
    return () => {
      cancelled = true;
    };
    // Keyed to the host so another daemon's catalog never leaks in; useRpc identity is not documented stable.
  }, [hostId, attempt]);

  if (settings.status === 'error' || settings.status === 'invalid') {
    const invalid = settings.status === 'invalid';
    return (
      <SettingsAction
        label="Voice"
        error={settings.error}
        actionLabel={invalid ? 'Reset' : 'Retry'}
        disabled={settings.saving}
        onPress={() => void (invalid ? settings.reset() : settings.reload())}
      />
    );
  }
  if (catalog.phase === 'error') {
    return (
      <SettingsAction
        label="Voice"
        error={catalog.error}
        actionLabel="Retry"
        onPress={() => setAttempt((count) => count + 1)}
      />
    );
  }
  if (settings.status === 'loading' || catalog.phase === 'loading') {
    return <SettingsRow label="Voice" hint="Loading voices…" />;
  }

  const selected = settings.values.voice;
  const unavailable = selected !== '' && !catalog.voices.includes(selected);
  const options = [
    // Plain label: host config can override the catalog's default, so naming a voice here could lie.
    { label: 'Codex default', value: '' },
    ...catalog.voices.map((voice) => ({ label: voiceLabel(voice), value: voice })),
    ...(unavailable ? [{ label: `${voiceLabel(selected)} (unavailable)`, value: selected }] : []),
  ];
  const error =
    settings.saveError ??
    (unavailable ? `The saved voice “${selected}” is not available on this host. Choose another voice.` : null);

  return (
    <SettingsSelect
      label="Voice"
      hint={
        settings.saving
          ? 'Saving…'
          : 'Applies to your next call. “Codex default” inherits the Codex configuration; voice choice does not change the model.'
      }
      error={error}
      value={selected}
      options={options}
      disabled={disabled || settings.saving}
      onValueChange={(voice) => {
        if (settings.saving || voice === selected) return;
        void settings.save({ ...settings.values, voice }, settings.revision);
      }}
    />
  );
}
