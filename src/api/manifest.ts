// Leaf module (no sharp): the app main process imports this to check packs read from disk.
import type { SpriteManifest } from '../../contracts/types.js';
import { CYCLES, FIDGETS, LOCOMOTIONS, RANGE, ROLES, SPECIES_RE } from './profile-defaults.js';

const FRAME = /^[A-Za-z0-9_][\w.-]*\.png$/;

// Mirrors the sanitizer in personality.ts: model text never carries URLs, @ or emoji.
const str = (v: unknown, max: number) =>
  typeof v === 'string' && v.length > 0 && v.length <= max && !/https?:|www\.|@|\p{Extended_Pictographic}/u.test(v);
const url = (v: unknown) => typeof v === 'string' && v.startsWith('https://') && v.length <= 300;
const only = (o: object, keys: string[]) => Object.keys(o).every((k) => keys.includes(k));

function personalityOk(v: unknown): boolean {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const p = v as Record<string, unknown>;
  const list = (x: unknown, min: number, max: number, len: number) =>
    Array.isArray(x) && x.length >= min && x.length <= max && x.every((s) => str(s, len));
  const facts = p.facts === undefined || (Array.isArray(p.facts) && p.facts.length <= 3 && p.facts.every((f) => {
    if (typeof f !== 'object' || f === null) return false;
    const d = f as Record<string, unknown>;
    return only(d, ['text', 'source']) && str(d.text, 90) && (d.source === undefined || url(d.source));
  }));
  return (
    only(p, ['breed', 'coat', 'traits', 'energy', 'lines', 'facts']) &&
    str(p.breed, 60) && str(p.coat, 80) && list(p.traits, 3, 3, 30) && list(p.lines, 3, 6, 40) &&
    (p.energy === 'sleepy' || p.energy === 'normal' || p.energy === 'playful') && facts
  );
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const inRange = (v: unknown, r: readonly [number, number]) => typeof v === 'number' && v >= r[0] && v <= r[1];
const num = (o: Record<string, unknown>, keys: (keyof typeof RANGE)[]) => keys.every((k) => inRange(o[k], RANGE[k]));

function roleOk(v: unknown): boolean {
  return isObj(v) && only(v, ['label', 'prompt', 'bubble']) && str(v.label, 16) && str(v.prompt, 200) && (v.bubble === undefined || str(v.bubble, 12));
}

export function profileOk(v: unknown): boolean {
  if (!isObj(v)) return false;
  const { gait, air, cycle, roles, fidgets } = v;
  const GAIT = ['cadenceHz', 'strideBody', 'bounce', 'pitchDeg', 'speedBody'] as const;
  const AIR = ['minLiftBody', 'maxLiftBody', 'flutterHz', 'sway'] as const;
  return (
    only(v, ['locomotion', 'subject', 'styleHints', 'gait', 'air', 'cycle', 'idlePrompt', 'fidgets', 'roles', 'energy']) &&
    LOCOMOTIONS.includes(v.locomotion as never) && str(v.subject, 60) && str(v.styleHints, 120) && str(v.idlePrompt, 200) && str(v.energy, 40) &&
    isObj(gait) && only(gait, [...GAIT]) && num(gait, [...GAIT]) &&
    (v.locomotion === 'fly' ? isObj(air) : air === undefined || isObj(air)) &&
    (air === undefined || (isObj(air) && only(air, [...AIR, 'perches']) && num(air, [...AIR]) && typeof air.perches === 'boolean')) &&
    isObj(cycle) && only(cycle, ['kind', 'prompt']) && CYCLES.includes(cycle.kind as never) && str(cycle.prompt, 900) &&
    Array.isArray(fidgets) && fidgets.length >= 2 && fidgets.length <= 5 && fidgets.every((f) => FIDGETS.includes(f as never)) &&
    isObj(roles) && only(roles, ROLES) && ROLES.every((r) => roleOk(roles[r]))
  );
}

export function validateManifest(m: unknown): asserts m is SpriteManifest {
  const bad = (why: string): never => {
    throw new Error(`Invalid sprite manifest: ${why}`);
  };
  if (typeof m !== 'object' || m === null) return bad('not an object');
  const o = m as Record<string, unknown>;
  if (Object.keys(o).some((k) => !['pet', 'species', 'profile', 'poses', 'personality'].includes(k))) bad('unknown key');
  if (typeof o.pet !== 'string') bad('pet');
  if (typeof o.species !== 'string' || !SPECIES_RE.test(o.species)) bad('species');
  if (o.profile !== undefined && !profileOk(o.profile)) bad('profile');
  if (o.personality !== undefined && !personalityOk(o.personality)) bad('personality');
  if (typeof o.poses !== 'object' || o.poses === null) return bad('poses');
  for (const [name, p] of Object.entries(o.poses)) {
    const d = p as Record<string, unknown> | null;
    if (typeof d !== 'object' || d === null) return bad(`pose ${name}`);
    if (Object.keys(d).some((k) => !['frames', 'fps', 'footY'].includes(k))) bad(`pose ${name} unknown key`);
    if (!Array.isArray(d.frames) || d.frames.length === 0 || d.frames.some((f) => typeof f !== 'string' || !FRAME.test(f))) bad(`pose ${name} frames`);
    if (typeof d.fps !== 'number' || !Number.isFinite(d.fps) || d.fps < 0) bad(`pose ${name} fps`);
    if (typeof d.footY !== 'number' || !(d.footY > 0 && d.footY <= 1)) bad(`pose ${name} footY`);
  }
}

// Stride, stand, stride, stand. Muse Image draws the stride (contact) frames well, but its "passing" frames come out
// as a crouched hop, which reads as a sideways bunny-hop. idle_0 is a clean legs-under-body pose.
export const WALK_CYCLE = ['walk_0.png', 'idle_0.png', 'walk_2.png', 'idle_0.png'];
const OLD_WALK = ['walk_0.png', 'walk_1.png', 'walk_2.png', 'walk_3.png'];

/** Packs made before WALK_CYCLE walk with the hop frames; give them the stride-and-stand cycle. Others are untouched. */
export function naturalWalk(m: SpriteManifest): SpriteManifest {
  const w = m.poses['walk'];
  const old = w && w.frames.length === OLD_WALK.length && w.frames.every((f, i) => f === OLD_WALK[i]);
  return old && m.poses['idle']?.frames[0] === 'idle_0.png' ? { ...m, poses: { ...m.poses, walk: { ...w, frames: [...WALK_CYCLE] } } } : m;
}
