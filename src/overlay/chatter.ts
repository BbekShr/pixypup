import type { PetState } from './state';

export const LINE_MS = 3500;
const MIN_GAP_MS = 3 * 60_000;
const SPAN_MS = 3 * 60_000;
const CLICK_CHANCE = 0.25;

/** When the next spontaneous line is due; `chatty` (dev only) shortens it to ~5 s for rehearsal. */
export const nextSayAt = (now: number, rand: number, chatty: boolean): number => now + (chatty ? 5000 : MIN_GAP_MS + rand * SPAN_MS);

/** Never while walking, sleeping, mid-trick or during the hand-off; only when calm and nothing else is speaking. */
export const canSpeak = (state: PetState, busy: boolean): boolean => !busy && (state === 'idle' || state === 'sit');

/** No second bubble over one that is still showing. */
export const quiet = (now: number, speakingUntil: number): boolean => now >= speakingUntil;

/** A random line that is not the one just said (unless it is the only one). */
export function pickLine(lines: string[], last: string | null, rand: number): string | null {
  const pool = lines.length > 1 ? lines.filter((l) => l !== last) : lines;
  return pool[Math.min(pool.length - 1, Math.floor(rand * pool.length))] ?? null;
}

/** On a click-bark: 25% of the time say a line instead of "Woof!". */
export const clickSays = (hasLines: boolean, rand: number): boolean => hasLines && rand < CLICK_CHANCE;
