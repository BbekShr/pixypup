// Pure animation math; overlay.ts feeds it clock values and applies the results as CSS transforms.
export const MAX_SPEED = 90; // px/s
const RAMP_MS = 300;
const HOP_MS = 250;
const HOP_PX = 14;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Eases in over RAMP_MS and out over the last ~RAMP_MS of travel; never 0 so it always arrives. */
export function walkSpeed(sinceStartMs: number, remainingPx: number): number {
  const decelPx = (MAX_SPEED * RAMP_MS) / 2000;
  return Math.max(8, MAX_SPEED * Math.min(1, sinceStartMs / RAMP_MS, remainingPx / decelPx));
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
