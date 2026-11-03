import type { PluginButton, PluginButtonIconProps } from '@getpaseo/plugin/client';
import { Icon } from '@getpaseo/plugin/client/ui';
import { View } from 'react-native';
import { voiceLabel } from '@/client/voice-selector';
import type { ActiveVoiceSession } from '@/shared/contracts';

/** AudioLines with a status dot tucked into the bottom-right corner, all inside the icon's box. */
function makePillIcon(status: 'live' | 'connecting') {
  return function VoicePillIcon({ size, color, theme }: PluginButtonIconProps) {
    const dot = Math.max(5, Math.round(size * 0.375));
    return (
      <View style={{ width: size, height: size }}>
        <Icon name="AudioLines" size={size} color={color} />
        <View
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: dot,
            height: dot,
            borderRadius: dot / 2,
            backgroundColor: status === 'live' ? theme.colors.statusSuccess : theme.colors.statusWarning,
          }}
        />
      </View>
    );
  };
}
const LivePillIcon = makePillIcon('live');
const ConnectingPillIcon = makePillIcon('connecting');

const menuTitle = (session: ActiveVoiceSession) =>
  [
    session.agentId ? 'Thread call' : 'Workspace call',
    session.voice ? voiceLabel(session.voice) : null,
    `started ${new Date(session.createdAt).toLocaleTimeString()}`,
  ]
    .filter(Boolean)
    .join(' · ');

/** Pill for calls that already exist; it never starts one. Pass sessions sorted by createdAt. */
export function voicePillButton(
  sessions: readonly ActiveVoiceSession[],
  openSession: (sessionId: string) => void,
): PluginButton {
  const icon = sessions.some((session) => session.status === 'live') ? LivePillIcon : ConnectingPillIcon;
  if (sessions.length === 1) {
    const session = sessions[0];
    const live = session.status === 'live';
    return {
      // Paseo caps pills at 160px; keep the connecting label short and the full name in its title.
      title: live ? 'Open the live Codex Voice call' : 'A Codex Voice call is connecting',
      label: live ? 'Codex Voice · Live' : 'Voice · Connecting',
      icon,
      behavior: { kind: 'action', onPress: () => openSession(session.sessionId) },
    };
  }
  return {
    title: `Codex Voice · ${sessions.length} active calls`,
    label: `Codex Voice · ${sessions.length}`,
    icon,
    behavior: {
      kind: 'menu',
      items: sessions.map((session) => ({
        kind: 'item' as const,
        id: `call-${session.sessionId}`,
        title: menuTitle(session),
        behavior: { kind: 'action' as const, onPress: () => openSession(session.sessionId) },
      })),
    },
  };
}
