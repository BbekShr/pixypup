import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { SpriteManifest } from '../../contracts/types';
import { naturalWalk, validateManifest } from '../api/manifest';

export interface Pack {
  manifest: SpriteManifest;
  frames: Record<string, string>;
}

export const MAX_FRAMES = 64;
export const MAX_FRAME_BYTES = 2 * 1024 * 1024;

/** Frames and pet names become path segments; the renderer must never steer them out of the pack dir. */
export const isPlainName = (n: string): boolean => n !== '' && n !== '.' && !/[/\\]|\.\./.test(n);

/**
 * A walk whose frames are all the same bytes (a failed sheet that fell back to one image) is no walk: drop it so the
 * overlay improvises a bound. A real cycle, even `[c0, idle, c1, idle]`, has at least two distinct frames.
 */
export function dropStaticWalk(manifest: SpriteManifest, bytesByFile: Record<string, Buffer | undefined>): SpriteManifest {
  const walk = manifest.poses['walk'];
  if (!walk) return manifest;
  const keys = new Set(walk.frames.map((f) => bytesByFile[f]?.toString('base64')));
  if (keys.size > 1 || keys.has(undefined)) return manifest;
  const poses = { ...manifest.poses };
  delete poses['walk'];
  return { ...manifest, poses };
}

export async function loadPack(dir: string): Promise<Pack | null> {
  try {
    const raw: unknown = JSON.parse(await readFile(join(dir, 'sprite-manifest.json'), 'utf8'));
    validateManifest(raw);
    const manifest = naturalWalk(raw);
    const poses = Object.values(manifest.poses);
    // The pack is user-writable disk data: bound what the renderer will be handed and what the math can divide by.
    if (poses.some((p) => !(p.footY > 0 && p.footY <= 1) || !Number.isFinite(p.fps) || p.fps < 0)) return null;
    const names = new Set(poses.flatMap((p) => p.frames));
    if (names.size > MAX_FRAMES) return null;
    const bytes: Record<string, Buffer> = {};
    for (const n of names) {
      if (!isPlainName(n) || !n.endsWith('.png')) return null;
      if ((await stat(join(dir, n))).size > MAX_FRAME_BYTES) return null;
      bytes[n] = await readFile(join(dir, n));
    }
    const final = dropStaticWalk(manifest, bytes);
    const frames: Record<string, string> = {};
    for (const n of new Set(Object.values(final.poses).flatMap((p) => p.frames))) frames[n] = `data:image/png;base64,${bytes[n]!.toString('base64')}`;
    return { manifest: final, frames };
  } catch {
    return null;
  }
}

/** First candidate dir that passes `ok` (pack-valid in production), or null: user pack -> built-in -> placeholder. */
export async function pickPackDir(candidates: string[], ok: (dir: string) => Promise<boolean>): Promise<string | null> {
  for (const d of candidates) if (await ok(d)) return d;
  return null;
}

/** Where a slug's pack may live, best first: the user's own, the bundled one, then the built-in Pakkun. */
export const packCandidates = (slug: string, userRoot: string, libRoot: string): string[] => [
  ...(isPlainName(slug) ? [join(userRoot, slug), join(libRoot, slug)] : []),
  join(libRoot, 'Pakkun'),
];

/** Bundled pets: every dir under libRoot that loads as a pack, named by its manifest. */
export async function listLibrary(libRoot: string): Promise<{ slug: string; name: string }[]> {
  const names = (await readdir(libRoot).catch(() => [] as string[])).filter(isPlainName).sort();
  const packs = await Promise.all(names.map((n) => loadPack(join(libRoot, n))));
  return packs.flatMap((p, i) => (p ? [{ slug: names[i]!, name: p.manifest.pet }] : []));
}
