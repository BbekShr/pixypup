import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { sheetFrames } from '../pose-pipeline.js';
import { sliceComponents } from '../slice-components.js';

const W = 140;
const H = 60;
type Rect = [number, number, number, number];
const sheet = (rects: Rect[]) => {
  const d = Buffer.alloc(W * H * 4);
  for (const [x0, y0, x1, y1] of rects)
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) d.set([0, 170, 0, 255], (y * W + x) * 4);
  return d;
};
const alphaCols = (c: { data: Buffer; width: number; height: number }, row: number) =>
  Array.from({ length: c.width }, (_, x) => c.data[(row * c.width + x) * 4 + 3] as number).filter((a) => a > 0).length;

// Frame 1: x10..50. Frame 2: body x72..125 plus a detached tail tip x56..70 that crosses the column cut at x=70 into frame 1's column.
const tail: Rect = [56, 15, 70, 19];
const tailSheet = () => sheet([[10, 10, 50, 50], [72, 10, 125, 50], tail]);

describe('sliceComponents', () => {
  it('gives the crossing tail tip to its own frame, not the frame whose column it lies in', () => {
    const [a, b] = sliceComponents(tailSheet(), W, H, 2)!;
    expect(a!.width).toBe(41); // no sliver at the leading edge
    expect(b!.width).toBe(125 - 56 + 1); // whole tail kept
    expect(alphaCols(b!, 15 - 10)).toBe(15 + 0 + (125 - 72 + 1)); // the tail row: tail pixels + body pixels
  });

  it('orders frames by x and drops specks', () => {
    const d = sheet([[80, 10, 120, 50], [10, 10, 50, 50], [60, 5, 61, 6]]);
    const [a, b] = sliceComponents(d, W, H, 2)!;
    expect([a!.width, b!.width]).toEqual([41, 41]);
  });

  it('returns null when bodies are merged, so the column cut takes over', () => {
    expect(sliceComponents(sheet([[10, 10, 80, 50], [81, 10, 125, 50]]), W, H, 2)).toBeNull();
    expect(sliceComponents(sheet([[10, 10, 50, 50]]), W, H, 2)).toBeNull();
  });

  it('works through sheetFrames on a PNG', async () => {
    const png = await sharp(tailSheet(), { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
    const [a, b] = await sheetFrames({ png } as never, 2);
    expect((await sharp(a!.png).metadata()).width).toBe(41);
    expect((await sharp(b!.png).metadata()).width).toBe(70);
  });
});
