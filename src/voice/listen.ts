// Pure rules for one push-to-talk listen window. Electron's globalShortcut has no key-up, so a press starts
// a window that ends by itself (silence or time) or on a second press.
export const ACCELERATOR = 'Alt+Space';
export const LISTEN_MS = 4000;
export const CAP_MS = 10_000; // absolute safety cap from the press
export const GRACE_MS = 2000; // after LISTEN_MS from the ack: time for the final transcript
export const SILENCE_MS = 900;
export const SPEECH_RMS = 0.015; // of full scale; room noise after noiseSuppression sits well below
export const MAX_PENDING_BYTES = 288_000; // 6 s of 24 kHz 16-bit
export const MAX_CHUNK_BYTES = 64 * 1024;
export const NEEDS_KEY = 'Needs a key (Make a new pet… to add one)';

export type ListenState = 'idle' | 'listening' | 'thinking';
export type ListenEvent = 'press' | 'silence' | 'timeout' | 'done' | 'error' | 'abort';
export type Effect = 'start' | 'stop' | 'abort' | 'none';

/** timeout = the 4 s window ran out; error also covers the 6 s hard cap. */
export function listenNext(s: ListenState, ev: ListenEvent): { state: ListenState; effect: Effect } {
  if (s === 'idle') return ev === 'press' ? { state: 'listening', effect: 'start' } : { state: 'idle', effect: 'none' };
  if (ev === 'abort' || ev === 'error') return { state: 'idle', effect: 'abort' };
  if (s === 'thinking') return ev === 'done' ? { state: 'idle', effect: 'none' } : { state: 'thinking', effect: 'none' };
  return ev === 'press' || ev === 'silence' || ev === 'timeout' ? { state: 'thinking', effect: 'stop' } : { state: 'listening', effect: 'none' };
}

/** The shortcut exists only while voice is allowed and the pet is awake. */
export const shouldRegister = (s: { voice: boolean; offline: boolean }, snoozed: boolean): boolean => s.voice && !s.offline && !snoozed;

export function syncShortcut(gs: { register(a: string, cb: () => void): boolean; unregister(a: string): void; isRegistered(a: string): boolean }, want: boolean, onPress: () => void): void {
  if (want && !gs.isRegistered(ACCELERATOR)) gs.register(ACCELERATOR, onPress);
  else if (!want && gs.isRegistered(ACCELERATOR)) gs.unregister(ACCELERATOR);
}

/** Chunks arrive from a renderer: only a modest, whole-sample ArrayBuffer is accepted. */
export function validChunk(d: unknown): ArrayBuffer | null {
  return d instanceof ArrayBuffer && d.byteLength > 0 && d.byteLength <= MAX_CHUNK_BYTES && d.byteLength % 2 === 0 ? d : null;
}

const rms = (b: ArrayBuffer): number => {
  const a = new Int16Array(b);
  let s = 0;
  for (const v of a) s += (v / 32768) ** 2;
  return Math.sqrt(s / a.length);
};

/** True once speech has been heard and then SILENCE_MS of quiet followed. Chunks are 24 kHz mono 16-bit: 48 bytes per ms. */
export function createSilenceDetector(): (chunk: ArrayBuffer) => boolean {
  let heard = false;
  let quiet = 0;
  return (chunk) => {
    if (rms(chunk) > SPEECH_RMS) { heard = true; quiet = 0; } else if (heard) quiet += chunk.byteLength / 48;
    return heard && quiet >= SILENCE_MS;
  };
}

export type VoiceMsg = { kind: 'listening' | 'thinking' | 'idle' | 'huh' | 'error' | 'nokey' } | { kind: 'partial'; text: string };
const KINDS = ['listening', 'thinking', 'idle', 'huh', 'error', 'nokey', 'partial'];

/** Main -> overlay. Partial text is a transcript: cut to 30 chars here and shown with textContent only. */
export function parseVoice(raw: unknown): VoiceMsg | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { kind, text } = raw as Record<string, unknown>;
  if (typeof kind !== 'string' || !KINDS.includes(kind)) return null;
  if (kind === 'partial') return typeof text === 'string' ? { kind, text: text.slice(-30) } : null;
  return { kind } as VoiceMsg;
}
