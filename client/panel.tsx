import { useRpc, type PluginAgentPanelProps, type PluginWorkspacePanelProps } from '@getpaseo/plugin/client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { createVoicePeer, isVoiceSupported, type VoicePeer } from '@/client/web';
import { pollVoice, sendText, startVoice, stopVoice, type VoiceEvent } from '@/shared/contracts';

type Phase = 'ready' | 'connecting' | 'live' | 'error';
// Identity object per call so callbacks from an ended call can never touch a newer one.
type Call = { controller: AbortController; peer?: VoicePeer; sessionId?: string };

const MAX_LOG = 200;

function appendEvents(log: readonly VoiceEvent[], events: readonly VoiceEvent[]): VoiceEvent[] {
  const next = [...log];
  for (const event of events) {
    const at = event.itemId ? next.findIndex((row) => row.itemId === event.itemId) : -1;
    if (event.kind === 'transcript' && !event.text) { if (at >= 0) next.splice(at, 1); continue; }
    if (at >= 0) next[at] = event;
    else next.push(event);
  }
  return next.length > MAX_LOG ? next.slice(-MAX_LOG) : next;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

const message = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

type VoiceViewProps = Pick<PluginWorkspacePanelProps, 'theme' | 'layout' | 'workspaceId'> & { agentId?: string };

export function VoiceView({ theme, layout, workspaceId, agentId }: VoiceViewProps) {
  const start = useRpc(startVoice);
  const poll = useRpc(pollVoice);
  const stop = useRpc(stopVoice);
  const send = useRpc(sendText);

  const [phase, setPhase] = useState<Phase>('ready');
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [log, setLog] = useState<VoiceEvent[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const callRef = useRef<Call | null>(null);
  const mountedRef = useRef(true);

  const endCall = (call: Call, failure?: string) => {
    if (callRef.current !== call) return;
    callRef.current = null;
    call.controller.abort(); // closes the peer, microphone, and playback via client/web.ts
    if (call.sessionId) void stop({ sessionId: call.sessionId }).catch(() => {});
    if (!mountedRef.current) return;
    setPhase(failure ? 'error' : 'ready');
    setError(failure ?? null);
    setMuted(false);
    setSending(false);
  };
  const endCallRef = useRef(endCall);
  endCallRef.current = endCall;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const call = callRef.current;
      if (call) endCallRef.current(call);
    };
  }, []);

  const runPoll = async (call: Call, sessionId: string) => {
    let cursor = 0;
    while (callRef.current === call) {
      const page = await poll({ sessionId, after: cursor });
      if (callRef.current !== call) return;
      cursor = page.cursor;
      if (page.events.length && mountedRef.current) setLog((rows) => appendEvents(rows, page.events));
      if (page.status === 'closed') return endCall(call);
      if (page.status === 'error') {
        const detail = page.events.findLast((event) => event.kind === 'error')?.text;
        return endCall(call, detail || 'The voice session ended with an error.');
      }
      if (mountedRef.current) setPhase(page.status === 'live' ? 'live' : 'connecting');
      await wait(800, call.controller.signal);
    }
  };

  const handleStart = async () => {
    if (callRef.current) return;
    const call: Call = { controller: new AbortController() };
    callRef.current = call;
    setPhase('connecting');
    setError(null);
    setLog([]);
    setMuted(false);
    setDraft('');
    try {
      const peer = await createVoicePeer({
        signal: call.controller.signal,
        onFailure: (failure) => endCallRef.current(call, failure),
      });
      call.peer = peer;
      if (callRef.current !== call) return peer.close();
      const started = await start({ workspaceId, agentId, sdp: peer.offerSdp });
      if (callRef.current !== call) {
        // Cancelled while the server was starting: stop the session it returned.
        void stop({ sessionId: started.sessionId }).catch(() => {});
        return;
      }
      call.sessionId = started.sessionId;
      await peer.acceptAnswer(started.answerSdp);
      if (callRef.current !== call) return;
      await runPoll(call, started.sessionId);
    } catch (failure) {
      endCall(call, message(failure, 'Could not start the voice call.'));
    }
  };

  const handleEnd = () => {
    const call = callRef.current;
    if (call) endCall(call);
  };

  const handleMute = () => {
    const call = callRef.current;
    if (!call?.peer) return;
    const next = !muted;
    call.peer.setMuted(next);
    setMuted(next);
  };

  const handleSend = async () => {
    const call = callRef.current;
    const text = draft.trim();
    if (!call?.sessionId || !text || sending) return;
    setSending(true);
    try {
      await send({ sessionId: call.sessionId, text });
      if (callRef.current === call && mountedRef.current) {
        setDraft('');
        setSending(false);
      }
    } catch (failure) {
      endCall(call, message(failure, 'Could not send the instruction.'));
    }
  };

  const styles = useMemo(() => {
    const pad = layout.compact ? 12 : 20;
    return {
      screen: { flex: 1, padding: pad, gap: layout.compact ? 10 : 14, backgroundColor: theme.colors.surface0 },
      title: { color: theme.colors.foreground, fontSize: layout.compact ? 17 : 20, fontWeight: '600' as const },
      subtitle: { color: theme.colors.foregroundMuted, fontSize: 13 },
      statusRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
      statusDot: { width: 8, height: 8, borderRadius: 4 },
      statusText: { color: theme.colors.foregroundMuted, fontSize: 13 },
      controls: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 },
      primary: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, backgroundColor: theme.colors.accent },
      primaryText: { color: theme.colors.accentForeground, fontWeight: '600' as const },
      secondary: {
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 8,
        backgroundColor: theme.colors.surface2,
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
      secondaryText: { color: theme.colors.foreground },
      dangerText: { color: theme.colors.statusDanger },
      errorBox: {
        padding: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      errorText: { color: theme.colors.statusDanger, fontSize: 13 },
      transcript: { flex: 1, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1 },
      transcriptContent: { padding: pad, gap: 8 },
      role: { color: theme.colors.foregroundMuted, fontSize: 11, textTransform: 'uppercase' as const },
      line: { color: theme.colors.foreground, fontSize: 14 },
      meta: { color: theme.colors.foregroundMuted, fontSize: 13 },
      empty: { color: theme.colors.foregroundMuted, fontSize: 13 },
      composer: { flexDirection: 'row' as const, gap: 8, alignItems: 'center' as const },
      input: {
        flex: 1,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
        color: theme.colors.foreground,
        fontSize: 14,
      },
    };
  }, [theme, layout.compact]);

  const supported = isVoiceSupported();
  const callActive = phase === 'connecting' || phase === 'live';
  const canSend = phase === 'live' && draft.trim().length > 0 && !sending;
  const status: Record<Phase, { label: string; color: string }> = {
    ready: { label: 'Ready', color: theme.colors.foregroundMuted },
    connecting: { label: 'Connecting…', color: theme.colors.statusWarning },
    live: { label: 'Live', color: theme.colors.statusSuccess },
    error: { label: 'Error', color: theme.colors.statusDanger },
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Codex Voice</Text>
      <Text style={styles.subtitle}>
        A separate voice coordinator for this workspace. Each call starts a new conversation.
      </Text>
      {supported ? (
        <>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: status[phase].color }]} />
            <Text style={styles.statusText} accessibilityLabel={`Call status: ${status[phase].label}`}>
              {status[phase].label}
            </Text>
          </View>
          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
          <View style={styles.controls}>
            {callActive ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={muted ? 'Unmute microphone' : 'Mute microphone'}
                  onPress={handleMute}
                  style={styles.secondary}
                >
                  <Text style={styles.secondaryText}>{muted ? 'Unmute' : 'Mute'}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="End call"
                  onPress={handleEnd}
                  style={styles.secondary}
                >
                  <Text style={styles.dangerText}>End call</Text>
                </Pressable>
              </>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={phase === 'error' ? 'Retry voice call' : 'Start voice call'}
                onPress={() => void handleStart()}
                style={styles.primary}
              >
                <Text style={styles.primaryText}>{phase === 'error' ? 'Retry' : 'Start voice'}</Text>
              </Pressable>
            )}
          </View>
          <ScrollView style={styles.transcript} contentContainerStyle={styles.transcriptContent}>
            {log.length === 0 ? (
              <Text style={styles.empty}>The transcript appears here once a call starts.</Text>
            ) : (
              log.map((event) => (
                <View key={event.itemId ?? `event-${event.id}`}>
                  {event.kind === 'transcript' ? (
                    <>
                      <Text style={styles.role}>{event.role === 'user' ? 'You' : 'Codex'}</Text>
                      <Text style={styles.line}>{event.text}</Text>
                    </>
                  ) : (
                    <Text style={event.kind === 'error' ? styles.errorText : styles.meta}>
                      {event.kind === 'tool' ? `Tool: ${event.text}` : event.text}
                    </Text>
                  )}
                </View>
              ))
            )}
          </ScrollView>
          {callActive ? (
            <View style={styles.composer}>
              <TextInput
                accessibilityLabel="Type an instruction for Codex"
                value={draft}
                onChangeText={setDraft}
                placeholder="Type an instruction…"
                placeholderTextColor={theme.colors.foregroundMuted}
                editable={!sending}
                onSubmitEditing={() => void handleSend()}
                style={styles.input}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send instruction"
                disabled={!canSend}
                onPress={() => void handleSend()}
                style={[styles.secondary, !canSend && { opacity: 0.5 }]}
              >
                <Text style={styles.secondaryText}>{sending ? 'Sending…' : 'Send'}</Text>
              </Pressable>
            </View>
          ) : null}
        </>
      ) : (
        <Text style={styles.meta}>
          Voice calls need Paseo desktop or a browser with microphone access. Open this workspace there to start a call.
        </Text>
      )}
    </View>
  );
}

export function WorkspaceVoicePanel({ theme, layout, workspaceId }: PluginWorkspacePanelProps) {
  return <VoiceView theme={theme} layout={layout} workspaceId={workspaceId} />;
}

export function AgentVoicePanel({ theme, layout, workspaceId, params }: PluginAgentPanelProps) {
  return <VoiceView theme={theme} layout={layout} workspaceId={workspaceId} agentId={params.agentId} />;
}
