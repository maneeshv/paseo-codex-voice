import type { PluginButtonRegistration, PluginClientContext } from '@getpaseo/plugin/client';
import { AgentVoicePanel, WorkspaceVoicePanel } from '@/client/panel';
import { VoiceScreen, VoiceSidebarItem } from '@/client/screen';

export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addScreen({ id: 'codex-voice', title: 'Codex Voice', Component: VoiceScreen }),
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

  const pills = new Map<string, PluginButtonRegistration>();
  const headers = new Map<string, PluginButtonRegistration>();
  const lifetime = new AbortController();
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
  const register = (agent: { id: string; workspaceId?: string | null }) => {
    if (lifetime.signal.aborted || !agent.workspaceId) return;
    const agentId = agent.id;
    const workspaceId = agent.workspaceId;
    pills.get(agentId)?.remove();
    pills.set(
      agentId,
      client.addComposerPill({
        id: 'codex-voice',
        workspaceId,
        agentId,
        button: {
          title: 'Codex Voice',
          icon: 'AudioLines',
          behavior: {
            kind: 'action',
            onPress() {
              client.openPanel('codex-voice-agent', { workspaceId, agentId });
            },
          },
        },
      }),
    );
  };
  const removePills = () => {
    for (const pill of pills.values()) pill.remove();
    pills.clear();
  };

  // Owned list subscription: existing agents arrive in snapshots, changes as updates.
  void client.paseo.agents
    .list({ scope: 'active', sync: {}, subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      subscription.subscribe({
        snapshot: ({ entries }) => {
          removePills();
          for (const { agent } of entries) register(agent);
        },
        update: (message) => {
          if (message.type !== 'agent_update') return;
          const update = message.payload;
          if (update.kind === 'upsert') return register(update.agent);
          pills.get(update.agentId)?.remove();
          pills.delete(update.agentId);
        },
      });
      return undefined;
    })
    .catch((error) => {
      if (!lifetime.signal.aborted) console.error('Codex Voice agent observation failed', error);
    });

  return () => {
    lifetime.abort();
    removePills();
    removeHeaders();
    for (const remove of removers) remove();
  };
}
