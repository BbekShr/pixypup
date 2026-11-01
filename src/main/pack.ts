import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SpriteManifest } from '../../contracts/types';
import { validateManifest } from '../api/pose-pipeline';

export interface Pack {
  manifest: SpriteManifest;
  frames: Record<string, string>;
}

/** Frames and pet names become path segments; the renderer must never steer them out of the pack dir. */
export const isPlainName = (n: string): boolean => n !== '' && n !== '.' && !/[/\\]|\.\./.test(n);

export async function loadPack(dir: string): Promise<Pack | null> {
  try {
    const manifest: unknown = JSON.parse(await readFile(join(dir, 'sprite-manifest.json'), 'utf8'));
    validateManifest(manifest);
    const names = new Set(Object.values(manifest.poses).flatMap((p) => p.frames));
    const frames: Record<string, string> = {};
    for (const n of names) {
      if (!isPlainName(n) || !n.endsWith('.png')) return null;
      frames[n] = `data:image/png;base64,${(await readFile(join(dir, n))).toString('base64')}`;
    }
    return { manifest, frames };
  } catch {
    return null;
  }
}
