import { usePaseo, type PluginScreenProps, type PluginSidebarItemProps } from '@getpaseo/plugin/client';
import type { PaseoWorkspace as Workspace } from '@getpaseo/client';
import { SidebarRow } from '@getpaseo/plugin/client/ui';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { VoiceView } from '@/client/panel';

const SEARCH_THRESHOLD = 30;

const displayName = (workspace: Workspace) => workspace.title || workspace.name;
const directory = (workspace: Workspace) => workspace.workspaceDirectory ?? workspace.projectRootPath;
const message = (error: unknown) =>
  error instanceof Error && error.message ? error.message : 'Could not load workspaces.';

export function VoiceSidebarItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="AudioLines"
      active={currentScreen?.screenId === 'codex-voice'}
      onPress={() => openScreen({ screenId: 'codex-voice' })}
    />
  );
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; error: string }
  | { phase: 'ready'; workspaces: Workspace[] };

export function VoiceScreen({ theme, layout, host }: PluginScreenProps) {
  const paseo = usePaseo();
  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  const [selected, setSelected] = useState<Workspace | null>(null);
  const [query, setQuery] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // workspaces.list in SDK 0.14 has no AbortSignal; a cancelled flag drops late responses.
    let cancelled = false;
    // A host change points at another daemon: its workspace ids are unrelated, so drop the selection.
    setSelected(null);
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
  }, [paseo, host.id, attempt]);

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
      selectedBar: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        justifyContent: 'space-between' as const,
        gap: 8,
      },
      selectedName: { color: theme.colors.foreground, fontSize: 14, fontWeight: '600' as const, flexShrink: 1 },
      voice: { flex: 1 },
    };
  }, [theme, layout.compact]);

  if (selected) {
    return (
      <View style={styles.screen}>
        <View style={styles.selectedBar}>
          <Text style={styles.selectedName} numberOfLines={1}>
            {displayName(selected)}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Change workspace (ends call)"
            onPress={() => setSelected(null)}
            style={styles.secondary}
          >
            <Text style={styles.secondaryText}>Change workspace (ends call)</Text>
          </Pressable>
        </View>
        {/* Keyed by host and workspace so switching unmounts VoiceView and ends the call. */}
        <View key={`${host.id}:${selected.id}`} style={styles.voice}>
          <VoiceView theme={theme} layout={layout} workspaceId={selected.id} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Codex Voice</Text>
      <Text style={styles.subtitle}>Choose a workspace to start a voice call.</Text>
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
                    accessibilityLabel={`Use workspace ${displayName(workspace)}`}
                    onPress={() => setSelected(workspace)}
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
