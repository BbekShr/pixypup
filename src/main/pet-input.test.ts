import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MetaApiError } from '../api/meta-client';
import { NoPetFoundError } from '../api/pose-pipeline';
import { checkCreateArgs, checkKey, checkPhoto, errorCode, loadPhoto, MAX_PHOTO_BYTES, pickSlug, reuseOnboardingWindow, slugify } from './pet-input';

describe('slugify', () => {
  it.each([
    ['Milo', 'milo'],
    ['  Mr. Biscuit!! ', 'mr-biscuit'],
    ['Zoë', 'zoe'],
    ['../../etc', 'etc'],
  ])('%j -> %j', (i, o) => expect(slugify(i)).toBe(o));
  it('only ever yields [a-z0-9-], at most 24 chars, no edge dashes', () => {
    for (const n of ['a'.repeat(24) + '-b', 'Ünï cödé / name', '\\..\\x', 'x y z']) {
      const s = slugify(n);
      expect(s).toMatch(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/);
      expect(s.length).toBeLessThanOrEqual(24);
    }
  });
});

describe('slugify fallback and pickSlug', () => {
  it('gives non-Latin names a stable short hash, different per name', () => {
    expect(slugify('🐶🐶')).toMatch(/^pet-[0-9a-f]{4}$/);
    expect(slugify('🐶🐶')).toBe(slugify(' 🐶🐶 '));
    expect(slugify('🐱')).not.toBe(slugify('🐶'));
  });
  it('appends -2, -3 for a taken slug but lets the current pet reuse its own', async () => {
    const taken = new Set(['milo', 'milo-2']);
    const exists = async (s: string) => taken.has(s);
    expect(await pickSlug('milo', 'pakkun', exists)).toBe('milo-3');
    expect(await pickSlug('milo', 'milo', exists)).toBe('milo');
    expect(await pickSlug('rex', 'milo', exists)).toBe('rex');
    expect(await pickSlug('milo', 'milo-2', exists)).toBe('milo-2');
  });
});

describe('loadPhoto', () => {
  it('returns the bytes it read once, and rejects what checkPhoto rejects', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pixy-load-'));
    writeFileSync(join(dir, 'a.png'), Buffer.from([1, 2, 3]));
    const r = await loadPhoto(join(dir, 'a.png'));
    expect(r.ok && [...r.buf]).toEqual([1, 2, 3]);
    expect(await loadPhoto(join(dir, 'a.gif'))).toEqual({ ok: false, code: 'type' });
    expect(await loadPhoto(join(dir, 'nope.png'))).toEqual({ ok: false, code: 'missing' });
  });
});

describe('checkPhoto', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pixy-photo-'));
  const f = (name: string, bytes = 4): string => {
    const p = join(dir, name);
    writeFileSync(p, Buffer.alloc(bytes));
    return p;
  };
  it('accepts a regular image file, any extension case', async () => {
    expect(await checkPhoto(f('a.JPG'))).toEqual({ ok: true, path: join(dir, 'a.JPG') });
    for (const e of ['jpeg', 'png', 'heic', 'webp']) expect((await checkPhoto(f(`a.${e}`))).ok).toBe(true);
  });
  it('rejects wrong types, missing files, directories, relative paths and non-strings', async () => {
    expect(await checkPhoto(f('a.gif'))).toEqual({ ok: false, code: 'type' });
    expect(await checkPhoto(join(dir, 'nope.png'))).toEqual({ ok: false, code: 'missing' });
    mkdirSync(join(dir, 'd.png'));
    expect(await checkPhoto(join(dir, 'd.png'))).toEqual({ ok: false, code: 'missing' });
    expect(await checkPhoto('a.png')).toEqual({ ok: false, code: 'missing' });
    for (const bad of [undefined, 5, null, {}]) expect(await checkPhoto(bad)).toEqual({ ok: false, code: 'missing' });
  });
  it('rejects files over 25 MB and a symlink to a missing target', async () => {
    expect(await checkPhoto(f('big.png', MAX_PHOTO_BYTES + 1))).toEqual({ ok: false, code: 'size' });
    expect((await checkPhoto(f('edge.png', MAX_PHOTO_BYTES))).ok).toBe(true);
    symlinkSync(join(dir, 'ghost'), join(dir, 'l.png'));
    expect(await checkPhoto(join(dir, 'l.png'))).toEqual({ ok: false, code: 'missing' });
  });
});

describe('checkCreateArgs / checkKey', () => {
  it('trims and bounds the name, takes any sane species text', () => {
    expect(checkCreateArgs({ name: ' Milo ', species: ' cat ' })).toEqual({ name: 'Milo', species: 'cat' });
    expect(checkCreateArgs({ name: 'Bo', species: 'husky' })).toEqual({ name: 'Bo', species: 'husky' });
    expect(checkCreateArgs({ name: 'Bo', species: 'monarch butterfly' })).toEqual({ name: 'Bo', species: 'monarch butterfly' });
    for (const bad of [{ name: '', species: 'dog' }, { name: ' ', species: 'dog' }, { name: 'x'.repeat(25), species: 'dog' }, { name: 'a\nb', species: 'dog' }, { name: 'a', species: '<script>' }, { name: 'a', species: '' }, { name: 'a', species: '  ' }, { name: 'a', species: 'x'.repeat(31) }, { name: 'a', species: 5 }, { name: 3, species: 'dog' }, null, 'x'])
      expect(checkCreateArgs(bad)).toBeNull();
    expect(checkCreateArgs({ name: 'x'.repeat(24), species: 'dog' })).not.toBeNull();
  });
  it('keys are one token of sane length', () => {
    expect(checkKey('abcd1234')).toBe(true);
    for (const bad of ['short', 'has space1234', 'x'.repeat(513), '', 5, undefined]) expect(checkKey(bad)).toBe(false);
  });
});

describe('errorCode', () => {
  it('maps to codes only, never messages', () => {
    expect(errorCode(new MetaApiError(401, 'secret body', '/x'))).toBe('bad-key');
    expect(errorCode(new MetaApiError(403, '', '/x'))).toBe('bad-key');
    expect(errorCode(new MetaApiError(500, '', '/x'))).toBe('generation-failed');
    expect(errorCode(new NoPetFoundError('dog'))).toBe('no-pet-found');
    expect(errorCode(new TypeError('fetch failed'))).toBe('network');
    expect(errorCode(new TypeError('x', { cause: new Error('ENOTFOUND') }))).toBe('network');
    expect(errorCode(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe('network');
    expect(errorCode(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))).toBe('network'); // AbortSignal.timeout's reason
    expect(errorCode(Object.assign(new Error('aborted'), { name: 'AbortError', timedOut: true }))).toBe('generation-failed'); // our own attempt timeout is not the network
    expect(errorCode(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe('generation-failed');
    expect(errorCode(new Error('boom'))).toBe('generation-failed');
    expect(errorCode('weird')).toBe('generation-failed');
  });
});

describe('reuseOnboardingWindow', () => {
  const first = { fromMenu: false, add: false };
  const addPet = { fromMenu: true, add: true };
  it('add-another over an open first-run window gets a fresh window', () => {
    expect(reuseOnboardingWindow(first, addPet, false)).toBe(false);
  });
  it('same mode, or a run in flight, just shows the window', () => {
    expect(reuseOnboardingWindow(addPet, addPet, false)).toBe(true);
    expect(reuseOnboardingWindow(first, addPet, true)).toBe(true);
  });
});
