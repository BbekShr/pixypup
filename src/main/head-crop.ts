// Pure: which square of an idle frame is the face for the menu-bar icon.
export interface Rect { x: number; y: number; width: number; height: number }

const HEAD_SHARE = 0.45; // of the opaque bbox height, from the top
const PAD = 0.08;

/** Square around the head: the top 45% of the opaque bbox, centred on the head, padded 8%, kept inside the image. null = blank frame. */
export function headCrop(alpha: ArrayLike<number>, w: number, h: number, stride = 1): Rect | null {
  const solid = (x: number, y: number): boolean => (alpha[(y * w + x) * stride] ?? 0) > 128;
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) if (solid(x, y)) { if (top < 0) top = y; bottom = y; break; }
  }
  if (top < 0) return null;
  const regionH = Math.max(1, Math.round((bottom - top + 1) * HEAD_SHARE));
  let n = 0;
  let sum = 0;
  for (let y = top; y < top + regionH; y++) for (let x = 0; x < w; x++) if (solid(x, y)) { n++; sum += x; }
  const side = Math.min(w, h, Math.round(regionH * (1 + 2 * PAD)));
  const x = Math.round(Math.min(w - side, Math.max(0, sum / n - side / 2)));
  const y = Math.round(Math.min(h - side, Math.max(0, top - regionH * PAD)));
  return { x, y, width: side, height: side };
}
