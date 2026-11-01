export type PetState = 'idle' | 'walk' | 'sit' | 'sleep' | 'bark' | 'roll' | 'sniff' | 'hide';
export type PetEvent = 'idle' | 'walk' | 'dragStart' | 'dragEnd';

// TODO(F2): wire sit/sleep/bark/roll/sniff/hide events.
export function next(state: PetState, event: PetEvent): PetState {
  switch (event) {
    case 'dragStart':
      return 'idle';
    case 'dragEnd':
      return 'walk';
    case 'idle':
      return 'idle';
    case 'walk':
      return 'walk';
  }
}
