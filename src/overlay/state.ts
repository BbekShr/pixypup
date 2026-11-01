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
