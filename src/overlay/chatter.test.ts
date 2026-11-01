import { describe, expect, it } from 'vitest';
import { canSpeak, clickSays, nextSayAt, pickLine, quiet } from './chatter';
import type { PetState } from './state';

describe('chatter schedule', () => {
  it('is due 3 to 6 minutes out', () => {
    expect(nextSayAt(1000, 0, false)).toBe(1000 + 180_000);
    expect(nextSayAt(1000, 0.999999, false)).toBeLessThanOrEqual(1000 + 360_000);
    expect(nextSayAt(1000, 0.999999, false)).toBeGreaterThan(1000 + 359_000);
  });
  it('chatty rehearsal mode is about 5 s', () => {
    expect(nextSayAt(0, 0.7, true)).toBe(5000);
  });
  it('speaks only when idle or sitting and not busy', () => {
    const states: PetState[] = ['idle', 'walk', 'sit', 'sleep', 'bark', 'roll', 'sniff', 'hide', 'drag'];
    expect(states.filter((s) => canSpeak(s, false))).toEqual(['idle', 'sit']);
    expect(states.filter((s) => canSpeak(s, true))).toEqual([]);
  });
});

describe('pickLine', () => {
  const lines = ['a', 'b', 'c'];
  it('never repeats the previous line, for any roll', () => {
    for (const last of lines) for (let r = 0; r < 1; r += 0.01) expect(pickLine(lines, last, r)).not.toBe(last);
  });
  it('reaches every other line', () => {
    expect(new Set([0, 0.5, 0.99].map((r) => pickLine(lines, 'a', r)))).toEqual(new Set(['b', 'c']));
  });
  it('handles one line and none', () => {
    expect(pickLine(['solo'], 'solo', 0.5)).toBe('solo');
    expect(pickLine([], null, 0.5)).toBeNull();
  });
});

describe('clickSays', () => {
  it('is a 25% chance and needs lines', () => {
    expect(clickSays(true, 0.24)).toBe(true);
    expect(clickSays(true, 0.25)).toBe(false);
    expect(clickSays(false, 0)).toBe(false);
  });
});

describe('quiet', () => {
  it('is false while a bubble is up and true once it has ended', () => {
    expect(quiet(1000, 4500)).toBe(false);
    expect(quiet(4500, 4500)).toBe(true);
  });
});
