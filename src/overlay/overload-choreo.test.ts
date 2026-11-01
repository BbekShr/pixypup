import { describe, expect, it } from 'vitest';
import { calmAlpha, castIndices, castSize, createShow, SHOW_MS, T, waveOrder, type CastMember } from './overload-choreo';

const cast = (n: number, fliers = 0): CastMember[] => Array.from({ length: n }, (_, i) => ({ flier: i < fliers, aspect: 0.8 + (i % 3) * 0.2, air: i < fliers ? { min: 0.6, max: 1.4 } : undefined }));
const DT = 1 / 60;

function run(seed: number, n: number, screenW: number, onTick?: (t: number, s: ReturnType<typeof createShow>) => void) {
  const show = createShow(seed, cast(n, 3), screenW, 900);
  for (let t = 0; t <= SHOW_MS; t += DT * 1000) {
    show.step(t, DT, screenW / 3);
    onTick?.(t, show);
  }
  return show;
}

describe('cast sizing', () => {
  it('is 12..24 of 3x the unique pets', () => {
    expect([1, 2, 5, 10].map(castSize)).toEqual([12, 12, 15, 24]);
    expect(castSize(40)).toBe(24);
  });
  it('fills round-robin so every unique pet appears', () => {
    const c = castIndices(5);
    expect(c).toHaveLength(15);
    expect(new Set(c)).toEqual(new Set([0, 1, 2, 3, 4]));
    expect(castIndices(0)).toEqual([]);
  });
});

describe('choreography', () => {
  it('every sprite drops in inside the first 3 s, about 120 ms apart', () => {
    for (const n of [12, 15, 24]) {
      const at = createShow(7, cast(n), 1440, 900).plans.map((p) => p.dropAt).sort((a, b) => a - b);
      expect(at[0]).toBeGreaterThanOrEqual(0);
      expect(at.at(-1)).toBeLessThan(T.dropEnd);
      expect(at[5]! - at[4]!).toBeGreaterThan(60);
    }
  });
  it('the wave goes by ascending x', () => {
    expect(waveOrder([300, 50, 900, 50, 120])).toEqual([1, 3, 4, 0, 2]);
  });
  it('wave hops are 80 ms apart in x order at the moment the wave starts', () => {
    let xs: number[] = [];
    const show = run(11, 18, 1440, (t, s) => { if (t >= T.wave && xs.length === 0) xs = s.sprites.map((p, i) => p.x + s.plans[i]!.w / 2); });
    const byHop = show.sprites.map((s, i) => i).sort((a, b) => show.sprites[a]!.hopAt - show.sprites[b]!.hopAt);
    const centres = byHop.map((i) => xs[i]!);
    expect(centres).toEqual([...centres].sort((a, b) => a - b));
    expect(show.sprites[byHop[1]!]!.hopAt - show.sprites[byHop[0]!]!.hopAt).toBe(80);
  });
  it('nobody leaves the screen before 20 s once in, and everybody is gone by 25 s', () => {
    for (const w of [1440, 2560]) {
      for (const seed of [1, 2, 3]) {
        const show = run(seed, 24, w, (t, s) => {
          if (t < 4500 || t >= T.exit) return;
          s.sprites.forEach((p, i) => {
            expect(p.gone).toBe(false);
            expect(p.x).toBeGreaterThanOrEqual(0);
            expect(p.x).toBeLessThanOrEqual(w - s.plans[i]!.w + 1e-6);
          });
        });
        expect(show.done).toBe(true);
      }
    }
  });
  it('fliers hold their air band and never fall', () => {
    run(5, 12, 1440, (t, s) => {
      if (t < 4500 || t >= T.exit) return;
      s.sprites.slice(0, 3).forEach((p, i) => { expect(p.lift).toBeLessThan(-0.3 * s.plans[i]!.h); });
      s.sprites.slice(3).forEach((p) => { expect(p.lift).toBeGreaterThanOrEqual(0); });
    });
  });
  it('the same seed gives the same timeline, another seed does not', () => {
    const snap = (seed: number): string => JSON.stringify(run(seed, 15, 1440).sprites.map((s) => [s.x, s.hopAt, s.walked]));
    expect(snap(9)).toBe(snap(9));
    expect(snap(9)).not.toBe(snap(10));
  });
});

describe('calm', () => {
  it('fades in, holds and fades out without ever jumping', () => {
    expect(calmAlpha(0, 500)).toBe(0);
    expect(calmAlpha(1100, 500)).toBe(1);
    expect(calmAlpha(23_000, 500)).toBeLessThan(1);
    expect(calmAlpha(25_000, 500)).toBe(0);
    for (let t = 0; t < 25_000; t += 16) expect(Math.abs(calmAlpha(t + 16, 500) - calmAlpha(t, 500))).toBeLessThan(0.05);
  });
});
