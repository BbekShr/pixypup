// Pose test: the plan's riskiest step. One photo -> SAM cutout -> Muse Image poses -> local
// chroma-key cutouts, written to out/pose-test/ for a human to judge (6 poses or 4?).
//
//   export MODEL_API_KEY=...            (never put the key in a file)
//   npm run pose-test -- [photo] [--species <free text, e.g. husky or monarch butterfly>] [--terminal crop.png] [--only idle,sit]
//
// Defaults to the first image in assets/photos/. Cost per full run: ~1 SAM call + 7 images,
// well under $0.10.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { clientForScripts } from '../src/api/meta-client.js';
import { editImage } from '../src/api/muse-image.js';
import { chromaKey, dataUrl, MAGENTA, normalizePhoto, readPhoto, samCutout } from '../src/api/pose-pipeline.js';
import { motionProfile } from '../src/api/motion-profile.js';
import { posesFor, styleFor } from '../src/api/pose-prompts.js';
import { defaultProfile } from '../src/api/profile-defaults.js';
import { breedFacts, meetPet } from '../src/api/personality.js';
import { segment } from '../src/api/sam.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    species: { type: 'string', default: 'dog' },
    out: { type: 'string' },
    terminal: { type: 'string' },
    only: { type: 'string' },
  },
});

const OUT = values.out ?? 'out/pose-test';

async function firstPhoto(): Promise<string> {
  const dir = 'assets/photos';
  const files = (await readdir(dir)).filter((f) => /\.(jpe?g|png|webp|heic)$/i.test(f)).sort();
  if (files.length === 0) throw new Error(`No photos in ${dir}/. Drop 3-4 full-body shots there.`);
  return join(dir, files[0] as string);
}

async function main(): Promise<void> {
  const client = clientForScripts();
  await mkdir(OUT, { recursive: true });
  const report: string[] = [`# Pose test ${new Date().toISOString()}`, ''];
  const log = (line: string) => {
    console.log(line);
    report.push(line);
  };

  const photoPath = positionals[0] ?? (await firstPhoto());
  log(`Photo: ${photoPath}`);
  const photo = await normalizePhoto(await readPhoto(photoPath));

  let t = Date.now();
  const cutout = await samCutout(client, photo, values.species ?? 'dog');
  if (!cutout) throw new Error(`SAM found no "${values.species}" in ${photoPath}.`);
  await writeFile(join(OUT, 'cutout.png'), cutout);
  log(`- SAM cutout: ${Date.now() - t} ms -> cutout.png`);

  t = Date.now();
  const species = values.species ?? 'dog';
  const live = await motionProfile(client, cutout, 'Pet', species);
  const profile = live ?? defaultProfile(species);
  log(`- Motion profile (${live ? 'Spark' : 'DEFAULT, Spark failed'}): ${Date.now() - t} ms`);
  log(JSON.stringify(profile, null, 2));
  const style = styleFor(profile);
  const POSES = posesFor(profile);

  // Reference on magenta so Muse Image sees the target background too.
  const cutoutOnMagenta = await sharp(cutout).flatten({ background: MAGENTA }).png().toBuffer();
  const refs = [dataUrl(cutoutOnMagenta)];
  const only = values.only?.split(',');
  const names = Object.keys(POSES).filter((p) => !only || only.includes(p) || p === 'idle_0');

  for (const name of names) {
    t = Date.now();
    try {
      const prompt = `${style} ${POSES[name]}` + (refs.length > 1 ? ' Match the character design of the second image exactly.' : '');
      const [edited] = await editImage(client, prompt, refs);
      const raw = (edited as { buffer: Buffer }).buffer;
      await writeFile(join(OUT, `${name}_raw.png`), raw);
      const { png, bleed } = await chromaKey(raw);
      await writeFile(join(OUT, `${name}.png`), png);
      log(`- ${name}: ${Date.now() - t} ms, magenta bleed ${(bleed * 100).toFixed(2)}%`);
      if (name === 'idle_0') refs.push(dataUrl(raw, (edited as { mime: string }).mime));
    } catch (err) {
      log(`- ${name}: FAILED ${(err as Error).message}`);
    }
  }

  const meet = await meetPet(client, cutout, 'Pet', (values.species ?? 'dog'));
  log(`- Meet your pet: ${meet ? JSON.stringify(meet) : 'FAILED (null)'}`);
  if (meet) {
    const facts = await breedFacts(client, meet.breed, (values.species ?? 'dog'));
    log(`- Breed facts: ${facts ? JSON.stringify(facts) : 'FAILED (null)'}`);
  }

  if (values.terminal) {
    const crop = await sharp(await readFile(values.terminal)).png().toBuffer();
    for (const prompt of ['red text', 'red error message', 'error text']) {
      t = Date.now();
      const matches = await segment(client, prompt, dataUrl(crop));
      log(`- SAM terminal "${prompt}": ${matches.length} match(es) in ${Date.now() - t} ms` +
        (matches[0] ? ` first box ${JSON.stringify(matches[0].box)}` : ''));
    }
  }

  report.push('', 'Judge: same dog in every pose? Clean edges? Decide 6 poses or 4 (idle, walk, sit, sleep).');
  await writeFile(join(OUT, 'report.md'), report.join('\n') + '\n');
  console.log(`\nOpen ${OUT}/ and judge the set. Report: ${OUT}/report.md`);
}

main().catch((err: unknown) => {
  console.error((err as Error).message);
  process.exit(1);
});
