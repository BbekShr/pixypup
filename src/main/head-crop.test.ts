import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { headCrop } from './head-crop';

const alphaOf = async (file: string) => {
  const { data, info } = await sharp(readFileSync(file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { a: data.subarray(3), w: info.width, h: info.height };
};
const topRow = (a: ArrayLike<number>, w: number, h: number): number => {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (a[(y * w + x) * 4]! > 128) return y;
  return -1;
};

describe('headCrop', () => {
  it.each([
    ['husky', join(__dirname, '__fixtures__/husky/idle_0.png')],
    ['Pakkun', join(__dirname, '../../assets/pets/Pakkun/idle_0.png')],
  ])('%s: a square inside the image that holds the top of the silhouette', async (_n, file) => {
    const { a, w, h } = await alphaOf(file);
    const r = headCrop(a, w, h, 4)!;
    expect(r.width).toBe(r.height);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.width).toBeLessThanOrEqual(w);
    expect(r.y + r.height).toBeLessThanOrEqual(h);
    const top = topRow(a, w, h);
    expect(r.y).toBeLessThanOrEqual(top);
    expect(r.y + r.height).toBeGreaterThan(top);
    expect(r.height).toBeLessThan(h * 0.7); // a face, not the whole dog
  });
  it('is null for a blank frame', () => {
    expect(headCrop(new Uint8Array(100), 10, 10)).toBeNull();
  });
});
