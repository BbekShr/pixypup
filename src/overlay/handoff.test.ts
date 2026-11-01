import { describe, expect, it } from 'vitest';
import { dropLeft, handoffNext, handoffStart, trotTarget } from './handoff';

describe('pet hand-off', () => {
  it('runs trotOff, drop, greet, wander in order', () => {
    let p = handoffStart(false);
    const seen = [p];
    for (const ev of ['offscreen', 'landed', 'greeted'] as const) seen.push((p = handoffNext(p, ev)));
    expect(seen).toEqual(['trotOff', 'drop', 'greet', 'wander']);
  });
  it('ignores events from the wrong phase', () => {
    expect(handoffNext('trotOff', 'landed')).toBe('trotOff');
    expect(handoffNext('drop', 'greeted')).toBe('drop');
    expect(handoffNext('wander', 'offscreen')).toBe('wander');
  });
  it('reduced motion skips the trot and the fall', () => {
    expect(handoffStart(true)).toBe('greet');
  });
  it('trots off the nearer edge, fully past it', () => {
    expect(trotTarget(100, 120, 1440)).toBeLessThan(-120);
    expect(trotTarget(1200, 120, 1440)).toBeGreaterThan(1440);
    expect(trotTarget(659, 120, 1440)).toBeLessThan(0); // sprite centre just left of the middle
  });
  it('drops where the window shrank, kept on screen', () => {
    expect(dropLeft(720, 120, 1440)).toBe(660);
    expect(dropLeft(5, 120, 1440)).toBe(0);
    expect(dropLeft(1439, 120, 1440)).toBe(1320);
    expect(dropLeft(undefined, 120, 1440)).toBe(660);
  });
});
