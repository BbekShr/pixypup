import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MetaApiError } from '../api/meta-client';
import { NoPetFoundError } from '../api/pose-pipeline';
import { checkCreateArgs, checkKey, checkPhoto, errorCode, MAX_PHOTO_BYTES, slugify } from './pet-input';

describe('slugify', () => {
  it.each([
    ['Milo', 'milo'],
    ['  Mr. Biscuit!! ', 'mr-biscuit'],
    ['Zoë', 'zoe'],
    ['../../etc', 'etc'],
    ['🐶🐶', 'pet'],
    ['', 'pet'],
  ])('%j -> %j', (i, o) => expect(slugify(i)).toBe(o));
  it('only ever yields [a-z0-9-], at most 24 chars, no edge dashes', () => {
    for (const n of ['a'.repeat(24) + '-b', 'Ünï cödé / name', '\\..\\x', 'x y z']) {
      const s = slugify(n);
      expect(s).toMatch(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/);
      expect(s.length).toBeLessThanOrEqual(24);
    }
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
  it('trims and bounds the name, requires dog|cat', () => {
    expect(checkCreateArgs({ name: ' Milo ', species: 'cat' })).toEqual({ name: 'Milo', species: 'cat' });
    for (const bad of [{ name: '', species: 'dog' }, { name: ' ', species: 'dog' }, { name: 'x'.repeat(25), species: 'dog' }, { name: 'a\nb', species: 'dog' }, { name: 'a', species: 'fish' }, { name: 3, species: 'dog' }, null, 'x'])
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
    expect(errorCode(new Error('boom'))).toBe('generation-failed');
    expect(errorCode('weird')).toBe('generation-failed');
  });
});
