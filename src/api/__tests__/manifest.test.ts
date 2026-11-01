import { describe, expect, it } from 'vitest';
import { validateManifest } from '../manifest.js';
import { validateManifest as reexported } from '../pose-pipeline.js';

const pose = (o: object = {}) => ({ frames: ['a.png'], fps: 2, footY: 0.9, ...o });
const ok = { pet: 'P', species: 'dog', poses: { idle: pose() } };
const withPose = (o: object) => ({ ...ok, poses: { idle: pose(o) } });

describe('validateManifest', () => {
  it('accepts good manifests, fps 0 and footY 1', () => {
    expect(() => validateManifest(ok)).not.toThrow();
    expect(() => validateManifest(withPose({ fps: 0, footY: 1 }))).not.toThrow();
  });
  it('is re-exported from pose-pipeline', () => expect(reexported).toBe(validateManifest));
  it.each([
    { ...ok, species: 'c0w' },
    { ...ok, extra: 1 },
    withPose({ fps: '2' }),
    withPose({ frames: [1] }),
    withPose({ frames: [] }),
    { ...ok, poses: { idle: { frames: ['a.png'], fps: 2 } } },
    withPose({ footY: 0 }),
    withPose({ footY: -0.1 }),
    withPose({ footY: 1.01 }),
    withPose({ footY: NaN }),
    withPose({ fps: -1 }),
    withPose({ fps: Infinity }),
    withPose({ fps: NaN }),
    withPose({ frames: ['../x.png'] }),
    withPose({ frames: ['/etc/a.png'] }),
    withPose({ frames: ['sub/a.png'] }),
    withPose({ frames: ['a\\b.png'] }),
    withPose({ frames: ['a.jpg'] }),
    withPose({ frames: ['.png'] }),
    null,
  ])('rejects %j', (bad) => expect(() => validateManifest(bad)).toThrow(/Invalid sprite manifest/));
});
