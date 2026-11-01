import type { SpriteManifest } from '../../contracts/types';

// TODO(F3): fetch + validate manifest against contracts/sprite-manifest.schema.json, preload frames.
export function loadSprites(_manifestUrl: string): Promise<SpriteManifest> {
  throw new Error('not implemented');
}
