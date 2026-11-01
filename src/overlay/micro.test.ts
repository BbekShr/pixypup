import { describe, expect, it } from 'vitest';
import { blinkShut, detectPetting, perkPulse, stretch, wiggle, yawnSy, type Sample } from './micro';

const zig = (xs: number[], dt: number): Sample[] => xs.map((x, i) => ({ x, t: i * dt }));

describe('detectPetting', () => {
  it('needs 3 direction changes', () => {
    expect(detectPetting(zig([0, 20, 0, 20], 100))).toBe(false); // 2 changes
    expect(detectPetting(zig([0, 20, 0, 20, 0], 100))).toBe(true); // 3
  });
  it('ignores a steady sweep and sub-8px jitter', () => {
    expect(detectPetting(zig([0, 10, 20, 30, 40, 50, 60], 100))).toBe(false);
    expect(detectPetting(zig([0, 3, 0, 3, 0, 3, 0, 3], 50))).toBe(false);
  });
  it('only counts the last 1.2 s', () => {
    expect(detectPetting(zig([0, 20, 0, 20, 0], 400))).toBe(false); // spread over 1.6 s: 2 changes in window
    expect(detectPetting(zig([0, 20, 0, 20, 0], 290))).toBe(true);
  });
  it('handles empty input and strokes through x = 0', () => {
    expect(detectPetting([])).toBe(false);
    expect(detectPetting(zig([0, -20, 0, -20, 0], 100))).toBe(true);
  });
});

describe('curves', () => {
  it('are neutral outside their window and bounded inside', () => {
    expect(perkPulse(-1)).toBe(1);
    expect(perkPulse(200)).toBe(1);
    expect(perkPulse(100)).toBeCloseTo(1.04);
    expect(wiggle(400, 400, 3)).toBe(0);
    expect(Math.abs(wiggle(33, 400, 3))).toBeLessThanOrEqual(5);
    expect(yawnSy(0)).toBe(1);
    expect(yawnSy(360)).toBeCloseTo(1.12);
    expect(yawnSy(640)).toBeCloseTo(0.94);
    expect(yawnSy(800)).toBe(1);
    expect(stretch(300).sx).toBeCloseTo(1.08);
    expect(stretch(300).sy).toBeCloseTo(0.92);
    expect(stretch(600)).toEqual({ sx: 1, sy: 1 });
  });
  it('wiggle crosses zero once per half cycle (3 cycles in 400 ms)', () => {
    let flips = 0;
    let prev = 0;
    for (let t = 1; t < 400; t += 1) {
      const w = wiggle(t, 400, 3);
      if (prev !== 0 && Math.sign(w) !== Math.sign(prev)) flips++;
      prev = w;
    }
    expect(flips).toBe(5);
  });
});

describe('blinkShut', () => {
  it('single blink shuts once, double shuts again after a gap', () => {
    expect(blinkShut(50, 120, false)).toBe(true);
    expect(blinkShut(150, 120, false)).toBe(false);
    expect(blinkShut(300, 120, false)).toBe(false);
    expect(blinkShut(150, 120, true)).toBe(false);
    expect(blinkShut(300, 120, true)).toBe(true);
    expect(blinkShut(400, 120, true)).toBe(false);
  });
});
