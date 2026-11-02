import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

function fixture(permissionPending = false) {
  let grant!: (stream: unknown) => void;
  const track = { enabled: true, stopped: false, onended: null, stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const channel = { closed: false, close() { this.closed = true; } };
  const audio = { autoplay: false, srcObject: null, paused: false, async play() {}, pause() { this.paused = true; } };
  const peer = {
    connectionState: 'new', iceGatheringState: 'complete', localDescription: null as unknown,
    ontrack: null, onconnectionstatechange: null as (() => void) | null, closed: false, answer: null as unknown,
    addTrack() {}, createDataChannel: () => channel, async createOffer() { return { type: 'offer', sdp: 'test-offer' }; },
    async setLocalDescription(value: unknown) { this.localDescription = value; }, async setRemoteDescription(value: unknown) { this.answer = value; this.connectionState = 'connected'; },
    addEventListener() {}, removeEventListener() {}, close() { this.closed = true; },
  };
  const env = {
    navigator: { mediaDevices: { getUserMedia: () => permissionPending ? new Promise((r) => { grant = r; }) : Promise.resolve(stream) } },
    RTCPeerConnection: function () { return peer; }, Audio: function () { return audio; }, MediaStream: function () { return stream; },
  };
  // Substitute only the host's Platform module; exercise the actual compiled browser implementation.
  const source = readFileSync(resolve('client/web.ts'), 'utf8').replace("import { Platform } from 'react-native';", "const Platform = { OS: 'web' };");
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, any> = {};
  new Function('exports', 'globalThis', 'setTimeout', 'clearTimeout', js)(exports, env, setTimeout, clearTimeout);
  return { exports, peer, audio, channel, track, grant: () => grant(stream) };
}

test('browser voice negotiates, mutes, and releases all media resources', async () => {
  const f = fixture();
  const controller = new AbortController();
  const voice = await f.exports.createVoicePeer({ signal: controller.signal, onFailure: assert.fail });
  assert.equal(voice.offerSdp, 'test-offer');
  await voice.acceptAnswer('test-answer');
  assert.deepEqual(f.peer.answer, { type: 'answer', sdp: 'test-answer' });
  voice.setMuted(true); assert.equal(f.track.enabled, false);
  voice.setMuted(false); assert.equal(f.track.enabled, true);
  voice.close(); voice.close();
  assert.ok(f.track.stopped && f.peer.closed && f.channel.closed && f.audio.paused);
});

test('canceling during microphone permission releases a late stream', async () => {
  const f = fixture(true), controller = new AbortController();
  const pending = f.exports.createVoicePeer({ signal: controller.signal, onFailure: assert.fail });
  controller.abort(); f.grant();
  await assert.rejects(pending, /cancelled/);
  assert.ok(f.track.stopped && f.peer.closed);
});

test('failed WebRTC stops recording and reports an actionable error', async () => {
  const f = fixture(), errors: string[] = [];
  await f.exports.createVoicePeer({ signal: new AbortController().signal, onFailure: (message: string) => errors.push(message) });
  f.peer.connectionState = 'failed'; f.peer.onconnectionstatechange!();
  assert.ok(f.track.stopped && f.peer.closed);
  assert.match(errors[0], /connection failed/);
});
