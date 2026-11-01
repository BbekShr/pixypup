import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { Personality, PetFact, SpriteManifest } from '../../contracts/types';
import { writePack, type PipelineEvent } from '../api/pose-pipeline';

// Dev rehearsal (PIXY_FAKE_PIPELINE=1): replays the built-in Pakkun as if it had just been generated.
// [pose, fraction of the pose window]; walk frames land together like the real sheet.
const TIMELINE: [string, number][] = [
  ['idle_0', 0], ['sit', 0.2], ['bark', 0.35], ['walk_0', 0.5], ['walk_1', 0.5], ['walk_2', 0.5], ['walk_3', 0.5], ['sleep', 0.75], ['roll', 0.9], ['idle_blink', 1],
];

const PERSONALITY: Personality = {
  breed: 'English Cream Golden Retriever', coat: 'Pale cream, feathery and soft', traits: ['Gentle', 'Goofy', 'Foodie'], energy: 'playful',
  lines: ["Hi, I'm Pakkun! Got snacks?", 'Oops, licking my lips again!', 'I love belly rubs the most!', 'Is it treat time yet?'],
};
const FACTS: PetFact[] = [
  { text: 'They love to swim and play fetch for fun.', source: 'https://www.theedadvocate.org/golden-retrievers' },
  { text: 'Their double coat keeps them cosy in cold water.' },
  { text: 'Golden Retrievers were first bred in Scotland.', source: 'https://www.akc.org/dog-breeds/golden-retriever/' },
];

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function fakeCreate(o: { srcDir: string; outDir: string; name: string; species: 'dog' | 'cat'; fast: boolean; emit: (e: PipelineEvent) => void }): Promise<void> {
  const cutoutAt = o.fast ? 500 : 4000;
  const [from, to] = o.fast ? [1000, 4500] : [15_000, 50_000];
  const manifest = JSON.parse(await readFile(join(o.srcDir, 'sprite-manifest.json'), 'utf8')) as SpriteManifest;
  const png = (n: string): Promise<Buffer> => readFile(join(o.srcDir, `${n}.png`));
  const files: Record<string, Buffer | string> = {};
  const names = [...new Set(Object.values(manifest.poses).flatMap((p) => p.frames))];
  for (const f of names) files[f] = await readFile(join(o.srcDir, f));
  files['sprite-manifest.json'] = JSON.stringify({ ...manifest, pet: o.name, species: o.species, personality: { ...PERSONALITY, facts: FACTS } }, null, 2);

  await wait(cutoutAt);
  // Washed out like a flat photo cutout, so the reveal's morph into the 3D idle is visible in rehearsal.
  o.emit({ stage: 'cutout', png: await sharp(await png('idle_0')).modulate({ saturation: 0.15, brightness: 0.92 }).png().toBuffer() });
  let at = cutoutAt;
  const info: [number, PipelineEvent][] = [[cutoutAt + (o.fast ? 400 : 5000), { stage: 'personality', personality: PERSONALITY }], [cutoutAt + (o.fast ? 900 : 11_000), { stage: 'facts', facts: FACTS }]];
  for (const [i, [name, frac]] of TIMELINE.entries()) {
    const t = from + (to - from) * frac;
    while (info[0] && info[0][0] <= t) {
      const [when, ev] = info.shift()!;
      await wait(Math.max(0, when - at));
      at = Math.max(at, when);
      o.emit(ev);
    }
    await wait(Math.max(0, t - at));
    at = Math.max(at, t);
    o.emit({ stage: 'pose', name, png: await png(name), index: i, total: TIMELINE.length });
  }
  await writePack(o.outDir, files);
}
