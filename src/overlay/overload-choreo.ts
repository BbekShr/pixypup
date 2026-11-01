// Pure, seeded timeline of the "PixyPup Overload!" show. overload.ts draws what this computes; all maths comes from motion.ts.
import { airStep, MAX_SPEED, pickTarget, steer, walkStep, type Mirror } from './motion';

export const SHOW_MS = 25_000;
export const MAX_CAST = 24;
export const BASE_H = 110;
export const TURN_MS = 300;
export const TURN_HOP = 0.07; // of the sprite height
export const WAVE_GAP_MS = 80;
export const HOP_WINDOW_MS = 450;
export const T = { dropEnd: 3000, look: 10_000, wave: 12_000, conga: 15_000, exit: 20_000 } as const;
const DROP_GAP_MS = 120;
const SWOOP_MS = 1200;
const EXIT_SECONDS = 3.5;
const CALM_FADE_OUT_AT = 22_000;
const CALM_FADE_OUT_MS = 2500;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How many sprites for this many distinct pets. */
export const castSize = (unique: number): number => Math.min(MAX_CAST, Math.max(12, 3 * unique));

/** Pack index for each sprite: the distinct pets round-robin until the cast is full. */
export const castIndices = (unique: number): number[] => (unique < 1 ? [] : Array.from({ length: castSize(unique) }, (_, i) => i % unique));

/** Indices sorted by ascending x (ties by index): the order the wave travels. */
export const waveOrder = (xs: number[]): number[] => xs.map((_, i) => i).sort((a, b) => xs[a]! - xs[b]! || a - b);

/** Calm: fade in at its slot, hold, fade out together; never a drop, hop or strobe. */
export const calmAlpha = (t: number, dropAt: number): number =>
  clamp01((t - dropAt) / 600) * (1 - clamp01((t - CALM_FADE_OUT_AT) / CALM_FADE_OUT_MS));

export interface CastMember {
  flier: boolean;
  /** Width over height of the idle frame. */
  aspect: number;
  /** Body heights above the floor; fliers only. */
  air?: { min: number; max: number };
}

export interface SpritePlan {
  flier: boolean;
  w: number;
  h: number;
  speedK: number;
  phase: number;
  dropAt: number;
  x0: number;
  home: number;
  swoopFrom: number;
  bandPx: number;
  bobPx: number;
  bobHz: number;
}

export interface SpriteState {
  mode: 'wait' | 'enter' | 'live';
  gone: boolean;
  x: number;
  lift: number; // offset from the floor, negative = above
  vx: number;
  vy: number;
  v: number; // walk speed, px/s
  walked: number;
  target: number;
  arrived: boolean;
  pauseUntil: number;
  mir: Mirror;
  turnH: number;
  hopAt: number;
  landAt: number;
  landV: number;
  exitDir: -1 | 0 | 1;
  exitV: number;
}

export function planShow(seed: number, cast: CastMember[], screenW: number): SpritePlan[] {
  const r = mulberry32(seed);
  const order = cast.map((_, i) => i).sort(() => r() - 0.5);
  const dropAt: number[] = [];
  order.forEach((who, k) => { dropAt[who] = Math.min(k * DROP_GAP_MS + Math.floor(r() * 40), T.dropEnd - 50); });
  return cast.map((c, i) => {
    const h = BASE_H * (0.85 + r() * 0.25);
    const w = h * c.aspect;
    const maxX = Math.max(0, screenW - w);
    const air = c.air ?? { min: 0.6, max: 1.5 };
    const lo = air.min * h;
    const hi = Math.max(lo, air.max * h);
    return {
      flier: c.flier, w, h,
      speedK: 0.8 + r() * 0.4,
      phase: r() * Math.PI * 2,
      dropAt: dropAt[i]!,
      x0: r() * maxX,
      home: r() * maxX,
      swoopFrom: r() < 0.5 ? -w : screenW,
      bandPx: lo + (hi - lo) * r(),
      bobPx: Math.max(3, (hi - lo) / 4),
      bobHz: 0.3 + r() * 0.3,
    };
  });
}

/** Calm layout: evenly spread along the bottom. */
export const calmX = (plans: SpritePlan[], screenW: number): number[] =>
  plans.map((p, i) => Math.min(Math.max(0, screenW - p.w), Math.max(0, ((i + 0.5) / plans.length) * screenW - p.w / 2)));

export const flyLift = (p: SpritePlan, tMs: number): number => p.bandPx + p.bobPx * Math.sin(2 * Math.PI * p.bobHz * (tMs / 1000) + p.phase);

