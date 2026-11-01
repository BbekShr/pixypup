import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { GAITS, cycleStrideNat, legBand, legSides, liftAt, tailColumns, tailOffset, puppetSpecies, shearAt, stripRuns } from './puppet';

const W = 120;
const H = 100;
/** Body block rows 20-59, four 6px legs at x 30, 44 (hind pair) and 70, 84 (front pair) down to row 89. */
function dog(): Uint8Array {
  const a = new Uint8Array(W * H);
  for (let y = 20; y < 60; y++) for (let x = 25; x < 95; x++) a[y * W + x] = 255;
  for (let y = 60; y < 90; y++) for (const lx of [30, 44, 70, 84]) for (let x = lx; x < lx + 6; x++) a[y * W + x] = 255;
  return a;
}

describe('legBand', () => {
  it('finds the belly row and the gap between the leg pairs', () => {
    const b = legBand(dog(), W, H, 1)!;
    expect(b.bellyY).toBe(60);
    expect(b.bottom).toBe(89);
    expect(b.splitX).toBeGreaterThan(50);
    expect(b.splitX).toBeLessThan(70);
  });
  it('rejects a body with no separate legs', () => {
    const a = new Uint8Array(W * H);
    for (let y = 20; y < 90; y++) for (let x = 25; x < 95; x++) a[y * W + x] = 255;
    expect(legBand(a, W, H, 1)).toBeNull();
  });
  it('finds a believable belly on the real Pakkun idle', async () => {
    const { data, info } = await sharp(readFileSync(join(__dirname, '../../assets/pets/Pakkun/idle_0.png'))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const b = legBand(data.subarray(3), info.width, info.height, 4)!;
    expect(b).not.toBeNull();
    expect(b.bellyY / info.height).toBeGreaterThanOrEqual(0.7);
    expect(b.bellyY / info.height).toBeLessThanOrEqual(0.85);
    expect(b.splitX).toBeGreaterThan(0.25 * info.width);
    expect(b.splitX).toBeLessThan(0.75 * info.width);
  });
});

describe('shearAt', () => {
  it('is still at the belly and A at the foot', () => {
    expect(shearAt(5, 24, 0, 10, true)).toBeCloseTo(0, 9);
    expect(Math.abs(shearAt(6, 24, 1, 10, true))).toBeCloseTo(10, 9);
  });
  it('puts hind in antiphase and half a cycle opposite, and wraps', () => {
    expect(shearAt(3, 24, 1, 10, false)).toBeCloseTo(-shearAt(3, 24, 1, 10, true), 9);
    expect(shearAt(15, 24, 1, 10, true)).toBeCloseTo(-shearAt(3, 24, 1, 10, true), 9);
    expect(shearAt(24, 24, 1, 10, true)).toBeCloseTo(shearAt(0, 24, 1, 10, true), 9);
  });
});

describe('species and gaits', () => {
  it('maps species', () => {
    expect(puppetSpecies('Dog')).toBe('dog');
    expect(puppetSpecies('puppy')).toBe('dog');
    expect(puppetSpecies('cat')).toBe('cat');
    expect(puppetSpecies('kitten')).toBe('cat');
    expect(puppetSpecies('dragon')).toBeNull();
    for (const bad of ['caterpillar', 'cattle', 'catfish', 'puppet', 'hotdog']) expect(puppetSpecies(bad)).toBeNull();
    expect(puppetSpecies('tabby cat')).toBe('cat');
    expect(puppetSpecies('shiba inu dog')).toBe('dog');
    expect(puppetSpecies(undefined)).toBeNull();
  });
  it('dog and cat gaits differ', () => {
    expect(GAITS.dog).not.toEqual(GAITS.cat);
    expect(GAITS.cat.bounce).toBe(0.6);
  });
  it('a cycle covers four swings so feet do not slide', () => {
    expect(cycleStrideNat(GAITS.dog, 100)).toBeCloseTo(4 * GAITS.dog.swing * 100, 9);
  });
});

describe('liftAt', () => {
  it('is zero at the belly and during stance, max mid-swing', () => {
    expect(liftAt(0, 24, 0, 10, true)).toBe(0);
    expect(liftAt(0, 24, 1, 10, true)).toBeCloseTo(10, 9); // front shear is increasing fastest at k=0
    expect(liftAt(12, 24, 1, 10, true)).toBe(0); // stance half
    expect(liftAt(6, 24, 1, 10, true)).toBeCloseTo(0, 9);
  });
  it('puts front and hind in antiphase', () => {
    for (let k = 0; k < 24; k++) expect(liftAt(k, 24, 1, 10, true) * liftAt(k, 24, 1, 10, false)).toBeCloseTo(0, 9);
    expect(liftAt(12, 24, 1, 10, false)).toBeCloseTo(10, 9);
  });
});

describe('legSides and stripRuns', () => {
  it('gives a leg that crosses splitX one side in every row', () => {
    const w = 60;
    const a = new Uint8Array(w * 10);
    for (let y = 0; y < 5; y++) for (let x = 20; x < 28; x++) a[y * w + x] = 255; // top half left of the split
    for (let y = 5; y < 10; y++) for (let x = 26; x < 36; x++) a[y * w + x] = 255; // bottom half right of it
    for (let y = 0; y < 10; y++) for (let x = 50; x < 56; x++) a[y * w + x] = 255; // a second, front-side leg
    const band = { bellyY: 0, splitX: 30, bottom: 9 };
    const sides = legSides(a, w, 1, band, true);
    const leg = new Set<number>();
    for (let y = 0; y < 10; y++) for (let x = 0; x < 40; x++) if (a[y * w + x]) leg.add(sides[y * w + x]!);
    expect([...leg]).toEqual([2]); // one component, one side (hind: centroid left of the split)
    expect(sides[0 * w + 52]).toBe(1);
    expect(sides[9 * w + 52]).toBe(1);
  });
  it('drops specks and splits runs where the side changes', () => {
    const a = new Uint8Array(30);
    a[3] = 255;
    expect(legSides(a, 30, 1, { bellyY: 0, splitX: 15, bottom: 0 }, true).every((v) => v === 0)).toBe(true);
    expect(stripRuns([0, 2, 2, 1, 1, 0])).toEqual([{ x0: 1, x1: 3, front: false }, { x0: 3, x1: 5, front: true }]);
  });
});

describe('tail', () => {
  const sides = (a: Uint8Array, band: { bellyY: number; splitX: number; bottom: number }): Uint8Array => legSides(a, W, 1, band, true);
  const withTail = (rows: number): Uint8Array => {
    const a = dog();
    for (let y = 20; y < 60; y++) for (let x = 25; x < 30; x++) a[y * W + x] = 0; // body starts at the hind leg
    for (let y = 22; y < 22 + rows; y++) for (let x = 5; x < 23; x++) a[y * W + x] = 255;
    return a;
  };
  it('finds the columns behind the hind leg', () => {
    const a = withTail(10);
    const band = legBand(a, W, H, 1)!;
    const t = tailColumns(a, W, H, 1, sides(a, band), band, true)!;
    expect(t.x0).toBe(0);
    expect(t.x1).toBe(28);
    expect(t.len).toBe(t.root - 5);
  });
  it('skips a region that is tiny', () => {
    const a = withTail(1);
    const band = legBand(a, W, H, 1)!;
    expect(tailColumns(a, W, H, 1, sides(a, band), band, true)).toBeNull();
  });
  it('wags from a fixed root, bounded, looping, differently for dog and cat', () => {
    const len = 20;
    for (const g of [GAITS.dog, GAITS.cat]) {
      expect(tailOffset(7, 24, 0, g, len)).toBeCloseTo(0, 9);
      for (let k = 0; k < 24; k++) expect(Math.abs(tailOffset(k, 24, 1, g, len))).toBeLessThanOrEqual(g.tail.amp * len + 1e-9);
      expect(tailOffset(24, 24, 0.7, g, len)).toBeCloseTo(tailOffset(0, 24, 0.7, g, len), 9);
      expect(Number.isInteger(g.tail.f)).toBe(true);
    }
    expect(tailOffset(3, 24, 1, GAITS.dog, len)).not.toBeCloseTo(tailOffset(3, 24, 1, GAITS.cat, len), 3);
  });
});
