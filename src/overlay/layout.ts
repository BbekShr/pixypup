export const DISPLAY_H = 140;

/** Distance from the sprite's top to its paws; the sprite is placed so this line sits on the window bottom. */
export const footOffset = (displayH: number, footY: number): number => displayH * footY;

export const displayWidth = (naturalW: number, naturalH: number, displayH = DISPLAY_H): number =>
  (naturalW * displayH) / naturalH;
