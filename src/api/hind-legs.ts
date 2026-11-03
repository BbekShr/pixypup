import sharp from 'sharp';

/** Below this the back legs barely step while the front legs walk (Milo: 0.56; Pakkun, Kuma, Mochi: 0.82-1.04). */
export const MIN_HIND_BALANCE = 0.7;
const LEG_BAND = 0.3; // of the silhouette height, from the lowest paw up
const SOLID = 128;

/**
 * How much the back legs move compared with the front legs over a walk cycle, from frames laid out on one canvas (as
 * layoutFrames returns them, facing right). Each consecutive pair (with the wrap) is compared in the leg band: the share
 * of pixels that change in the tail-side half over the share in the head-side half. ~1 is a real four-legged walk; well
 * below it the hind legs stay tucked under the body. null when the frames can't be compared.
 */
export async function hindLegBalance(pngs: Buffer[]): Promise<number | null> {
  if (pngs.length < 2) return null;
  const frames = await Promise.all(pngs.map((p) => sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true })));
  const { width: w, height: h } = frames[0]!.info;
  if (frames.some((f) => f.info.width !== w || f.info.height !== h)) return null;
  const solid = (a: Buffer, x: number, y: number): boolean => a[(y * w + x) * 4 + 3]! > SOLID;
  let top = h, bottom = -1, left = w, right = -1;
  for (const { data } of frames)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (solid(data, x, y)) {
          top = Math.min(top, y); bottom = Math.max(bottom, y); left = Math.min(left, x); right = Math.max(right, x);
        }
  if (bottom < 0) return null;
  const y0 = Math.round(bottom - (bottom - top) * LEG_BAND);
  const mid = Math.round((left + right) / 2);
  const change = (a: Buffer, b: Buffer, x0: number, x1: number): number => {
    let diff = 0, any = 0;
    for (let y = y0; y <= bottom; y++)
      for (let x = x0; x < x1; x++) {
        const p = solid(a, x, y), q = solid(b, x, y);
        if (p !== q) diff++;
        if (p || q) any++;
      }
    return diff / Math.max(1, any);
  };
  let back = 0, front = 0;
  for (let i = 0; i < frames.length; i++) {
    const a = frames[i]!.data, b = frames[(i + 1) % frames.length]!.data;
    back += change(a, b, left, mid);
    front += change(a, b, mid, right + 1);
  }
  return front > 0 ? back / front : null;
}
