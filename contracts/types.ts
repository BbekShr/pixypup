export type Species = 'dog' | 'cat';

export interface PoseDef {
  frames: string[];
  fps: number;
  /** Fraction (0..1) of the frame height, from the top, where the paws touch the floor. */
  footY: number;
}

export interface Personality {
  breed: string;
  coat: string;
  traits: [string, string, string];
  energy: 'sleepy' | 'normal' | 'playful';
  /** 3 to 6 catchphrases, each at most 40 characters, first person. */
  lines: string[];
}

export interface PetFact {
  /** At most 90 characters. */
  text: string;
  /** https URL the search returned. */
  source?: string;
}

export interface SpriteManifest {
  pet: string;
  species: Species;
  poses: Record<string, PoseDef>;
  personality?: Personality & { facts?: PetFact[] };
}

export type BehaviorAction =
  | 'walk_to'
  | 'sniff'
  | 'bark'
  | 'hide'
  | 'idle'
  | 'sleep'
  | 'sit'
  | 'roll'
  | 'perk_up';

export interface BehaviorDecision {
  action: BehaviorAction;
  target?: { x: number; y: number };
  durationMs: number;
  reason: string;
  /** What the pet says, at most 40 characters. */
  bubble?: string;
}
