export const DISPLAY_H = 140;

/** Distance from the sprite's top to its paws; the sprite is placed so this line sits on the window bottom. */
export const footOffset = (displayH: number, footY: number): number => displayH * footY;

export const displayWidth = (naturalW: number, naturalH: number, displayH = DISPLAY_H): number =>
  (naturalW * displayH) / naturalH;

/** Headroom so antialiased paws and sub-pixel rounding never clip at the window bottom. */
export const FLOOR_PAD = 1;

/** Lowest-painted rows' leftmost/rightmost opaque x as signed fractions of the frame width from its centre, over the bottom `band` of the footY line. */
export function contactExtents(alpha: ArrayLike<number>, w: number, h: number, footY: number, band = 0.04): [number, number] {
  const end = Math.min(h, Math.max(1, Math.round(h * footY)));
  let l = w;
  let r = -1;
  for (let y = Math.max(0, end - Math.ceil(h * band)); y < end; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[(y * w + x) * 4]! > 127) { l = Math.min(l, x); r = Math.max(r, x + 1); }
    }
  }
  return r < 0 ? [0, 0] : [l / w - 0.5, r / w - 0.5];
}

/** How far the painted contact points (signed offsets left/right of the pivot, display px) drop below the pivot's floor line when rotated rotDeg about it; sx is the signed horizontal scale (flip included). */
export const contactDrop = (left: number, right: number, sx: number, rotDeg: number): number => {
  const k = sx * Math.sin((rotDeg * Math.PI) / 180);
  return Math.max(0, left * k, right * k);
};
