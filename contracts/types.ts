/** Free text, 1 to 30 characters: letters, spaces and hyphens ("husky", "monarch butterfly"). */
export type Species = string;

export type Locomotion = 'quadruped' | 'biped' | 'hop' | 'fly' | 'slither' | 'roll';
export type CycleKind = 'walk' | 'flap' | 'hop' | 'undulate' | 'spin';
export type Fidget = 'groom' | 'knead' | 'flutter' | 'wave' | 'phone' | 'preen' | 'hover' | 'bob';
export type RoleName = 'rest' | 'sleep' | 'voice' | 'trick';

export interface RoleDef {
  /** At most 16 characters: the menu label. */
  label: string;
  /** At most 200 characters: the pose, wrapped by STYLE. */
  prompt: string;
  /** At most 12 characters. */
  bubble?: string;
}

/** How this creature moves, idles and what it does for the fixed roles. All numbers are clamped on read. */
export interface MotionProfile {
  locomotion: Locomotion;
  subject: string;
  styleHints: string;
  gait: {
    cadenceHz: number;
    /** Body widths travelled per full cycle. */
    strideBody: number;
    /** Vertical bob, in body heights. */
    bounce: number;
    pitchDeg: number;
    /** Cruise speed, body widths per second. */
    speedBody: number;
  };
  /** Required when locomotion is 'fly'. Heights are in body heights above the floor. */
  air?: { minLiftBody: number; maxLiftBody: number; flutterHz: number; perches: boolean; sway: number };
  cycle: { kind: CycleKind; prompt: string };
  idlePrompt: string;
  /** 2 to 5. */
  fidgets: Fidget[];
  roles: Record<RoleName, RoleDef>;
  energy: string;
}

export interface PoseDef {
  frames: string[];
  fps: number;
  /** Fraction (0..1) of the frame height, from the top, where the paws touch the floor. */
  footY: number;
  /** The model that reviewed the drawn frames and picked them (walk only). A judged walk plays as drawn; an unjudged dog or cat walk is replaced by the baked leg rig. */
  judge?: string;
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
  profile?: MotionProfile;
  /** Optional 'turn': 5 stills in order front, front three-quarter (facing right), right side, back three-quarter, back. */
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
