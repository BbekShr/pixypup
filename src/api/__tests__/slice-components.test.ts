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

describe('grid slicing (2 x 4)', () => {
  const GW = 300;
  const GH = 130;
  const grid = (rects: Rect[]) => {
    const d = Buffer.alloc(GW * GH * 4);
    for (const [x0, y0, x1, y1] of rects)
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) d.set([0, 170, 0, 255], (y * GW + x) * 4);
    return d;
  };
  const bodies = (): Rect[] => Array.from({ length: 8 }, (_, i): Rect => [10 + (i % 4) * 70, 10 + Math.floor(i / 4) * 70, 50 + (i % 4) * 70, 50 + Math.floor(i / 4) * 70]);

  it('returns the 8 frames in reading order, top row then bottom row', () => {
    const rects = bodies();
    rects[1]![2] += 9; // make frame 2 recognisable by width
    rects[4]![2] += 19;
    const crops = sliceComponents(grid(rects), GW, GH, 8, 2)!;
    expect(crops.map((c) => c.width)).toEqual([41, 50, 41, 41, 60, 41, 41, 41]);
  });

  it('keeps a tail tip that crosses a column cut with its own frame', () => {
    // frame 2's tail: detached, x58..78, in the column of frame 1; frame 1's body ends at x50, frame 2 starts at x80
    const crops = sliceComponents(grid([...bodies(), [58, 15, 78, 19]]), GW, GH, 8, 2)!;
    expect(crops[0]!.width).toBe(41);
    expect(crops[1]!.width).toBe(120 - 58 + 1);
  });

  it('returns null when the rows interleave or the bodies are merged', () => {
    const rects = bodies();
    expect(sliceComponents(grid(rects.map((r, i): Rect => (i === 4 ? [r[0], 10, r[2], 50] : r))), GW, GH, 8, 2)).toBeNull();
    expect(sliceComponents(grid([...bodies(), [51, 30, 79, 31]]), GW, GH, 8, 2)).toBeNull();
  });

  it('falls back to a column cut per row when two bodies touch', async () => {
    // rounded bodies (the column cut rejects straight-edged frames); frames 1 and 2 touch at one point, so they fuse into one component
    const d = Buffer.alloc(GW * GH * 4);
    const touching = bodies().map((r, i): Rect => [[25, 76, 150, 220][i] ?? r[0], r[1], [75, 126, 200, 270][i] ?? r[2], r[3]]);
    for (const [x0, y0, x1, y1] of touching)
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const u = (x - (x0 + x1) / 2) / ((x1 - x0) / 2);
          const v = (y - (y0 + y1) / 2) / ((y1 - y0) / 2);
          if (u * u + v * v <= 1) d.set([0, 170, 0, 255], (y * GW + x) * 4);
        }
    expect(sliceComponents(d, GW, GH, 8, 2)).toBeNull();
    const png = await sharp(d, { raw: { width: GW, height: GH, channels: 4 } }).png().toBuffer();
    const frames = await sheetFrames({ png } as never, 8, 2);
    expect(frames).toHaveLength(8);
  });
});
