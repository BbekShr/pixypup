import { TROT_SPEEDUP } from './handoff';

// Pure animation math; overlay.ts feeds it clock values and applies the results as CSS transforms.
export const MAX_SPEED = 90; // px/s
const HOP_MS = 250;
const HOP_PX = 14;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export const WALK_ACCEL = 350; // px/s^2 at MAX_SPEED; scales with vMax so trot and size keep the same feel
const WALK_DECEL = 300; // px/s^2 at MAX_SPEED
const WALK_MIN_V = 8; // px/s; never stalls short of the target

/** One step of the walk speed v (px/s): speeds up at WALK_ACCEL, never above vMax or the speed from which it could still stop in remainingPx. */
export function walkStep(v: number, remainingPx: number, vMax: number, dt: number): number {
  const k = vMax / MAX_SPEED;
  const stop = Math.sqrt(2 * WALK_DECEL * k * Math.max(0, remainingPx));
  return Math.max(WALK_MIN_V, Math.min(v + WALK_ACCEL * k * dt, vMax, stop));
}

export const TURN_FLOOR = 0.12; // never a 0-width sliver

/** Horizontal scale of a turnaround: +1 -> -1 over durMs through a foreshortened head-on moment (sign flips at the midpoint). */
export function turnScale(tMs: number, durMs: number): number {
  const u = clamp01(tMs / durMs);
  const c = Math.cos(Math.PI * u);
  return u < 0.5 ? Math.max(c, TURN_FLOOR) : Math.min(c, -TURN_FLOOR);
}

export interface Mirror { from: 1 | -1; to: 1 | -1; at: number }

/** The drawn facing only ever changes through a turn: a new want starts one, a reversal mid-turn turns back from exactly where it is (turnScale(T-e) = -turnScale(e)). */
export function steer(m: Mirror, want: 1 | -1, now: number, durMs: number): Mirror {
  if (want === m.to) return m;
  const e = now - m.at;
  return e >= durMs ? { from: m.to, to: want, at: now } : { from: m.to, to: m.from, at: now - (durMs - e) };
}

/** Signed horizontal scale of the mirror: sign is the side currently drawn, magnitude the foreshortening. */
export const mirrorScale = (m: Mirror, now: number, durMs: number): number =>
  now - m.at >= durMs ? m.to : m.from * turnScale(now - m.at, durMs);

/** Turn progress 0..1 (1 once done); the side swaps at 0.5. */
export const mirrorProgress = (m: Mirror, now: number, durMs: number): number =>
  now - m.at >= durMs ? 1 : (now - m.at) / durMs;

export const TURN_FRONT = 0;
export const TURN_FRONT34 = 1;
export const TURN_SIDE = 2;

/**
 * A pack with a turnaround ([front, front34, side, ...]) turns through its front view instead of squeezing the side
 * view. idx is the turn frame to draw (TURN_SIDE = keep the normal frame); mirrorFromFacing says which side the mirror
 * shows: the old facing before the apex, the new one after, so the flip happens while the symmetric front is drawn.
 * Symmetric in u <-> 1-u, so a reversal mid-turn stays continuous.
 */
export function turnFrame(u: number): { idx: 0 | 1 | 2; mirrorFromFacing: boolean } {
  const v = Math.min(u, 1 - u);
  return { idx: v < 0.2 ? TURN_SIDE : v < 0.4 ? TURN_FRONT34 : TURN_FRONT, mirrorFromFacing: u < 0.5 };
}

/** The turnaround frames of a pack, or null when it has none worth using (needs front, front34 and side). */
export const usableTurn = (frames: string[] | undefined): string[] | null => (frames && frames.length >= 3 ? frames : null);

