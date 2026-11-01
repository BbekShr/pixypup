// Pure maths for the pet's micro-interactions; overlay.ts feeds it clock values and applies the results.
export interface Sample { x: number; t: number }

export const PET_WINDOW_MS = 1200;
const PET_MIN_STEP = 8; // px a stroke must travel before it counts as a direction change (ignores jitter)
const PET_CHANGES = 3;

/** Back-and-forth cursor strokes: at least 3 direction changes within the last 1.2 s. */
export function detectPetting(samples: Sample[]): boolean {
  const last = samples[samples.length - 1];
  if (!last) return false;
  const xs = samples.filter((s) => last.t - s.t <= PET_WINDOW_MS).map((s) => s.x);
  let dir = 0;
  let ext = xs[0]!;
  let n = 0;
  for (const x of xs) {
    if (dir === 0) {
      if (Math.abs(x - ext) >= PET_MIN_STEP) { dir = Math.sign(x - ext); ext = x; }
    } else if ((x - ext) * dir > 0) ext = x;
    else if ((ext - x) * dir >= PET_MIN_STEP) { dir = -dir; ext = x; n++; }
  }
  return n >= PET_CHANGES;
}

const inside = (t: number, dur: number): boolean => t >= 0 && t < dur;

export const HOVER_TILT_DEG = 6;
export const PERK_PULSE_MS = 200;
export const WIGGLE_MS = 400;
export const CLICK_WIGGLE_MS = 250;
export const YAWN_MS = 800;
export const STRETCH_MS = 600;

/** Ear-perk scale: 1 -> 1.04 -> 1. */
export const perkPulse = (t: number): number => (inside(t, PERK_PULSE_MS) ? 1 + 0.04 * Math.sin((Math.PI * t) / PERK_PULSE_MS) : 1);

/** Happy wiggle in degrees: +-5, `cycles` full swings over `dur`. */
export const wiggle = (t: number, dur: number, cycles: number): number => (inside(t, dur) ? 5 * Math.sin((2 * Math.PI * cycles * t) / dur) : 0);

/** Yawn height scale: 1.0 -> 1.12 -> 0.94 -> 1.0. */
export function yawnSy(t: number): number {
  if (!inside(t, YAWN_MS)) return 1;
  const u = t / YAWN_MS;
  const pts: [number, number][] = [[0, 1], [0.45, 1.12], [0.8, 0.94], [1, 1]];
  const i = Math.max(1, pts.findIndex(([at]) => u <= at));
  const [a, av] = pts[i - 1]!;
  const [b, bv] = pts[i]!;
  return av + ((bv - av) * (u - a)) / (b - a);
}

/** Wake-up stretch: wider and lower, then back. */
export function stretch(t: number): { sx: number; sy: number } {
  if (!inside(t, STRETCH_MS)) return { sx: 1, sy: 1 };
  const k = Math.sin((Math.PI * t) / STRETCH_MS);
  return { sx: 1 + 0.08 * k, sy: 1 - 0.08 * k };
}

export const DOUBLE_BLINK_CHANCE = 0.2;
const BLINK_GAP_MS = 100;

/** Is the eye shut `t` ms after a blink began? A double blink repeats once after a short gap. */
export const blinkShut = (t: number, blinkMs: number, double: boolean): boolean =>
  inside(t, blinkMs) || (double && inside(t - blinkMs - BLINK_GAP_MS, blinkMs));
