// Pure rules for swapping pets: the old one trots off, the new one drops in, greets, then wanders.
export type Handoff = 'trotOff' | 'drop' | 'greet' | 'wander';
export type HandoffEvent = 'offscreen' | 'landed' | 'greeted';

export const TROT_SPEEDUP = 2;
const MARGIN = 20;

/** Reduced motion skips the trot and the fall: a crossfade swap straight to the greeting. */
export const handoffStart = (calm: boolean): Handoff => (calm ? 'greet' : 'trotOff');

export function handoffNext(p: Handoff, ev: HandoffEvent): Handoff {
  if (p === 'trotOff' && ev === 'offscreen') return 'drop';
  if (p === 'drop' && ev === 'landed') return 'greet';
  if (p === 'greet' && ev === 'greeted') return 'wander';
  return p;
}

/** The nearest screen edge, as an x just past it so the whole sprite is off-screen. */
export const trotTarget = (x: number, w: number, screenW: number): number =>
  x + w / 2 < screenW / 2 ? -w - MARGIN : screenW + MARGIN;

/** Left edge for a sprite centred on cx, kept on screen. */
export const dropLeft = (cx: number | undefined, w: number, screenW: number): number =>
  Math.min(Math.max(0, (cx ?? screenW / 2) - w / 2), Math.max(0, screenW - w));
