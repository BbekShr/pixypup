// Pure animation math; overlay.ts feeds it clock values and applies the results as CSS transforms.
export const MAX_SPEED = 90; // px/s
const RAMP_MS = 300;
const HOP_MS = 250;
const HOP_PX = 14;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Eases in over RAMP_MS and out over the last ~RAMP_MS of travel; never 0 so it always arrives. */
export function walkSpeed(sinceStartMs: number, remainingPx: number, max = MAX_SPEED): number {
  const decelPx = (max * RAMP_MS) / 2000;
  return Math.max(8, max * Math.min(1, sinceStartMs / RAMP_MS, remainingPx / decelPx));
}

/** Wander 120-400 px from x, heading back toward home when it has strayed, always inside [0, maxX]. */
export function pickTarget(x: number, maxX: number, home: number, r1: number, r2: number): number {
  let dir = x > home + 200 ? -1 : x < home - 200 ? 1 : r1 < 0.5 ? -1 : 1;
  const dist = 120 + r2 * 280;
  if (x + dir * dist < 0 || x + dir * dist > maxX) dir = -dir;
  return Math.min(maxX, Math.max(0, x + dir * dist));
}

export const LEAN_DEG = 2;

/** Walk frame for the distance travelled: one frame per stride, so feet only move when the body does. */
export const walkFrame = (distancePx: number, frames: number, stridePx: number): number =>
  Math.floor(distancePx / stridePx) % frames;

/** Vertical offset: one hump per stride (= per footfall), 0 whenever a paw is down. */
export function bob(distancePx: number, stridePx: number): number {
  return -4 * Math.sin(Math.PI * ((distancePx / stridePx) % 1));
}

/** Screen-space lean toward the direction of travel (rotate is applied outside the mirror). */
export const lean = (dir: number): number => LEAN_DEG * dir;

export const petTransform = (x: number, y: number, rotDeg: number, flip: number, sx: number, sy: number): string =>
  `translate(${x}px, ${y}px) rotate(${rotDeg}deg) scale(${sx * flip}, ${sy})`;

/** Scale in [1, 1+amp], cycling at hz. */
export const breathe = (nowMs: number, hz: number, amp: number): number =>
  1 + amp * (0.5 - 0.5 * Math.cos(2 * Math.PI * hz * (nowMs / 1000)));

/** Linear recovery from 1-amount to 1 over durMs. */
export const squash = (tMs: number, amount: number, durMs: number): number =>
  1 - amount * (1 - clamp01(tMs / durMs));

/** Up with ease-out, down with ease-in, then a short landing squash. */
export function hop(tMs: number): { dy: number; sy: number } {
  if (tMs >= HOP_MS) return { dy: 0, sy: squash(tMs - HOP_MS, 0.08, 120) };
  const u = tMs / (HOP_MS / 2);
  return { dy: u < 1 ? -HOP_PX * (1 - (1 - u) ** 2) : -HOP_PX * (1 - (u - 1) ** 2), sy: 1 };
}

/** 0 -> 360 degrees over 700 ms, eased. */
export function rollAngle(tMs: number): number {
  const u = clamp01(tMs / 700);
  return 360 * (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) ** 2);
}

const GRAVITY = 2000; // px/s^2
const MAX_FALL = 1400; // px/s
const BOUNCE_PX = 12;
const BOUNCE_MIN_V = 300;

/** One gravity step. lift is the offset from the floor (negative = above it). Bounces once, then settles. */
export function fall(lift: number, vy: number, dt: number): { lift: number; vy: number; impact: boolean; settled: boolean } {
  const v = Math.min(vy + GRAVITY * dt, MAX_FALL);
  const l = lift + v * dt;
  if (l < 0) return { lift: l, vy: v, impact: false, settled: false };
  if (v > BOUNCE_MIN_V) return { lift: 0, vy: -Math.sqrt(2 * GRAVITY * BOUNCE_PX), impact: true, settled: false };
  return { lift: 0, vy: 0, impact: false, settled: true };
}

export const BLINK_MS = 120;

/** Gap before the next idle blink: 3-6 s for r in [0, 1). */
export const blinkDelay = (r: number): number => 3000 + r * 3000;

