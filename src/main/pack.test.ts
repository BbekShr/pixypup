import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPack } from './pack';

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
  it('rejects frame names that escape the pack dir', async () => {
    const outer = await dir('x.png', { 'x.png': 'secret' });
    const inner = await dir('../' + outer.split('/').pop() + '/x.png', {});
    expect(await loadPack(inner)).toBeNull();
    expect(await loadPack(await dir('a/b.png', {}))).toBeNull();
  });
});
