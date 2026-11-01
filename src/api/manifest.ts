// Leaf module (no sharp): the app main process imports this to check packs read from disk.
import type { SpriteManifest } from '../../contracts/types.js';

const FRAME = /^[A-Za-z0-9_][\w.-]*\.png$/;

export function validateManifest(m: unknown): asserts m is SpriteManifest {
  const bad = (why: string): never => {
    throw new Error(`Invalid sprite manifest: ${why}`);
  };
  if (typeof m !== 'object' || m === null) return bad('not an object');
  const o = m as Record<string, unknown>;
  if (Object.keys(o).some((k) => !['pet', 'species', 'poses'].includes(k))) bad('unknown key');
  if (typeof o.pet !== 'string') bad('pet');
  if (o.species !== 'dog' && o.species !== 'cat') bad('species');
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
