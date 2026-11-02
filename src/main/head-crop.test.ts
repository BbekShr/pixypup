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
  it.each(['Pakkun', 'Kuma', 'Mochi'])('%s: the whole face fits, nothing of the pet pokes out on the side it faces', async (p) => {
    const { a, w, h } = await alphaOf(join(__dirname, `../../assets/pets/${p}/idle_0.png`));
    const r = headCrop(a, w, h, 4)!;
    // Bundled pets face right: no opaque pixel in the crop's rows may lie right of it (the old crop cut off the snout).
    for (let y = r.y; y < r.y + r.height; y++) for (let x = r.x + r.width; x < w; x++) expect(a[(y * w + x) * 4]! > 128).toBe(false);
  });
  it('anchors to the left edge for a pet that faces left', () => {
    // 10x10: a tall "head" column on the left, a low "body" to the right.
    const a = new Uint8Array(100);
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) if ((x < 3 && y >= 1) || (y >= 6 && y < 9)) a[y * 10 + x] = 255;
    expect(headCrop(a, 10, 10)!.x).toBe(0);
  });
  it('is null for a blank frame', () => {
    expect(headCrop(new Uint8Array(100), 10, 10)).toBeNull();
  });
});
