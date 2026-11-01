import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { edgeSlivers } from './frames';

const W = 40;
const H = 20;
const rect = (a: Uint8Array, x0: number, y0: number, x1: number, y1: number): void => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) a[y * W + x] = 255; };

describe('edgeSlivers', () => {
  it('clears a detached sliver on the right edge and nothing else', () => {
    const a = new Uint8Array(W * H);
    rect(a, 8, 4, 28, 16); // body, 240 px
    rect(a, 38, 6, 40, 9); // sliver, 6 px, touches the right edge
    const bad = edgeSlivers(a, W, H);
    expect(bad.sort((p, q) => p - q)).toEqual([6, 7, 8].flatMap((y) => [y * W + 38, y * W + 39]));
  });
  it('keeps a body that touches the edge, and a small blob away from the edges', () => {
    const a = new Uint8Array(W * H);
    rect(a, 20, 2, 40, 18); // body runs to the right edge
    rect(a, 8, 8, 10, 10); // tiny but well inside the frame
    expect(edgeSlivers(a, W, H)).toEqual([]);
  });
  it('keeps a detached tip on an edge the body also touches, drops one on the other edge', () => {
    const a = new Uint8Array(W * H);
    rect(a, 12, 4, 40, 16); // body runs to the right edge
    rect(a, 38, 0, 40, 2); // tip on the right edge: kept
    rect(a, 0, 6, 1, 8); // sliver on the left edge: removed
    expect(edgeSlivers(a, W, H).sort((p, q) => p - q)).toEqual([6 * W, 7 * W]);
  });
  it('reads a strided alpha plane like RGBA data', () => {
    const a = new Uint8Array(W * H);
    rect(a, 8, 4, 28, 16);
    rect(a, 0, 6, 1, 8);
    const rgba = new Uint8Array(W * H * 4);
    a.forEach((v, i) => { rgba[i * 4 + 3] = v; });
    expect(edgeSlivers(rgba.subarray(3), W, H, 4)).toEqual(edgeSlivers(a, W, H));
    expect(edgeSlivers(a, W, H)).toHaveLength(2);
  });
  it('clears a sliver that stops a few px short of the edge (the real pup walk_0: x 285-296 of 304)', () => {
    const a = new Uint8Array(W * H);
    rect(a, 2, 4, 36, 16); // body stops short of both edges
    rect(a, 37, 6, 39, 9); // sliver inside the outer strip (x 37-38), not touching x = 39
    expect(edgeSlivers(a, W, H).sort((p, q) => p - q)).toEqual([6, 7, 8].flatMap((y) => [y * W + 37, y * W + 38]));
  });
  it('finds nothing in the real Pakkun walk frames', async () => {
    for (const n of [0, 1, 2, 3]) {
      const { data, info } = await sharp(readFileSync(join(__dirname, `../../assets/pets/Pakkun/side_${n}.png`))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      expect(edgeSlivers(data.subarray(3), info.width, info.height, 4), `side_${n}`).toEqual([]);
    }
  });
});
