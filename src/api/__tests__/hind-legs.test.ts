import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { hindLegBalance, MIN_HIND_BALANCE } from '../hind-legs';

const W = 200;
const H = 100;
/** A body with a back paw at x=40+back(i) and a front paw at x=140+front(i), drawn in the bottom band. */
const walk = (back: (i: number) => number, front: (i: number) => number, n = 8): Promise<Buffer[]> =>
  Promise.all(Array.from({ length: n }, (_, i) => {
    const a = Buffer.alloc(W * H * 4);
    const fill = (x0: number, x1: number, y0: number, y1: number) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) a[(y * W + x) * 4 + 3] = 255; };
    fill(30, 170, 20, 70); // body
    fill(40 + back(i), 56 + back(i), 70, 100);
    fill(140 + front(i), 156 + front(i), 70, 100);
    return sharp(a, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
  }));
const swing = (i: number) => Math.round(12 * Math.sin((i / 8) * 2 * Math.PI));

describe('hindLegBalance', () => {
  it('is ~1 when both ends step and ~0 when the back legs stay put', async () => {
    expect(await hindLegBalance(await walk(swing, swing))).toBeCloseTo(1, 1);
    expect(await hindLegBalance(await walk(() => 0, swing))).toBeLessThan(0.1);
  });
  it("can't compare mismatched or single frames", async () => {
    const [a] = await walk(swing, swing, 1);
    const small = await sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
    expect(await hindLegBalance([a!])).toBeNull();
    expect(await hindLegBalance([a!, small])).toBeNull();
  });
  it.each(['Pakkun', 'Kuma', 'Mochi'])('passes the shipped %s walk', async (pet) => {
    const frames = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => readFileSync(join(__dirname, `../../../assets/pets/${pet}/side_${k}.png`)));
    expect(await hindLegBalance(frames)).toBeGreaterThanOrEqual(MIN_HIND_BALANCE);
  });
});
