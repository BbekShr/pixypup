// Pure rules for being called ("come here"): where the pet goes and when a command has to wait.
import { dropLeft } from './handoff';

export const HERE_PX = 40; // closer than this to the pointer is already there
export const GREET_MS = 3000;

/** Left edge for a pet w px wide centred on the pointer, kept on screen. No pointer: the screen centre. */
export const comeTarget = (pointerX: number | null, w: number, screenW: number): number => dropLeft(pointerX ?? undefined, w, screenW);

export const alreadyHere = (x: number, w: number, pointerX: number | null, screenW: number): boolean =>
  Math.abs(x + w / 2 - (pointerX ?? screenW / 2)) <= HERE_PX;

/** main -> overlay: the pointer's x in that window's own coordinates. */
export const comeCommand = (cursorScreenX: number, windowX: number): string => `come:${Math.round(cursorScreenX - windowX)}`;

/** The pointer x carried by a come command; null for a bare "come" or anything that isn't one. */
export function comeX(cmd: string): number | null {
  const m = /^come:(-?\d{1,6})$/.exec(cmd);
  return m ? Number(m[1]) : null;
}

export const isCome = (cmd: string): boolean => cmd === 'come' || comeX(cmd) !== null;

/** A command that arrives while the pet is in the air, in someone's hand or mid hop-turn waits its turn; it is never dropped. */
export const commandMustWait = (s: { falling: boolean; dragging: boolean; turning: boolean }): boolean => s.falling || s.dragging || s.turning;
