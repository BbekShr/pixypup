import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_FRAME_BYTES, loadPack, pickPackDir } from './pack';

const manifest = (frame: string) =>
  JSON.stringify({ pet: 'P', species: 'dog', poses: { idle: { frames: [frame], fps: 2, footY: 0.99 } } });

async function dir(frame: string, files: Record<string, string>): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'pack-'));
  await writeFile(join(d, 'sprite-manifest.json'), manifest(frame));
  for (const [n, c] of Object.entries(files)) await writeFile(join(d, n), c);
  return d;
}

describe('loadPack', () => {
  it('returns frames as png data URLs', async () => {
    const p = await loadPack(await dir('idle_0.png', { 'idle_0.png': 'abc' }));
    expect(p?.frames['idle_0.png']).toBe(`data:image/png;base64,${Buffer.from('abc').toString('base64')}`);
    expect(p?.manifest.pet).toBe('P');
  });
  it('is null for a missing pack, a missing frame and an invalid manifest', async () => {
    expect(await loadPack(join(tmpdir(), 'no-such-pack-dir'))).toBeNull();
    expect(await loadPack(await dir('idle_0.png', {}))).toBeNull();
    const d = await mkdtemp(join(tmpdir(), 'pack-'));
    await writeFile(join(d, 'sprite-manifest.json'), '{"pet":1}');
    expect(await loadPack(d)).toBeNull();
  });
  it('gives a pack made before the stride-and-stand cycle the new walk, and loads no hop frames', async () => {
    const d = await mkdtemp(join(tmpdir(), 'pack-'));
    const old = ['walk_0.png', 'walk_1.png', 'walk_2.png', 'walk_3.png'];
    await writeFile(join(d, 'sprite-manifest.json'), JSON.stringify({ pet: 'P', species: 'dog', poses: { idle: { frames: ['idle_0.png'], fps: 2, footY: 0.99 }, walk: { frames: old, fps: 8, footY: 0.99 } } }));
    for (const n of ['idle_0.png', ...old]) await writeFile(join(d, n), n);
    const p = await loadPack(d);
    expect(p?.manifest.poses['walk']?.frames).toEqual(['walk_0.png', 'idle_0.png', 'walk_2.png', 'idle_0.png']);
    expect(Object.keys(p?.frames ?? {}).sort()).toEqual(['idle_0.png', 'walk_0.png', 'walk_2.png']);
  });
  it('leaves any other walk alone', async () => {
    const d = await mkdtemp(join(tmpdir(), 'pack-'));
    await writeFile(join(d, 'sprite-manifest.json'), JSON.stringify({ pet: 'P', species: 'dog', poses: { idle: { frames: ['idle_0.png'], fps: 2, footY: 0.99 }, walk: { frames: ['a.png', 'b.png'], fps: 8, footY: 0.99 } } }));
    for (const n of ['idle_0.png', 'a.png', 'b.png']) await writeFile(join(d, n), n);
    expect((await loadPack(d))?.manifest.poses['walk']?.frames).toEqual(['a.png', 'b.png']);
  });
  it('rejects frame names that escape the pack dir', async () => {
    const outer = await dir('x.png', { 'x.png': 'secret' });
    const inner = await dir('../' + outer.split('/').pop() + '/x.png', {});
    expect(await loadPack(inner)).toBeNull();
    expect(await loadPack(await dir('a/b.png', {}))).toBeNull();
  });
  it('rejects bad footY and fps, too many frames, and oversized frames', async () => {
    const mk = async (poses: unknown, files: Record<string, string> = {}) => {
      const d = await mkdtemp(join(tmpdir(), 'pack-'));
      await writeFile(join(d, 'sprite-manifest.json'), JSON.stringify({ pet: 'P', species: 'dog', poses }));
      for (const [n, c] of Object.entries(files)) await writeFile(join(d, n), c);
      return d;
    };
    const pose = (o: object) => ({ idle: { frames: ['a.png'], fps: 2, footY: 0.9, ...o } });
    const f = { 'a.png': 'x' };
    expect(await loadPack(await mk(pose({}), f))).not.toBeNull();
    for (const bad of [{ footY: 0 }, { footY: 1.5 }, { footY: -1 }, { fps: -1 }, { fps: null }]) {
      expect(await loadPack(await mk(pose(bad), f))).toBeNull();
    }
    const many = { idle: { frames: Array.from({ length: 65 }, (_, i) => `f${i}.png`), fps: 2, footY: 0.9 } };
    expect(await loadPack(await mk(many))).toBeNull();
    expect(await loadPack(await mk(pose({}), { 'a.png': 'x'.repeat(MAX_FRAME_BYTES + 1) }))).toBeNull();
    expect(await loadPack(await mk(pose({}), { 'a.png': 'x'.repeat(MAX_FRAME_BYTES) }))).not.toBeNull();
  });
});

describe('pickPackDir', () => {
  it('takes the first valid candidate, skipping missing/invalid ones, else null', async () => {
    const ok = async (d: string) => d !== 'user';
    expect(await pickPackDir(['user', 'builtin'], ok)).toBe('builtin');
    expect(await pickPackDir(['a', 'builtin'], ok)).toBe('a');
    expect(await pickPackDir(['user'], ok)).toBeNull();
  });
  it('the shipped Pakkun pack is valid', async () => {
    expect(await loadPack(join(process.cwd(), 'assets/pets/Pakkun'))).not.toBeNull();
  });
});
