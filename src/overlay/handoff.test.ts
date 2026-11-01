import { describe, expect, it } from 'vitest';
import { dropLeft, flushCommand, handoffBusy, handoffNext, handoffStart, routeCommand, trotTarget, validCx } from './handoff';

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

describe('hand-off is atomic', () => {
  it('holds a command during trotOff and drop, last one wins, and applies it after the greeting', () => {
    let q: string | null = null;
    for (const p of ['trotOff', 'drop'] as const) {
      expect(handoffBusy(p)).toBe(true);
      const r = routeCommand(p, 'stay', q);
      expect(r.now).toBeNull();
      q = routeCommand(p, 'sit', r.queued).queued;
      expect(flushCommand(p, q)).toEqual({ now: null, queued: 'sit' });
    }
    expect(flushCommand('greet', q)).toEqual({ now: 'sit', queued: null });
  });
  it('runs commands straight away outside the busy phases', () => {
    expect(routeCommand('wander', 'bed', null)).toEqual({ now: 'bed', queued: null });
    expect(routeCommand(null, 'bed', null).now).toBe('bed');
    expect(handoffBusy('greet')).toBe(false);
  });
  it('ignores a hand-off x that is off this overlay', () => {
    expect(validCx(700, 1440, 300)).toBe(700);
    expect(validCx(-400, 1440, 300)).toBe(300);
    expect(validCx(2900, 1440, 300)).toBe(300);
    expect(validCx(undefined, 1440, 300)).toBe(300);
  });
});
