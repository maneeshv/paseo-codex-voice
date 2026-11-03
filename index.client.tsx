import type { PluginButtonRegistration, PluginClientContext, PluginScreenProps } from '@getpaseo/plugin/client';
import { getCallTarget } from '@/client/call-targets';
import { voicePillButton } from '@/client/live-status';
import { AgentVoicePanel, WorkspaceVoicePanel } from '@/client/panel';
import { VoiceScreen, VoiceSidebarItem } from '@/client/screen';
import { listVoiceSessions, type ActiveVoiceSession } from '@/shared/contracts';

const PILL_POLL_MS = 1500;

export default function contribute(client: PluginClientContext) {
  const lifetime = new AbortController();

  const openSession = async (sessionId: string) => {
    // The management screen can explain an ended call; never silently open a fresh call view.
    const fallback = () => client.openScreen({ screenId: 'codex-voice', params: { sessionId } });
    try {
      const { sessions } = await client.rpc(listVoiceSessions, {});
      if (lifetime.signal.aborted) return;
      if (!sessions.some((session) => session.sessionId === sessionId)) return fallback();
    } catch {
      if (lifetime.signal.aborted) return;
      return fallback();
    }
    const target = getCallTarget(sessionId);
    // No local target means the audio lives in another view or device: manage it, don't re-open it.
    if (!target) return fallback();
    client.openPanel(target.panelId, { workspaceId: target.workspaceId, agentId: target.agentId });
  };

  const ScreenComponent = (props: PluginScreenProps) => (
    <VoiceScreen
      {...props}
      openWorkspaceVoice={(workspaceId) => client.openPanel('codex-voice', { workspaceId })}
      openSession={(sessionId) => void openSession(sessionId)}
    />
  );

  const removers = [
    client.addScreen({ id: 'codex-voice', title: 'Codex Voice', Component: ScreenComponent }),
    client.addSidebarHeaderItem({ id: 'codex-voice', title: 'Codex Voice', Component: VoiceSidebarItem }),
    client.addWorkspacePanel({
      id: 'codex-voice',
      title: 'Codex Voice',
      icon: 'AudioLines',
      Component: WorkspaceVoicePanel,
    }),
    client.addAgentPanel({
      id: 'codex-voice-agent',
      title: 'Codex Voice',
      icon: 'AudioLines',
      Component: AgentVoicePanel,
    }),
    client.addCommandCenterItem({
      id: 'open-codex-voice',
      title: 'Open Codex Voice',
      icon: 'AudioLines',
      keywords: ['voice', 'call', 'codex'],
      context: 'workspace',
      onSelect({ openPanel }) {
        openPanel('codex-voice');
      },
    }),
  ];

  const headers = new Map<string, PluginButtonRegistration>();
  const registerWorkspace = ({ id: workspaceId }: { id: string }) => {
    if (lifetime.signal.aborted || headers.has(workspaceId)) return;
    headers.set(workspaceId, client.addHeaderButton({
      id: 'codex-voice',
      workspaceId,
      button: {
        title: 'Codex Voice', label: 'Codex Voice', icon: 'AudioLines',
        behavior: { kind: 'action', onPress() { client.openPanel('codex-voice', { workspaceId }); } },
      },
    }));
  };
  const removeHeaders = () => {
    for (const button of headers.values()) button.remove();
    headers.clear();
  };
  void client.paseo.workspaces.list({ sync: {}, subscribe: {} }).then(({ subscription }) => {
    // Workspace lists in 0.14 do not accept AbortSignal; release late subscriptions too.
    if (lifetime.signal.aborted) { subscription.release(); return; }
    removers.push(() => subscription.release());
    subscription.subscribe({
      snapshot: ({ entries }) => { removeHeaders(); for (const workspace of entries) registerWorkspace(workspace); },
      update: (message) => {
        if (message.type !== 'workspace_update') return;
        const update = message.payload;
        if (update.kind === 'upsert') return registerWorkspace(update.workspace);
        headers.get(update.id)?.remove();
        headers.delete(update.id);
      },
    });
  }).catch((error) => {
    if (!lifetime.signal.aborted) console.error('Codex Voice workspace observation failed', error);
  });

  // Composer pills reflect existing calls only: eligible agents x polled session inventory.
  const agents = new Map<string, string>(); // agentId -> workspaceId
  const pills = new Map<string, { key: string; registration: PluginButtonRegistration }>();
  let inventory: ActiveVoiceSession[] = [];

  const reconcile = () => {
    if (lifetime.signal.aborted) return;
    for (const [agentId, pill] of pills) {
      if (!agents.has(agentId)) {
        pill.registration.remove();
        pills.delete(agentId);
      }
    }
    for (const [agentId, workspaceId] of agents) {
      // The workspace coordinator (no agentId) belongs to every chat of its workspace;
      // another chat's agent call must not show here.
      const matches = inventory
        .filter((session) => session.workspaceId === workspaceId && (!session.agentId || session.agentId === agentId))
        .sort((a, b) => a.createdAt - b.createdAt);
      const existing = pills.get(agentId);
      if (matches.length === 0) {
        existing?.registration.remove();
        pills.delete(agentId);
        continue;
      }
      const key = matches.map((session) => `${session.sessionId}:${session.status}`).join('|');
      if (existing?.key === key) continue;
      const button = voicePillButton(matches, (sessionId) => void openSession(sessionId));
      if (existing) {
        existing.registration.update(button);
        existing.key = key;
      } else {
        pills.set(agentId, { key, registration: client.addComposerPill({ id: 'codex-voice', workspaceId, agentId, button }) });
      }
    }
  };
  const removePills = () => {
    for (const pill of pills.values()) pill.registration.remove();
    pills.clear();
  };

  // Non-overlapping inventory poll; an error drops the inventory so no stale pill claims a call.
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  const poll = async () => {
    try {
      const { sessions } = await client.rpc(listVoiceSessions, {});
      inventory = sessions;
    } catch {
      inventory = [];
    }
    if (lifetime.signal.aborted) return;
    try {
      reconcile();
    } catch (error) {
      console.error('Codex Voice pill update failed', error);
    } finally {
      if (!lifetime.signal.aborted) pollTimer = setTimeout(() => void poll(), PILL_POLL_MS);
    }
  };
  void poll();

  // Owned list subscription: existing agents arrive in snapshots, changes as updates.
  void client.paseo.agents
    .list({ scope: 'active', sync: {}, subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      subscription.subscribe({
        snapshot: ({ entries }) => {
          agents.clear();
          for (const { agent } of entries) if (agent.workspaceId) agents.set(agent.id, agent.workspaceId);
          reconcile();
        },
        update: (message) => {
          if (message.type !== 'agent_update') return;
          const update = message.payload;
          if (update.kind === 'upsert') {
            if (update.agent.workspaceId) agents.set(update.agent.id, update.agent.workspaceId);
            else agents.delete(update.agent.id);
          } else {
            agents.delete(update.agentId);
          }
          reconcile();
        },
      });
      return undefined;
    })
    .catch((error) => {
      if (!lifetime.signal.aborted) console.error('Codex Voice agent observation failed', error);
    });

  return () => {
    lifetime.abort();
    if (pollTimer !== undefined) clearTimeout(pollTimer);
    removePills();
    removeHeaders();
    for (const remove of removers) remove();
  };
}
