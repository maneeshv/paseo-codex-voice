import { Platform } from 'react-native';

// Browser APIs stay in this module so the plugin can render a supported-platform message on native clients.
interface AudioTrack { enabled: boolean; stop(): void; onended: (() => void) | null; }
interface AudioStream { getTracks(): AudioTrack[]; getAudioTracks(): AudioTrack[]; }
interface Description { type: 'offer' | 'answer'; sdp?: string; }
interface Peer {
  connectionState: string; iceGatheringState: string; localDescription: Description | null;
  ontrack: ((event: { streams: AudioStream[]; track: AudioTrack }) => void) | null;
  onconnectionstatechange: (() => void) | null;
  addTrack(track: AudioTrack, stream: AudioStream): void;
  createDataChannel(name: string): { close(): void };
  createOffer(): Promise<Description>;
  setLocalDescription(description: Description): Promise<void>;
  setRemoteDescription(description: Description): Promise<void>;
  addEventListener(name: string, callback: () => void): void;
  removeEventListener(name: string, callback: () => void): void;
  close(): void;
}
interface AudioPlayer { autoplay: boolean; srcObject: AudioStream | null; play(): Promise<void>; pause(): void; }
interface VoiceBrowser {
  navigator?: { mediaDevices?: { getUserMedia(constraints: unknown): Promise<AudioStream> } };
  RTCPeerConnection?: new () => Peer;
  MediaStream?: new (tracks: AudioTrack[]) => AudioStream;
  Audio?: new () => AudioPlayer;
}
export type VoicePeer = {
  offerSdp: string;
  acceptAnswer(sdp: string): Promise<void>;
  setMuted(muted: boolean): void;
  close(): void;
};
const browser = () => globalThis as unknown as VoiceBrowser;
export function isVoiceSupported(): boolean {
  const env = browser();
  return Platform.OS === 'web' && !!(env.navigator?.mediaDevices?.getUserMedia && env.RTCPeerConnection && env.Audio && env.MediaStream);
}
export async function createVoicePeer(options: { signal: AbortSignal; onFailure(message: string): void }): Promise<VoicePeer> {
  if (!isVoiceSupported()) throw new Error('Voice requires Paseo desktop or a browser with microphone access.');
  const { signal, onFailure } = options;
  const env = browser();
  const peer = new env.RTCPeerConnection!();
  const audio = new env.Audio!();
  audio.autoplay = true;
  const channel = peer.createDataChannel('oai-events');
  let stream: AudioStream | undefined;
  let closed = false;
  let disconnectTimer: ReturnType<typeof setTimeout> | undefined;
  const close = () => {
    if (closed) return;
    closed = true;
    signal.removeEventListener('abort', close);
    clearTimeout(disconnectTimer);
    for (const track of stream?.getTracks() ?? []) { track.onended = null; track.stop(); }
    peer.ontrack = null; peer.onconnectionstatechange = null;
    channel.close(); peer.close(); audio.pause(); audio.srcObject = null;
  };
  const fail = (message: string) => { if (!closed) { close(); onFailure(message); } };
  signal.addEventListener('abort', close, { once: true });
  peer.ontrack = (event) => {
    if (closed) return;
    audio.srcObject = event.streams[0] ?? new env.MediaStream!([event.track]);
    void audio.play().catch(() => fail('Audio playback was blocked. End the call and press Start voice again.'));
  };
  peer.onconnectionstatechange = () => {
    clearTimeout(disconnectTimer);
    if (peer.connectionState === 'failed') fail('Voice connection failed. Check your network and retry.');
    else if (peer.connectionState === 'disconnected') disconnectTimer = setTimeout(() => fail('Voice connection was lost. Please reconnect.'), 8000);
  };
  try {
    if (signal.aborted) throw new Error('Voice connection cancelled.');
    stream = await env.navigator!.mediaDevices!.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    // Permission can resolve after the user cancels; release the newly acquired stream too.
    if (signal.aborted || closed) { stream.getTracks().forEach((track) => track.stop()); throw new Error('Voice connection cancelled.'); }
    for (const track of stream.getAudioTracks()) { track.onended = () => fail('Microphone disconnected. Check microphone access and retry.'); peer.addTrack(track, stream); }
    await peer.setLocalDescription(await peer.createOffer());
    await new Promise<void>((resolve, reject) => {
      const done = () => { clearTimeout(timeout); peer.removeEventListener('icegatheringstatechange', changed); signal.removeEventListener('abort', aborted); resolve(); };
      const changed = () => { if (peer.iceGatheringState === 'complete') done(); };
      const aborted = () => { clearTimeout(timeout); peer.removeEventListener('icegatheringstatechange', changed); signal.removeEventListener('abort', aborted); reject(new Error('Voice connection cancelled.')); };
      const timeout = setTimeout(done, 2500);
      peer.addEventListener('icegatheringstatechange', changed);
      signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) aborted(); else changed();
    });
    if (signal.aborted || closed) throw new Error('Voice connection cancelled.');
    const offerSdp = peer.localDescription?.sdp;
    if (!offerSdp) throw new Error('Could not create an audio connection.');
    return {
      offerSdp,
      async acceptAnswer(sdp) {
        if (closed) throw new Error('Voice connection cancelled.');
        await peer.setRemoteDescription({ type: 'answer', sdp });
        await new Promise<void>((resolve, reject) => {
          const finish = (error?: Error) => {
            clearTimeout(timer); peer.removeEventListener('connectionstatechange', changed);
            signal.removeEventListener('abort', aborted);
            if (error) reject(error); else resolve();
          };
          const changed = () => {
            if (peer.connectionState === 'connected') finish();
            else if (peer.connectionState === 'failed' || peer.connectionState === 'closed') finish(new Error('Voice audio connection failed. Please retry.'));
          };
          const aborted = () => finish(new Error('Voice connection cancelled.'));
          const timer = setTimeout(() => finish(new Error('Voice audio connection timed out. Check your network and retry.')), 20000);
          peer.addEventListener('connectionstatechange', changed);
          signal.addEventListener('abort', aborted, { once: true });
          if (signal.aborted) aborted(); else changed();
        });
      },
      setMuted(muted) { for (const track of stream?.getAudioTracks() ?? []) track.enabled = !muted; },
      close,
    };
  } catch (error) {
    close();
    const name = error instanceof Error ? error.name : '';
    if (name === 'NotAllowedError') throw new Error('Microphone access was denied. Allow Paseo in System Settings → Privacy & Security → Microphone, then retry.');
    if (name === 'NotFoundError') throw new Error('No microphone was found. Connect a microphone and retry.');
    throw error;
  }
}
