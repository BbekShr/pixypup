// Leaf module (no sharp): the app main process imports this to check packs read from disk.
import type { SpriteManifest } from '../../contracts/types.js';

const FRAME = /^[A-Za-z0-9_][\w.-]*\.png$/;

const str = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max;
const only = (o: object, keys: string[]) => Object.keys(o).every((k) => keys.includes(k));

function personalityOk(v: unknown): boolean {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const p = v as Record<string, unknown>;
  const list = (x: unknown, min: number, max: number, len: number) =>
    Array.isArray(x) && x.length >= min && x.length <= max && x.every((s) => str(s, len));
  const facts = p.facts === undefined || (Array.isArray(p.facts) && p.facts.length <= 3 && p.facts.every((f) => {
    if (typeof f !== 'object' || f === null) return false;
    const d = f as Record<string, unknown>;
    return only(d, ['text', 'source']) && str(d.text, 90) && (d.source === undefined || str(d.source, 300));
  }));
  return (
    only(p, ['breed', 'coat', 'traits', 'energy', 'lines', 'facts']) &&
    str(p.breed, 60) && str(p.coat, 80) && list(p.traits, 3, 3, 30) && list(p.lines, 3, 6, 40) &&
    (p.energy === 'sleepy' || p.energy === 'normal' || p.energy === 'playful') && facts
  );
}

export function validateManifest(m: unknown): asserts m is SpriteManifest {
  const bad = (why: string): never => {
    throw new Error(`Invalid sprite manifest: ${why}`);
  };
  if (typeof m !== 'object' || m === null) return bad('not an object');
  const o = m as Record<string, unknown>;
  if (Object.keys(o).some((k) => !['pet', 'species', 'poses', 'personality'].includes(k))) bad('unknown key');
  if (typeof o.pet !== 'string') bad('pet');
  if (o.species !== 'dog' && o.species !== 'cat') bad('species');
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
