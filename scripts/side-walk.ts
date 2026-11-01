// Give an existing pack the side-profile walk (side_0..3) that new packs get, drawn from its own idle frame.
// Packs made before it walk with 3/4-view frames, where the legs never read as walking.
//
//   export MODEL_API_KEY=...            (never put the key in a file)
//   npm run side-walk -- <packDir> [--sheet raw.png]
//
// One Muse Image call (a few cents); --sheet reuses an already drawn sheet instead. The old manifest is kept
// as sprite-manifest.json.bak.

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { clientForScripts } from '../src/api/meta-client.js';
import { editImage } from '../src/api/muse-image.js';
import { chromaKey, dataUrl, layoutFrames, MAGENTA, POSES, sheetFrames, SIDE_FRAMES, STYLE, validateManifest } from '../src/api/pose-pipeline.js';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { sheet: { type: 'string' } } });
const dir = positionals[0];
if (!dir) throw new Error('usage: npm run side-walk -- <packDir> [--sheet raw.png]');

async function main(): Promise<void> {
  const manifest: unknown = JSON.parse(await readFile(join(dir!, 'sprite-manifest.json'), 'utf8'));
  validateManifest(manifest);
  const idleFile = await readFile(join(dir!, 'idle_0.png'));
  const { height: packH } = await sharp(idleFile).metadata();
  const idle = await sharp(idleFile).trim({ threshold: 0 }).png().toBuffer();

  const draw = async (): Promise<Buffer> => {
    if (values.sheet) return readFile(values.sheet);
    const ref = await sharp(idle).flatten({ background: MAGENTA }).extend({ top: 40, bottom: 40, left: 80, right: 80, background: MAGENTA }).png().toBuffer();
    const [img] = await editImage(clientForScripts(), `${STYLE} ${POSES['walk_sheet']}`, [dataUrl(ref)]);
    return (img as { buffer: Buffer }).buffer;
  };
  let frames;
  for (let tries = values.sheet ? 1 : 3; ; tries--) {
    const raw = await draw();
    await mkdir('out/side-walk', { recursive: true });
    await writeFile(`out/side-walk/${manifest.pet}-sheet.png`, raw); // to judge the drawing
    try {
      const keyed = await chromaKey(raw);
      if (keyed.opaque < 0.02 || keyed.opaque > 0.9 || keyed.edge > 0.01) throw new Error('degenerate sheet'); // as the pipeline
      frames = await sheetFrames(keyed);
      break;
    } catch (err) {
      if (tries <= 1) throw err;
      console.log('Bad sheet, drawing again');
    }
  }

  const keyed = Object.fromEntries([['idle_0', { png: idle }], ...SIDE_FRAMES.map((n, i) => [n, frames[i]!])]);
  const laid = (await layoutFrames(keyed, 'idle_0')).frames;
  for (const n of SIDE_FRAMES) {
    const f = laid[n]!;
    const { height } = await sharp(f).metadata();
    // Same canvas height as the pack, so the foot line (footY) matches every other pose.
    const out = await sharp(f).extend({ top: Math.max(0, packH - height), background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    await writeFile(join(dir!, `${n}.png`), out);
  }
  const walk = manifest.poses['walk'] ?? { fps: 8, footY: manifest.poses['idle']!.footY };
  const next = { ...manifest, poses: { ...manifest.poses, walk: { ...walk, frames: SIDE_FRAMES.map((n) => `${n}.png`) } } };
  validateManifest(next);
  await copyFile(join(dir!, 'sprite-manifest.json'), join(dir!, 'sprite-manifest.json.bak'));
  await writeFile(join(dir!, 'sprite-manifest.json'), JSON.stringify(next, null, 2));
  console.log(`${dir}: walk is now ${next.poses.walk.frames.join(', ')}`);
}

main().catch((err: unknown) => {
  console.error((err as Error).message);
  process.exit(1);
});