export function createShow(seed: number, cast: CastMember[], screenW: number, screenH: number) {
  const plans = planShow(seed, cast, screenW);
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const sprites: SpriteState[] = plans.map((p) => {
    const to = rng() < 0.5 ? -1 : 1;
    return {
      mode: 'wait', gone: false, x: p.x0, lift: 0, vx: 0, vy: 0, v: 0, walked: 0, target: p.x0, arrived: true, pauseUntil: 0,
      mir: { from: (-to) as 1 | -1, to, at: -Infinity }, turnH: 0, hopAt: Infinity, landAt: -Infinity, landV: 0, exitDir: 0, exitV: 0,
    };
  });
  const maxXOf = (i: number): number => Math.max(0, screenW - plans[i]!.w);
  const active = (): number[] => sprites.flatMap((s, i) => (s.mode === 'wait' ? [] : [i]));
  let waved = false;
  let chain: number[] = [];
  const congaDir: 1 | -1 = rng() < 0.5 ? -1 : 1;
  let leaderDir = congaDir;
  let cursorX = screenW / 2;

  const face = (s: SpriteState, want: 1 | -1, t: number, h: number): void => {
    const prev = s.mir;
    s.mir = steer(s.mir, want, t, TURN_MS);
    if (s.mir !== prev && t - prev.at >= TURN_MS) s.turnH = TURN_HOP * h;
  };
  const turning = (s: SpriteState, t: number): boolean => t - s.mir.at < TURN_MS;

  /** Walks sprite i toward target; true once there. A reversal first does its hop-turn on the spot. */
  function go(i: number, target: number, vMax: number, t: number, dt: number): boolean {
    const s = sprites[i]!;
    const rem = target - s.x;
    if (Math.abs(rem) < 1) { s.x = target; s.v = 0; return true; }
    face(s, rem > 0 ? 1 : -1, t, plans[i]!.h);
    if (turning(s, t)) { s.v = 0; return false; }
    s.v = walkStep(s.v, Math.abs(rem), vMax, dt);
    const d = Math.min(s.v * dt, Math.abs(rem));
    s.x += Math.sign(rem) * d;
    s.walked += d;
    if (d >= Math.abs(rem)) { s.v = 0; return true; }
    return false;
  }

  function wander(i: number, t: number, dt: number): void {
    const s = sprites[i]!;
    const p = plans[i]!;
    if (s.arrived) {
      if (t < s.pauseUntil) return;
      s.target = pickTarget(s.x, maxXOf(i), p.home, rng(), rng());
      s.arrived = false;
    }
    if (go(i, s.target, MAX_SPEED * p.speedK, t, dt)) { s.arrived = true; s.pauseUntil = t + 300 + rng() * 900; }
  }

  function live(i: number, t: number, dt: number): void {
    const s = sprites[i]!;
    const p = plans[i]!;
    if (t >= T.exit) {
      if (s.exitDir === 0) {
        s.exitDir = s.x + p.w / 2 < screenW / 2 ? -1 : 1;
        s.exitV = Math.max(1.6 * MAX_SPEED, (s.exitDir < 0 ? s.x + p.w : screenW - s.x) / EXIT_SECONDS);
      }
      face(s, s.exitDir, t, p.h);
      if (turning(s, t)) s.v = 0;
      else {
        s.v = walkStep(s.v, 1e9, s.exitV, dt);
        s.x += s.exitDir * s.v * dt;
        s.walked += s.v * dt;
      }
      if (s.exitDir < 0 ? s.x <= -p.w : s.x >= screenW) s.gone = true;
    } else if (t >= T.conga) {
      const k = chain.indexOf(i);
      if (k <= 0) {
        if (go(i, leaderDir > 0 ? maxXOf(i) : 0, MAX_SPEED * p.speedK, t, dt)) leaderDir = (-leaderDir) as 1 | -1;
        return;
      }
      const pred = sprites[chain[k - 1]!]!;
      const to = Math.min(maxXOf(i), Math.max(0, pred.x - pred.mir.to * 0.7 * p.w));
      const vMax = MAX_SPEED * p.speedK * (1 + 0.6 * clamp01(Math.abs(to - s.x) / 250));
      if (go(i, to, vMax, t, dt)) face(s, pred.mir.to, t, p.h);
    } else if (t >= T.wave) {
      s.v = 0;
    } else if (t >= T.look) {
      s.v = 0;
      face(s, cursorX >= s.x + p.w / 2 ? 1 : -1, t, p.h);
    } else wander(i, t, dt);
  }

  function enter(i: number, t: number, dt: number): void {
    const s = sprites[i]!;
    const p = plans[i]!;
    if (s.mode === 'wait') {
      s.mode = 'enter';
      if (p.flier) s.x = p.swoopFrom;
      else { s.lift = -(screenH + p.h); s.vx = (rng() - 0.5) * 120; }
    }
    if (p.flier) {
      const u = clamp01((t - p.dropAt) / SWOOP_MS);
      const e = 1 - (1 - u) ** 3;
      s.x = p.swoopFrom + (p.x0 - p.swoopFrom) * e;
      s.lift = -flyLift(p, t) - (1 - e) * p.h * 1.5;
      if (u >= 1) s.mode = 'live';
      return;
    }
    const a = airStep(s, dt, maxXOf(i), 1e6);
    s.x = a.x; s.lift = a.lift; s.vx = a.vx; s.vy = a.vy;
    if (a.impact) { s.landAt = t; s.landV = a.impact; }
    if (a.settled) s.mode = 'live';
  }

  return {
    plans,
    sprites,
    get done(): boolean { return sprites.every((s) => s.gone); },
    step(t: number, dt: number, cursor: number): void {
      cursorX = cursor;
      if (!waved && t >= T.wave) {
        waved = true;
        const act = active();
        waveOrder(act.map((i) => sprites[i]!.x + plans[i]!.w / 2)).forEach((r, k) => { sprites[act[r]!]!.hopAt = T.wave + k * WAVE_GAP_MS; });
      }
      if (chain.length === 0 && t >= T.conga) chain = active().sort((a, b) => (sprites[b]!.x - sprites[a]!.x) * congaDir);
      sprites.forEach((s, i) => {
        if (s.gone || t < plans[i]!.dropAt) return;
        if (s.mode !== 'live') enter(i, t, dt);
        if (s.mode === 'live') {
          if (plans[i]!.flier) s.lift = -flyLift(plans[i]!, t);
          live(i, t, dt);
        }
      });
    },
  };
}
