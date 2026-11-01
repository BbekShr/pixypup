import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { SpriteManifest } from '../../contracts/types';
import { validateManifest } from '../api/manifest';

export interface Pack {
  manifest: SpriteManifest;
  frames: Record<string, string>;
}

export const MAX_FRAMES = 64;
export const MAX_FRAME_BYTES = 2 * 1024 * 1024;

/** Frames and pet names become path segments; the renderer must never steer them out of the pack dir. */
export const isPlainName = (n: string): boolean => n !== '' && n !== '.' && !/[/\\]|\.\./.test(n);

export async function loadPack(dir: string): Promise<Pack | null> {
  try {
    const manifest: unknown = JSON.parse(await readFile(join(dir, 'sprite-manifest.json'), 'utf8'));
    validateManifest(manifest);
    const poses = Object.values(manifest.poses);
    // The pack is user-writable disk data: bound what the renderer will be handed and what the math can divide by.
    if (poses.some((p) => !(p.footY > 0 && p.footY <= 1) || !Number.isFinite(p.fps) || p.fps < 0)) return null;
    const names = new Set(poses.flatMap((p) => p.frames));
    if (names.size > MAX_FRAMES) return null;
    const frames: Record<string, string> = {};
    for (const n of names) {
      if (!isPlainName(n) || !n.endsWith('.png')) return null;
      if ((await stat(join(dir, n))).size > MAX_FRAME_BYTES) return null;
      frames[n] = `data:image/png;base64,${(await readFile(join(dir, n))).toString('base64')}`;
    }
    return { manifest, frames };
  } catch {
    return null;
  }
}

/** First candidate dir that passes `ok` (pack-valid in production), or null: user pack -> built-in -> placeholder. */
export async function pickPackDir(candidates: string[], ok: (dir: string) => Promise<boolean>): Promise<string | null> {
  for (const d of candidates) if (await ok(d)) return d;
  return null;
}
