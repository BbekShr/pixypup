import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { MetaApiError } from '../api/meta-client';
import { NoPetFoundError } from '../api/pose-pipeline';

export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
export const PHOTO_EXTS = ['jpg', 'jpeg', 'png', 'heic', 'webp'];
export type PhotoCode = 'missing' | 'type' | 'size';
export type ErrorCode = 'bad-key' | 'no-pet-found' | 'network' | 'generation-failed';

export const slugify = (name: string): string =>
  name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24).replace(/-+$/, '') || 'pet';

/** The path comes from the renderer (drag-drop), so main re-checks everything before it reads the file. */
export async function checkPhoto(path: unknown): Promise<{ ok: true; path: string } | { ok: false; code: PhotoCode }> {
  if (typeof path !== 'string' || !isAbsolute(path) || path.length > 4096) return { ok: false, code: 'missing' };
  if (!PHOTO_EXTS.includes(path.split('.').pop()!.toLowerCase())) return { ok: false, code: 'type' };
  try {
    const s = await stat(path);
    if (!s.isFile()) return { ok: false, code: 'missing' };
    if (s.size > MAX_PHOTO_BYTES) return { ok: false, code: 'size' };
  } catch {
    return { ok: false, code: 'missing' };
  }
  return { ok: true, path };
}

export function checkCreateArgs(a: unknown): { name: string; species: 'dog' | 'cat' } | null {
  if (typeof a !== 'object' || a === null) return null;
  const { name, species } = a as Record<string, unknown>;
  if (typeof name !== 'string' || (species !== 'dog' && species !== 'cat')) return null;
  const n = name.trim();
  const control = [...n].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
  return n.length >= 1 && n.length <= 24 && !control ? { name: n, species } : null;
}

export const checkKey = (k: unknown): k is string => typeof k === 'string' && /^\S{8,512}$/.test(k);

/** Only these codes reach the UI; raw error messages (which can echo API bodies) never do. */
export function errorCode(err: unknown): ErrorCode {
  if (err instanceof MetaApiError && (err.status === 401 || err.status === 403)) return 'bad-key';
  if (err instanceof NoPetFoundError) return 'no-pet-found';
  if (err instanceof TypeError) return 'network'; // fetch rejects with TypeError when offline
  return 'generation-failed';
}