/**
 * Horizontal centre of the head: mean x of the opaque pixels in the top 30% of the silhouette.
 * Generated poses are bbox-centred, so the head lands up to ~10% of the width apart between frames;
 * shifting each frame by its head offset keeps the face steady across frame swaps (null = blank frame).
 */
export function headX(alpha: ArrayLike<number>, w: number, h: number, stride = 1): number | null {
  const solid = (x: number, y: number): boolean => (alpha[(y * w + x) * stride] ?? 0) > 128;
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!solid(x, y)) continue;
      if (top < 0) top = y;
      bottom = y;
      break;
    }
  }
  if (top < 0) return null;
  const end = top + Math.max(1, Math.round((bottom - top) * 0.3));
  let n = 0;
  let sum = 0;
  for (let y = top; y < end; y++) for (let x = 0; x < w; x++) if (solid(x, y)) { n++; sum += x; }
  return sum / n;
}

/** Share of opaque pixels two same-size frames have in common (intersection over union). */
export function overlap(a: ArrayLike<number>, b: ArrayLike<number>, stride = 1): number {
  let both = 0;
  let either = 0;
  for (let i = 0; i < a.length; i += stride) {
    const p = (a[i] ?? 0) > 128;
    const q = (b[i] ?? 0) > 128;
    if (p && q) both++;
    if (p || q) either++;
  }
  return either ? both / either : 0;
}

export interface Pose { dx: number; dy: number; rot: number; sx: number; sy: number }

/**
 * Per-step body motion for the walk, by distance so it stays locked to the frames: a small squash at each
 * footfall and a stretch mid-stride (volume kept: sx moves half as much the other way), plus a side-to-side rock
 * that changes sign every step. rot is nose-down positive; the caller signs it for the facing.
 * `drawn`: the frames are a real side-on cycle that already draws the legs and body height, so only a light
 * footfall is added; a rock would pitch the long body like a rocking horse.
 */
export function gait(distancePx: number, stridePx: number, drawn = false): Pose {
  const p = distancePx / stridePx;
  const k = drawn ? 0.4 : 1;
  const sy = 1 + k * (0.03 * Math.sin(Math.PI * (p % 1)) - 0.015);
  return { dx: 0, dy: k * bob(distancePx, stridePx), rot: drawn ? 0 : 1.2 * Math.sin(Math.PI * p), sx: 1 - (sy - 1) / 2, sy };
}

const WOOFS = [180, 520]; // two woofs per burst
const WOOF_EVERY = 1400;
const WIND_MS = 90;

/**
 * A bark with one frame: each woof winds up (crouch, nose dips) then pops (chest up, nose up, a nudge forward)
 * and settles with a damped wobble. rot is nose-up positive and dx is forward; the caller signs both for the facing.
 */
export function barkPose(tMs: number): Pose {
  const t = tMs % WOOF_EVERY;
  let k = 0;
  for (const w of WOOFS) {
    const u = t - w;
    if (u >= -WIND_MS && u < 0) k -= 0.4 * Math.sin((Math.PI / 2) * ((u + WIND_MS) / WIND_MS));
    else if (u >= 0 && u < 360) k += Math.exp(-u / 80) * Math.cos((2 * Math.PI * u) / 260);
  }
  return { dx: 3 * k, dy: 0, rot: 5 * k, sx: 1 - 0.03 * k, sy: 1 + 0.06 * k };
}

/** Which burst's first woof has popped by tMs (-1 before the first), so a "Woof!" can land on each pop. */
export const woofBurst = (tMs: number): number => (tMs < WOOFS[0]! ? -1 : Math.floor((tMs - WOOFS[0]!) / WOOF_EVERY));

export const SETTLE_MS = 400;

/** Follow-through when the pose changes: a dip to 0.94, a small overshoot, settled by SETTLE_MS. Returns sy. */
export const settle = (tMs: number): number =>
  tMs < 0 || tMs >= SETTLE_MS ? 1 : 1 - 0.06 * Math.exp(-tMs / 90) * Math.cos((2 * Math.PI * tMs) / 260);

/** 0 -> 1 -> 0 over durMs with eased ends, for fidgets that lean in and back out instead of snapping. */
export const envelope = (tMs: number, durMs: number): number =>
  tMs <= 0 || tMs >= durMs ? 0 : Math.sin((Math.PI * tMs) / durMs) ** 2;
