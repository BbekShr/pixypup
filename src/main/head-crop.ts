// Pure: which square of an idle frame is the face for the menu-bar icon and the chat window.
export interface Rect { x: number; y: number; width: number; height: number }

const HEAD_SHARE = 0.5; // side of the square, as a share of the opaque bbox height
const PAD = 0.06;

/**
 * Square in the top corner of the side the pet faces. The head is the highest point (ears, crown), so whichever half of
 * the bbox holds the topmost pixel is the face side; anchoring to that edge keeps the snout, where centring on the top
 * band drifted onto the back and tail. Padded, kept inside the image. null = blank frame.
 */
export function headCrop(alpha: ArrayLike<number>, w: number, h: number, stride = 1): Rect | null {
  const solid = (x: number, y: number): boolean => (alpha[(y * w + x) * stride] ?? 0) > 128;
  let top = -1, bottom = -1, left = w, right = -1, peak = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!solid(x, y)) continue;
      if (top < 0) { top = y; peak = x; }
      bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  if (top < 0) return null;
  const pad = Math.round((bottom - top + 1) * PAD);
  const side = Math.min(w, h, Math.round((bottom - top + 1) * HEAD_SHARE) + 2 * pad);
  const facesRight = peak >= (left + right) / 2;
  const x0 = facesRight ? right + pad + 1 - side : left - pad;
  const x = Math.min(w - side, Math.max(0, x0));
  const y = Math.min(h - side, Math.max(0, top - pad));
  return { x, y, width: side, height: side };
}
