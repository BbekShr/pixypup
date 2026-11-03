export const DISPLAY_H = 140;

/** Distance from the sprite's top to its paws; the sprite is placed so this line sits on the window bottom. */
export const footOffset = (displayH: number, footY: number): number => displayH * footY;

export const displayWidth = (naturalW: number, naturalH: number, displayH = DISPLAY_H): number =>
  (naturalW * displayH) / naturalH;

/** Headroom so antialiased paws and sub-pixel rounding never clip at the window bottom. */
export const FLOOR_PAD = 1;

/** A painted foot point: x as a fraction of the frame width from its centre, y as a fraction of the frame height below the footY line (negative = above it). */
export type FootPoint = [number, number];

/** The lowest opaque pixel of each of `bins` columns: the silhouette's underside, which is what meets the floor once the sprite tilts. */
export function footPoints(alpha: ArrayLike<number>, w: number, h: number, footY: number, bins = 48): FootPoint[] {
  const out: FootPoint[] = [];
  for (let b = 0; b < bins; b++) {
    const x0 = Math.floor((b * w) / bins);
    const x1 = Math.max(x0 + 1, Math.floor(((b + 1) * w) / bins));
    let low = -1;
    let lx = 0;
    for (let x = x0; x < x1; x++) {
      for (let y = h - 1; y > low; y--) {
        if (alpha[(y * w + x) * 4]! > 127) { low = y; lx = x; break; }
      }
    }
    if (low >= 0) out.push([(lx + 0.5) / w - 0.5, (low + 1) / h - footY]);
  }
  return out;
}

/**
 * How far to raise the sprite so no painted point ends up lower than the unrotated lowest one. Each point is mapped
 * exactly as CSS does (origin at the footY line on the frame's centre; scale by sx = signed horizontal scale incl. flip
 * and sy, then rotate rotDeg, then the body's own dy), so tilt, stretch, flip and a downward bob are all covered.
 */
export function floorLift(points: readonly FootPoint[], fw: number, h: number, sx: number, sy: number, rotDeg: number, dy: number): number {
  const s = Math.sin((rotDeg * Math.PI) / 180);
  const c = Math.cos((rotDeg * Math.PI) / 180);
  let rest = -Infinity;
  let low = -Infinity;
  for (const [u, v] of points) {
    rest = Math.max(rest, v * h);
    low = Math.max(low, s * u * fw * sx + c * v * h * sy + dy);
  }
  return Math.max(0, low - rest);
}
