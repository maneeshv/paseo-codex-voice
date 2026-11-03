type CallTarget = {
  panelId: 'codex-voice' | 'codex-voice-agent';
  workspaceId: string;
  agentId?: string;
};

// Only this app's mounted voice views can supply a resumable panel target.
const targets = new Map<string, CallTarget>();

export function rememberCallTarget(sessionId: string, target: CallTarget): () => void {
  targets.set(sessionId, target);
  return () => { if (targets.get(sessionId) === target) targets.delete(sessionId); };
}

export function getCallTarget(sessionId: string): CallTarget | undefined {
  return targets.get(sessionId);
}
