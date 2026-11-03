import { useRpc, type PluginScreenProps } from '@getpaseo/plugin/client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { voiceLabel } from '@/client/voice-selector';
import { listVoiceSessions, stopVoice, type ActiveVoiceSession } from '@/shared/contracts';

const POLL_MS = 1500;

const message = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

type SessionsState = {
  /** null means unknown: nothing fetched for this host yet. Distinct from "no active calls". */
  sessions: ActiveVoiceSession[] | null;
  error: string | null;
};

export function useActiveSessions(hostId: string): SessionsState & { refresh(): void } {
  const list = useRpc(listVoiceSessions);
  const [state, setState] = useState<SessionsState>({ sessions: null, error: null });
  const [tick, setTick] = useState(0);
  const hostRef = useRef(hostId);

  useEffect(() => {
    if (hostRef.current !== hostId) {
      // Another daemon: its session ids and counts are unrelated, so drop to unknown.
      hostRef.current = hostId;
      setState({ sessions: null, error: null });
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Non-overlapping poll: the next request is scheduled only after the previous one settles.
    const run = async () => {
      try {
        const { sessions } = await list({});
        if (cancelled) return;
        setState({ sessions, error: null });
      } catch (failure) {
        if (cancelled) return;
        // Back to unknown: keeping the previous list would show stale "Live" rows under an error.
        setState({ sessions: null, error: message(failure, 'Could not check active voice calls.') });
      }
      if (!cancelled) timer = setTimeout(() => void run(), POLL_MS);
    };
    void run();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
    // `list` is intentionally omitted: a host change re-renders before this effect re-runs,
    // so the closure always holds that host's invoker.
  }, [hostId, tick]);

  return { ...state, refresh: () => setTick((count) => count + 1) };
}

type ActiveSessionsProps = Pick<PluginScreenProps, 'theme' | 'host' | 'navigation'> & {
  /** Show only this call; when it is gone, say so instead of disappearing. */
  sessionId?: string;
  onOpenCall?: (sessionId: string) => void;
};

export function ActiveSessions({ theme, host, navigation, sessionId, onOpenCall }: ActiveSessionsProps) {
  const { sessions, error, refresh } = useActiveSessions(host.id);
  const visible = sessionId && sessions ? sessions.filter((session) => session.sessionId === sessionId) : sessions;
  const ended = sessionId !== undefined && visible !== null && visible.length === 0;
  const stop = useRpc(stopVoice);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [stopError, setStopError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleStop = async (sessionId: string) => {
    if (stoppingId) return;
    setStoppingId(sessionId);
    setStopError(null);
    try {
      await stop({ sessionId });
    } catch (failure) {
      if (mountedRef.current) setStopError(message(failure, 'Could not stop the voice session.'));
    }
    if (mountedRef.current) {
      setStoppingId(null);
      refresh();
    }
  };

  const styles = useMemo(
    () => ({
      box: {
        padding: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        gap: 8,
      },
      heading: { color: theme.colors.foreground, fontSize: 13, fontWeight: '600' as const },
      errorText: { color: theme.colors.statusDanger, fontSize: 13 },
      row: { gap: 4 },
      name: { color: theme.colors.foreground, fontSize: 14, fontWeight: '500' as const },
      detail: { color: theme.colors.foregroundMuted, fontSize: 12 },
      buttons: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, marginTop: 2 },
      button: {
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 8,
        backgroundColor: theme.colors.surface2,
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
      buttonText: { color: theme.colors.foreground, fontSize: 13 },
      dangerText: { color: theme.colors.statusDanger, fontSize: 13 },
      disabled: { opacity: 0.5 },
    }),
    [theme],
  );

  // Unknown or confirmed-empty with no error: the list earns no space on the page.
  // Except when a specific call was asked for: a confirmed-missing call must say it ended.
  if (!error && !stopError && !ended && (visible === null || visible.length === 0)) return null;

  return (
    <View style={styles.box} accessibilityLabel={`Active voice calls on ${host.label}`}>
      <Text style={styles.heading}>Active voice calls · {host.label}</Text>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {stopError ? <Text style={styles.errorText}>{stopError}</Text> : null}
      {ended && !error ? <Text style={styles.detail}>This call has ended or is no longer available.</Text> : null}
      <ScrollView style={{ maxHeight: 220 }} contentContainerStyle={{ gap: 10 }}>
        {(visible ?? []).map((session) => {
          const agentId = session.agentId;
          const role = agentId ? `Thread ${agentId}` : 'Workspace voice coordinator';
          const detail = [
            role,
            session.status === 'live' ? 'Live' : 'Connecting…',
            session.voice ? `Voice: ${voiceLabel(session.voice)}` : null,
            `Started ${new Date(session.createdAt).toLocaleTimeString()}`,
          ]
            .filter(Boolean)
            .join(' · ');
          const stopping = stoppingId === session.sessionId;
          return (
            <View key={session.sessionId} style={styles.row}>
              <Text style={styles.name}>{session.workspaceName}</Text>
              <Text style={styles.detail}>{detail}</Text>
              <View style={styles.buttons}>
                {onOpenCall ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Open call in ${session.workspaceName}`}
                    onPress={() => onOpenCall(session.sessionId)}
                    style={styles.button}
                  >
                    <Text style={styles.buttonText}>Open call</Text>
                  </Pressable>
                ) : null}
                {navigation ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Open workspace ${session.workspaceName}`}
                    onPress={() => navigation.openWorkspace({ workspaceId: session.workspaceId, serverId: host.id })}
                    style={styles.button}
                  >
                    <Text style={styles.buttonText}>Open workspace</Text>
                  </Pressable>
                ) : null}
                {navigation && agentId ? (
                  // session.threadId is an ephemeral Codex thread, not a Paseo agent; only agentId navigates.
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Open thread for ${session.workspaceName}`}
                    onPress={() => navigation.openAgent({ agentId, serverId: host.id })}
                    style={styles.button}
                  >
                    <Text style={styles.buttonText}>Open thread</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Stop voice session in ${session.workspaceName}`}
                  disabled={stoppingId !== null}
                  onPress={() => void handleStop(session.sessionId)}
                  style={[styles.button, stoppingId !== null && styles.disabled]}
                >
                  <Text style={styles.dangerText}>{stopping ? 'Stopping…' : 'Stop voice session'}</Text>
                </Pressable>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}
