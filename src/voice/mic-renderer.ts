// Hidden window. The microphone is held only between mic-start and mic-stop; tracks are stopped right after,
// so the macOS mic indicator goes off. Audio goes to main as 16-bit 24 kHz chunks and is never stored here.
import { downsampleTo24k } from './pcm';

declare global {
  interface Window {
    pixyMic: { onStart(cb: (fake?: ArrayBuffer) => void): void; onStop(cb: () => void): void; chunk(b: ArrayBuffer): void };
  }
}

let stopCapture: (() => void) | null = null;

const FAKE_CHUNK = 1920; // 80 ms of 24 kHz 16-bit

async function capture(): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  // ponytail: ScriptProcessor is deprecated but needs no worklet module file; swap to AudioWorklet if Electron drops it.
  const node = ctx.createScriptProcessor(2048, 1, 1);
  node.onaudioprocess = (e) => window.pixyMic.chunk(downsampleTo24k(e.inputBuffer.getChannelData(0), ctx.sampleRate).buffer as ArrayBuffer);
  src.connect(node);
  node.connect(ctx.destination); // silent: the output buffer is never written
  return () => {
    node.onaudioprocess = null;
    node.disconnect();
    src.disconnect();
    for (const t of stream.getTracks()) t.stop();
    void ctx.close();
  };
}

function streamFake(pcm: ArrayBuffer): () => void {
  let at = 0;
  const timer = setInterval(() => {
    if (at >= pcm.byteLength) return clearInterval(timer);
    window.pixyMic.chunk(pcm.slice(at, at + FAKE_CHUNK));
    at += FAKE_CHUNK;
  }, 80);
  return () => clearInterval(timer);
}

window.pixyMic.onStart((fake) => {
  stopCapture?.();
  let stopped = false;
  stopCapture = () => { stopped = true; };
  if (fake) {
    stopCapture = streamFake(fake);
    return;
  }
  void capture().then(
    (stop) => { if (stopped) stop(); else stopCapture = stop; },
    () => undefined, // permission denied: main's 6 s cap ends the window quietly
  );
});
window.pixyMic.onStop(() => {
  stopCapture?.();
  stopCapture = null;
});
