import { usePaseo, useSettings, type PluginScreenProps, type PluginSidebarItemProps } from '@getpaseo/plugin/client';
import type { PaseoWorkspace as Workspace } from '@getpaseo/client';
import { SidebarRow } from '@getpaseo/plugin/client/ui';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ActiveSessions, useActiveSessions } from '@/client/active-sessions';
import { VoiceSelector } from '@/client/voice-selector';
import { voiceSettings } from '@/shared/contracts';

const SEARCH_THRESHOLD = 30;

const displayName = (workspace: Workspace) => workspace.title || workspace.name;
const directory = (workspace: Workspace) => workspace.workspaceDirectory ?? workspace.projectRootPath;
const message = (error: unknown) =>
  error instanceof Error && error.message ? error.message : 'Could not load workspaces.';

export function VoiceSidebarItem({ theme, host, currentScreen, openScreen }: PluginSidebarItemProps) {
  const { sessions, error } = useActiveSessions(host.id);
  const live = sessions?.filter((session) => session.status === 'live').length ?? 0;
  const connecting = (sessions?.length ?? 0) - live;
  // Mixed statuses spell out both counts so a green dot never claims every call is live.
  const statusText =
    live > 0 && connecting > 0
      ? `${live} Live · ${connecting} Connecting`
      : live > 0
        ? live === 1
          ? 'Live'
          : `${live} Live`
        : connecting === 1
          ? 'Connecting'
          : `${connecting} Connecting`;
  // No trailing claims zero before the first successful poll; errors say the status is unknown.
  const trailing =
    !error && sessions && sessions.length > 0 ? (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: live > 0 ? theme.colors.statusSuccess : theme.colors.statusWarning,
          }}
        />
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{statusText}</Text>
      </View>
    ) : undefined;
  return (
    <SidebarRow
      icon="AudioLines"
      label={error ? 'Codex Voice · status unavailable' : undefined}
      trailing={trailing}
      active={currentScreen?.screenId === 'codex-voice'}
      onPress={() => openScreen({ screenId: 'codex-voice' })}
    />
  );
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; error: string }
  | { phase: 'ready'; workspaces: Workspace[] };

export type VoiceScreenProps = PluginScreenProps & {
  /** Starts (or reveals) the workspace voice panel, which owns the call's audio. */
  openWorkspaceVoice(workspaceId: string): void;
  /** Reveals an existing call's owning panel, or this screen in management mode. */
  openSession(sessionId: string): void;
};

export function VoiceScreen({ theme, layout, host, navigation, params, openWorkspaceVoice, openSession }: VoiceScreenProps) {
  const paseo = usePaseo();
  const settings = useSettings(voiceSettings);
  const managedSessionId = params.sessionId;
  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  const [query, setQuery] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (managedSessionId) return;
    // workspaces.list in SDK 0.14–0.15 has no AbortSignal; a cancelled flag drops late responses.
    let cancelled = false;
    // A host change points at another daemon: its workspace ids are unrelated, so drop the query.
    setQuery('');
    setState({ phase: 'loading' });
    paseo.workspaces
      .list({ sync: {} })
      .then(({ entries }) => {
        if (!cancelled) setState({ phase: 'ready', workspaces: entries });
      })
      .catch((failure) => {
        if (!cancelled) setState({ phase: 'error', error: message(failure) });
      });
    return () => {
      cancelled = true;
    };
  }, [paseo, host.id, attempt, managedSessionId]);

  const workspaces = state.phase === 'ready' ? state.workspaces : [];
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return workspaces;
    return workspaces.filter(
      (workspace) =>
        displayName(workspace).toLowerCase().includes(needle) ||
        directory(workspace).toLowerCase().includes(needle),
    );
  }, [workspaces, query]);

  const styles = useMemo(() => {
    const pad = layout.compact ? 12 : 20;
    return {
      screen: { flex: 1, padding: pad, gap: layout.compact ? 10 : 14, backgroundColor: theme.colors.surface0 },
      title: { color: theme.colors.foreground, fontSize: layout.compact ? 17 : 20, fontWeight: '600' as const },
      subtitle: { color: theme.colors.foregroundMuted, fontSize: 13 },
      muted: { color: theme.colors.foregroundMuted, fontSize: 13 },
      errorBox: {
        padding: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        gap: 8,
      },
      errorText: { color: theme.colors.statusDanger, fontSize: 13 },
      secondary: {
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 8,
        backgroundColor: theme.colors.surface2,
        borderWidth: 1,
        borderColor: theme.colors.border,
        alignSelf: 'flex-start' as const,
      },
      secondaryText: { color: theme.colors.foreground },
      input: {
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
        color: theme.colors.foreground,
        fontSize: 14,
      },
      list: { flex: 1, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1 },
      listContent: { padding: 6 },
      row: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 6, gap: 2 },
      rowName: { color: theme.colors.foreground, fontSize: 14, fontWeight: '500' as const },
      rowDirectory: { color: theme.colors.foregroundMuted, fontSize: 12 },
    };
  }, [theme, layout.compact]);

  if (managedSessionId) {
    // Management-only view of an existing call: status, context, and Stop; never a new call.
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>Codex Voice</Text>
        <Text style={styles.subtitle}>
          This call's microphone and audio stay with the view and device that started it.
        </Text>
        <ActiveSessions
          key={host.id}
          theme={theme}
          host={host}
          navigation={navigation}
          sessionId={managedSessionId}
        />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Codex Voice</Text>
      <Text style={styles.subtitle}>Choose a workspace to start a voice call.</Text>
      <ActiveSessions key={host.id} theme={theme} host={host} navigation={navigation} onOpenCall={openSession} />
      <VoiceSelector hostId={host.id} settings={settings} />
      {state.phase === 'loading' ? <Text style={styles.muted}>Loading workspaces…</Text> : null}
      {state.phase === 'error' ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{state.error}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry loading workspaces"
            onPress={() => setAttempt((count) => count + 1)}
            style={styles.secondary}
          >
            <Text style={styles.secondaryText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
      {state.phase === 'ready' ? (
        workspaces.length === 0 ? (
          <Text style={styles.muted}>No workspaces on this host yet. Create one in Paseo first.</Text>
        ) : (
          <>
            {workspaces.length >= SEARCH_THRESHOLD ? (
              <TextInput
                accessibilityLabel="Search workspaces"
                value={query}
                onChangeText={setQuery}
                placeholder="Search workspaces…"
                placeholderTextColor={theme.colors.foregroundMuted}
                style={styles.input}
              />
            ) : null}
            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
              {filtered.length === 0 ? (
                <Text style={[styles.muted, { padding: 10 }]}>No workspaces match “{query.trim()}”.</Text>
              ) : (
                filtered.map((workspace) => (
                  <Pressable
                    key={workspace.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Start voice in workspace ${displayName(workspace)}`}
                    onPress={() => openWorkspaceVoice(workspace.id)}
                    style={styles.row}
                  >
                    <Text style={styles.rowName}>{displayName(workspace)}</Text>
                    <Text style={styles.rowDirectory} numberOfLines={1}>
                      {directory(workspace)}
                    </Text>
                  </Pressable>
                ))
              )}
            </ScrollView>
          </>
        )
      ) : null}
    </View>
  );
}
