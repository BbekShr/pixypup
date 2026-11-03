export const DISPLAY_H = 140;

/** Distance from the sprite's top to its paws; the sprite is placed so this line sits on the window bottom. */
export const footOffset = (displayH: number, footY: number): number => displayH * footY;

export const displayWidth = (naturalW: number, naturalH: number, displayH = DISPLAY_H): number =>
  (naturalW * displayH) / naturalH;

/** Headroom so antialiased paws and sub-pixel rounding never clip at the window bottom. */
export const FLOOR_PAD = 1;

/** How far the far paw drops below the pivot's floor line when the sprite (half-width halfW) rotates about its foot. */
export const rotDrop = (halfW: number, rotDeg: number): number => halfW * Math.sin((Math.abs(rotDeg) * Math.PI) / 180);
