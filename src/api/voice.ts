// Realtime speech-to-text over WebSocket. Network entry for voice: callers use openVoice (gated).
// Doc quotes (https://dev.meta.ai/docs/api-reference/voice/realtime.md, https://dev.meta.ai/docs/speech-to-text.md):
// - "send the handshake as the first JSON text frame within 10 seconds ... This endpoint does not read the
//   HTTP Authorization header; the credential travels in the handshake."
// - "Send raw PCM: signed 16-bit little-endian, mono. PCM_24KHZ: 24 kHz and 48,000 bytes per second ...
//   Pace frames at approximately real time." (80 ms per frame in the reference clients.)
// - "Wait for the handshake acknowledgement before sending audio." The ack is `{sessionId}` with no `type`.
// - PUSH_TO_TALK: "Single-turn transcription"; completion is "A transcript event with final: true".
// - "keywords: array of string ... Biasing does not guarantee an exact spelling." Set in the handshake only.
// - "Send {"type":"endStream"} ... Closing the socket instead also ends input, but can discard pending events."
// - Close codes: 1000 normal; 1008 invalid request / pacing; 1011 backend (retry; "Max session duration
//   reached" -> new session); 1013 rate limited. Sessions last up to 60 minutes.
// - "Ignore unknown event types." Error events are not forwarded: only the close code and a short reason are.
import { openClient } from './gate.js';

const URL = 'wss://api.meta.ai/v1/asr/realtime';
const MODEL = 'muse-voice-transcribe-1.0';
const FRAME_MS = 80;
const FRAME_BYTES = (24000 * 2 * FRAME_MS) / 1000;
const HANDSHAKE_TIMEOUT_MS = 10_000;
const END_TIMEOUT_MS = 4000;
const MAX_QUEUE_BYTES = 6 * 48000;
export const COMMAND_KEYWORDS = ['sit', 'roll over', 'go to bed', 'come here', 'bark', 'nap'];

export class VoiceError extends Error {
  constructor(
    readonly code: number,
    reason = '',
  ) {
    super(`Voice ${code}${reason ? `: ${reason.slice(0, 60)}` : ''}`);
    this.name = 'VoiceError';
  }
}

export interface TranscriptEvent {
  text: string;
  final: boolean;
}

export interface VoiceOptions {
  apiKey: string;
  keywords?: string[];
  onTranscript: (t: TranscriptEvent) => void;
  onError: (e: VoiceError) => void;
  signal?: AbortSignal;
  WebSocketImpl?: typeof WebSocket;
}

export interface Transcription {
  push(pcm: Int16Array | ArrayBuffer): void;
  end(): Promise<void>;
  close(): void;
}

export async function openTranscription(opts: VoiceOptions): Promise<Transcription> {
  if (!opts.apiKey) throw new Error('Meta API key is missing (set MODEL_API_KEY).');
  if (opts.signal?.aborted) throw new VoiceError(0, 'aborted');
  const ws = new (opts.WebSocketImpl ?? WebSocket)(URL);
  const keywords = [...new Set([...(opts.keywords ?? []), ...COMMAND_KEYWORDS])];

  const chunks: Uint8Array[] = [];
  let queued = 0;
  let ending = false;
  let sentEnd = false;
  let closed = false;
  // One 80 ms frame per tick: never faster than real time. The tail frame may be shorter.
  const timer = setInterval(() => {
    if (closed) return;
    if (queued) {
      const frame = new Uint8Array(Math.min(FRAME_BYTES, queued));
      for (let n = 0; n < frame.length; ) {
        const c = chunks[0];
        const take = Math.min(c.length, frame.length - n);
        frame.set(c.subarray(0, take), n);
        n += take;
        if (take === c.length) chunks.shift();
        else chunks[0] = c.subarray(take);
      }
      queued -= frame.length;
      ws.send(frame);
    } else if (ending && !sentEnd) {
      sentEnd = true;
      ws.send(JSON.stringify({ type: 'endStream' }));
      clearInterval(timer);
    }
  }, FRAME_MS);

  let finish: (() => void) | undefined;
  const done = new Promise<void>((r) => (finish = r));

  const close = () => {
    clearInterval(timer);
    if (closed) return;
    closed = true;
    try {
      ws.close(1000);
    } catch {
      /* already closing */
    }
    finish?.();
  };

  await new Promise<void>((resolve, reject) => {
    let acked = false;
    const to = setTimeout(() => fail(new VoiceError(0, 'handshake timeout')), HANDSHAKE_TIMEOUT_MS);
    // Attached before the ack: an abort mid-handshake must close a socket that already carries the key.
    opts.signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(to);
        if (!acked) reject(new VoiceError(0, 'aborted'));
        close();
      },
      { once: true },
    );
    const fail = (e: VoiceError) => {
      clearTimeout(to);
      if (!acked) reject(e);
      else if (!closed && e.code !== 1000) opts.onError(e);
      close();
    };
    ws.onopen = () =>
      ws.send(
        JSON.stringify({
          authorization: { accessToken: `Bearer ${opts.apiKey}` },
          audioEncoding: 'PCM_24KHZ',
          model: MODEL,
          mode: 'PUSH_TO_TALK',
          keywords,
        }),
      );
    ws.onerror = () => {
      if (!acked) fail(new VoiceError(0, 'connection error')); // after the ack, onclose carries the real code
    };
    ws.onclose = (ev) => fail(new VoiceError(ev.code, ev.reason));
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      let m: { type?: string; sessionId?: string; transcript?: string; final?: boolean };
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!acked && m.type === undefined && m.sessionId) {
        acked = true;
        clearTimeout(to);
        resolve();
      } else if (m.type === 'transcript' && typeof m.transcript === 'string') {
        opts.onTranscript({ text: m.transcript, final: m.final === true });
        if (m.final === true && sentEnd) close();
      }
    };
  });

  return {
    push(pcm) {
      if (ending || closed) return;
      const b = pcm instanceof ArrayBuffer ? new Uint8Array(pcm) : new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
      const room = MAX_QUEUE_BYTES - queued; // overflow is dropped, keeping the head of the utterance
      if (room <= 0) return;
      chunks.push(b.length > room ? b.slice(0, room) : b.slice());
      queued += Math.min(b.length, room);
    },
    async end() {
      ending = true;
      const to = setTimeout(close, END_TIMEOUT_MS + queued / 48); // queued audio drains at real time first
      await done;
      clearTimeout(to);
    },
    close,
  };
}

// The gate throws NetworkBlockedError when voice is off (or offline): no socket is ever created then.
export async function openVoice(settings: Parameters<typeof openClient>[1], apiKey: string, opts: Omit<VoiceOptions, 'apiKey'>) {
  openClient('voice', settings, apiKey);
  return openTranscription({ ...opts, apiKey });
}