/** Hop-turn body for progress u: crouch, an airborne arc (apex at 0.5, where the mirror swaps), landing squash. Symmetric in u <-> 1-u, so a reversal stays continuous. heightPx 0 = crouch only. */
export function hopTurn(u: number, heightPx: number): { dy: number; sx: number; sy: number } {
  const v = Math.min(u, 1 - u);
  if (v < 0.15) {
    const k = Math.sin((Math.PI * v) / 0.15);
    return { dy: 0, sx: 1 + 0.04 * k, sy: 1 - 0.08 * k };
  }
  const a = Math.sin((Math.PI * (v - 0.15)) / 0.7);
  return { dy: -heightPx * a, sx: 1 - 0.02 * a, sy: 1 + 0.04 * a };
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


/** Screen-space pitch (deg) in the direction of travel (rotate is applied outside the mirror): LEAN_DEG at steady speed, forward when speeding up, back when braking. speedFrac is v/vMax, accelFrac is a/WALK_ACCEL. */
export const lean = (dir: number, speedFrac = 1, accelFrac = 0): number =>
  dir * Math.max(-4, Math.min(4, LEAN_DEG * speedFrac + 2 * accelFrac));

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
const RESTITUTION = 0.35; // floor: vy keeps 35% on the bounce
const WALL_RESTITUTION = 0.5;
const BOUNCE_MIN_V = 120; // px/s; slower impacts just stop
const IMPACT_MIN_V = 60; // px/s; below this the touch is not worth reporting
const FLOOR_FRICTION = 0.8; // vx kept per floor impact
const SLIDE_DECEL = 1200; // px/s^2, kinetic friction on the floor
const AIR_DRAG = 0.3; // 1/s
const REST_V = 5; // px/s

export interface Air { x: number; lift: number; vx: number; vy: number }

/** One ballistic step. lift is the offset from the floor (negative = above it); x stays in [0, maxX] and a pet rising past maxUp px bounces off the top (a pet spawned above it is left alone). impact is the floor hit speed (px/s, 0 if none). */
export function airStep(b: Air, dt: number, maxX: number, maxUp: number): Air & { impact: number; settled: boolean } {
  let { x, lift, vx, vy } = b;
  vy = Math.min(vy + GRAVITY * dt, MAX_FALL);
  vx *= Math.exp(-AIR_DRAG * dt);
  x += vx * dt;
  lift += vy * dt;
  if (x < 0 || x > maxX) { x = Math.min(maxX, Math.max(0, x)); vx *= -WALL_RESTITUTION; }
  if (lift < -maxUp && vy < 0) { lift = -maxUp; vy *= -WALL_RESTITUTION; }
  let impact = 0;
  if (lift >= 0) {
    lift = 0;
    if (vy > BOUNCE_MIN_V) { impact = vy; vy *= -RESTITUTION; vx *= FLOOR_FRICTION; }
    else { if (vy > IMPACT_MIN_V) impact = vy; vy = 0; }
    if (vy === 0) {
      const d = SLIDE_DECEL * dt;
      vx = Math.abs(vx) <= Math.max(d, REST_V) ? 0 : vx - Math.sign(vx) * d;
    }
  }
  return { x, lift, vx, vy, impact, settled: lift === 0 && vy === 0 && vx === 0 };
}

/** Translation that makes a rotation of deg about the origin act as a rotation about the point q (px from the origin, screen space). */
export function pivotShift(qx: number, qy: number, deg: number): { dx: number; dy: number } {
  const c = Math.cos((deg * Math.PI) / 180);
  const s = Math.sin((deg * Math.PI) / 180);
  return { dx: qx - (c * qx - s * qy), dy: qy - (s * qx + c * qy) };
}

const FLICK_WINDOW_MS = 80;
const STOPPED_MS = 50;
const MAX_THROW = 1600; // px/s

/** Hand velocity (px/s) from pointer samples over the last ~80 ms; 0 if the pointer had stopped (set down, not thrown). */
export function releaseVelocity(samples: { x: number; y: number; t: number }[], nowMs: number): { vx: number; vy: number } {
  const w = samples.filter((p) => p.t >= nowMs - FLICK_WINDOW_MS);
  const a = w[0];
  const z = w[w.length - 1];
  if (!a || !z || z.t === a.t || nowMs - z.t > STOPPED_MS) return { vx: 0, vy: 0 };
  let vx = ((z.x - a.x) / (z.t - a.t)) * 1000;
  let vy = ((z.y - a.y) / (z.t - a.t)) * 1000;
  const k = Math.min(1, MAX_THROW / Math.hypot(vx, vy));
  vx *= k;
  vy *= k;
  return { vx, vy };
}

const DANGLE_MAX = 35; // deg; safety stop, the soft limit below keeps normal drags well short of it
const DANGLE_SOFT = 14; // deg; legs and spine stiffen past this
const DANGLE_STIFF = 60000; // rad/s^2 per rad^3 beyond DANGLE_SOFT
const DANGLE_AX = 2500; // px/s^2; a harder yank than this does not swing it any further
const DANGLE_DAMP = 3.2; // 1/s; ~2 visible swings, under 0.5 deg in 3 s

/** Damped pendulum hung from the hand. angle is deg, positive = body swung right (so a hand accelerating right gives negative first); omega is deg/s; ax is px/s^2; armPx is grab point to body centre. */
export function dangle(s: { angle: number; omega: number }, ax: number, dt: number, armPx: number): { angle: number; omega: number } {
  const drive = Math.max(-DANGLE_AX, Math.min(DANGLE_AX, ax));
  const soft = (DANGLE_SOFT * Math.PI) / 180;
  const h = dt / 2; // two substeps keep the stiff term stable
  let th = (s.angle * Math.PI) / 180;
  let w = (s.omega * Math.PI) / 180;
  for (let i = 0; i < 2; i++) {
    const over = Math.max(0, Math.abs(th) - soft);
    w += (-(GRAVITY / armPx) * Math.sin(th) - DANGLE_DAMP * w - (drive / armPx) * Math.cos(th) - DANGLE_STIFF * over ** 3 * Math.sign(th)) * h;
    th += w * h;
  }
  const angle = (th * 180) / Math.PI;
  return Math.abs(angle) > DANGLE_MAX ? { angle: Math.sign(angle) * DANGLE_MAX, omega: 0 } : { angle, omega: (w * 180) / Math.PI };
}

export const LAND_SQUASH_MS = 220;

/** sy on landing: dip grows with impact speed (cap 0.25), then recovers with a small damped overshoot. */
export const landSquash = (tMs: number, impactV: number): number =>
  tMs < 0 || tMs >= LAND_SQUASH_MS ? 1 : 1 - 0.25 * Math.min(1, impactV / MAX_FALL) * Math.exp(-tMs / 60) * Math.cos((2 * Math.PI * tMs) / 300);

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
 * A bounding trot for a pet with no drawn walk cycle: one small airborne bound per stride, stretched mid-air and
 * squashed on each landing (volume kept: sx = 1/sy), nose pitched down at push-off and easing back. Locked to
 * distance, so a body that isn't moving doesn't bounce. rot is nose-down positive; the caller signs it for the facing.
 */
export function boundGait(distancePx: number, stridePx: number, h: number): Pose {
  const q = (distancePx / stridePx) % 1;
  const air = Math.sin(Math.PI * q);
  const sy = 1 + 0.06 * air - 0.08 * Math.max(0, 1 - q / 0.2);
  return { dx: 0, dy: -0.07 * h * air, rot: 6 * air * (1 - q), sx: 1 / sy, sy };
}

export type GaitKind = 'walk' | 'trot' | 'sniff';

export interface GaitParams {
  speed: number; // x the walking speed
  reach: number; // x the distance travelled per walk frame (a longer stride)
  bounce: number; // x the body rise and fall
  sy: number; // body height; below 1 is a lowered, sneaking body
  pitchDeg: number; // extra nose-down pitch
  suspension: number; // of the body height, a tiny float at the pass phases
}

const GAITS: Record<GaitKind, GaitParams> = {
  walk: { speed: 1, reach: 1, bounce: 1, sy: 1, pitchDeg: 0, suspension: 0 },
  trot: { speed: TROT_SPEEDUP, reach: 1.3, bounce: 1.8, sy: 1, pitchDeg: 0, suspension: 0.008 },
  sniff: { speed: 0.6, reach: 1, bounce: 0.5, sy: 0.95, pitchDeg: 4, suspension: 0 },
};
export const gaitParams = (kind: GaitKind): GaitParams => GAITS[kind];

const DEFAULT_BOUNCE = 0.03; // MotionProfile gait.bounce and pitchDeg of the dog the constants below are tuned for
const DEFAULT_PITCH = 2;

/** How much a pack's own profile scales the body motion: 1 for the default dog, at most 1.5x (more rocks a long body like a rocking horse). */
export const profileScale = (g?: { bounce: number; pitchDeg: number }): { bounce: number; pitch: number } =>
  g ? { bounce: Math.min(1.5, Math.max(0.3, g.bounce / DEFAULT_BOUNCE)), pitch: Math.min(1.5, Math.max(0, g.pitchDeg / DEFAULT_PITCH)) } : { bounce: 1, pitch: 1 };

/**
 * Body motion for a drawn walk cycle, locked to the cycle phase p (0 = contact, 1/8 = down, 2/8 = pass, 3/8 = up, then
 * the other side). Two dips per cycle: lowest at the down phases, highest at the up phases. The spine rocks out of phase
 * with the dip. rot is nose-up positive (the caller signs it for the facing); the frames already draw the legs and head,
 * so this stays small. Period is half a cycle, so it is continuous across the wrap.
 */
export function walkBody(p: number, h: number, g: GaitParams = GAITS.walk, scale = { bounce: 1, pitch: 1 }): Pose {
  const w = 4 * Math.PI * p;
  const down = Math.max(0, Math.sin(w));
  const sy = (1 - 0.02 * down) * g.sy;
  const float = Math.max(0, Math.cos(w - Math.PI)) ** 2; // 1 at the pass phases, 0 a ninth of a cycle away
  return {
    dx: 0,
    dy: 0.012 * h * g.bounce * scale.bounce * Math.sin(w) - g.suspension * h * float,
    rot: 1.2 * scale.pitch * Math.cos(w) - g.pitchDeg,
    sx: 1 / (sy / g.sy),
    sy,
  };
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
