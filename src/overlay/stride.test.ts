import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { FALLBACK_STRIDE, strideFromFrames } from './stride';

const W = 200;
const H = 100;
/** A body block plus one planted foot that moves left by `shift` px per frame, like a foot fixed to the ground under an advancing body. */
function sheet(shift: number, n = 4): Uint8Array[] {
  return Array.from({ length: n }, (_, i) => {
    const a = new Uint8Array(W * H);
    for (let y = 20; y < 80; y++) for (let x = 80; x < 120; x++) a[y * W + x] = 255; // body, high above the feet
    for (let y = 94; y < 100; y++) for (let x = 150 - shift * i; x < 160 - shift * i; x++) a[y * W + x] = 255;
    return a;
  });
}

describe('strideFromFrames', () => {
  it('reads the known foot shift off a synthetic sheet', () => {
    expect(strideFromFrames(sheet(20), W, H, 1)).toBe(20);
    expect(strideFromFrames(sheet(30, 3), W, H, 1)).toBe(30);
  });
  it('falls back when no foot lines up', () => {
    const blank = [new Uint8Array(W * H), new Uint8Array(W * H)];
    expect(strideFromFrames(blank, W, H, 1)).toBeCloseTo(FALLBACK_STRIDE * W, 6);
    expect(strideFromFrames([sheet(20)[0]!], W, H, 1)).toBeCloseTo(FALLBACK_STRIDE * W, 6);
    expect(strideFromFrames(sheet(100, 2), W, H, 1)).toBeCloseTo(FALLBACK_STRIDE * W, 6); // beyond 0.4 x width: not a believable stride
  });
  it('gives a plausible stride for the real husky walk frames', async () => {
    const frames = await Promise.all([0, 1, 2, 3].map((n) => sharp(readFileSync(join(__dirname, `__fixtures__/husky-walk/side_${n}.png`))).ensureAlpha().raw().toBuffer({ resolveWithObject: true })));
    const { width, height } = frames[0]!.info;
    const s = strideFromFrames(frames.map((f) => f.data.subarray(3)), width, height, 4);
    expect(s).toBeGreaterThanOrEqual(0.08 * width);
    expect(s).toBeLessThanOrEqual(0.4 * width);
    console.log('husky stride', s, 'of', width, '=', (s / width).toFixed(3));
  });
});
