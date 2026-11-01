export type PetState = 'idle' | 'walk' | 'sit' | 'sleep' | 'bark' | 'roll' | 'sniff' | 'hide' | 'drag';
export type PetEvent = 'idle' | 'walk' | 'sit' | 'sleep' | 'bark' | 'roll' | 'dragStart' | 'dragEnd' | 'click';

export const SLEEP_AFTER_MS = 60_000;

const TRICKS: Partial<Record<PetState, PetState>> = { sit: 'bark', bark: 'roll', roll: 'sit', sleep: 'bark' };

export function next(state: PetState, event: PetEvent): PetState {
  if (event === 'dragStart') return 'drag';
  if (event === 'dragEnd') return 'walk';
  if (state === 'drag') return 'drag'; // drag wins over every other event
  if (event === 'click') return TRICKS[state] ?? 'sit';
  return event;
}

/** How long a state lasts before onTimeout fires; null = until something happens. */
export function dwellMs(state: PetState, rand: number): number | null {
  switch (state) {
    case 'idle': return 3000 + rand * 2000;
    case 'walk': // ends on arrival at its target
    case 'sleep':
    case 'drag': return null;
    default: return 2500;
  }
}

export function onTimeout(state: PetState, rand: number, sinceInteractionMs: number): PetEvent {
  if (state === 'sleep') return 'sleep';
  if (state === 'drag') return 'dragStart';
  if (sinceInteractionMs >= SLEEP_AFTER_MS) return 'sleep';
  if (state === 'walk') return rand < 0.2 ? 'sit' : 'idle';
  return 'walk';
}

/**
 * "Stay here" turns every wander walk into idle. An explicit target (the "come" command) is still
 * obeyed; after arriving the pet stays because its next walk resolves to idle again.
 */
export const resolveWalk = (state: PetState, stay: boolean, explicitTarget: boolean): PetState =>
  state === 'walk' && stay && !explicitTarget ? 'idle' : state;

export const isClick = (distPx: number, ms: number): boolean => distPx < 5 && ms < 300;

/**
 * State after a press ends. A click keeps the trick cycle (and wake-from-sleep) going from the state
 * before the press; anything else, including a lost pointer, ends the drag in a non-drag state.
 */
export const release = (pre: PetState, click: boolean, stay: boolean): PetState =>
  resolveWalk(click ? next(pre, 'click') : next('drag', 'dragEnd'), stay, false);
