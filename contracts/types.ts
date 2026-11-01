export type Species = 'dog' | 'cat';

export interface PoseDef {
  frames: string[];
  fps: number;
  footY: number;
}

export interface SpriteManifest {
  pet: string;
  species: Species;
  poses: Record<string, PoseDef>;
}

export type BehaviorAction =
  | 'walk_to'
  | 'sniff'
  | 'bark'
  | 'hide'
  | 'idle'
  | 'sleep'
  | 'sit'
  | 'roll';

export interface BehaviorDecision {
  action: BehaviorAction;
  target?: { x: number; y: number };
  durationMs: number;
  reason: string;
}
