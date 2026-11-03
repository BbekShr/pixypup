// Give an existing pack the judged walk new packs get: several 8-frame side-view walk sheets (side_0..7) drawn with
// Muse Image at once, and Meta's judge model picks the most consistent one (src/api/walk-judge.ts).
//
//   export MODEL_API_KEY=...            (never put the key in a file)
//   npm run walk-sheet -- <packDir> [--n 4] [--judge muse-wonder-1.0] [--out <dir>]
//
// n Muse Image calls plus one judge call. Writes the frames and the manifest (walk.judge set) to <out> (default
// out/walk-sheet/<pet>/pack, a copy of the pack, so the pack is untouched until you copy it over), and every sheet
// plus the judge's scores to out/walk-sheet/<pet>/.

import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { clientForScripts } from '../src/api/meta-client.js';
import { editImage } from '../src/api/muse-image.js';
import { extractJson, parseResponseText, sparkRequestBody, type SparkResponse } from '../src/api/muse-spark.js';
import { chromaKey, dataUrl, layoutFrames, MAGENTA, POSES, sheetFrames, SIDE_FRAMES, STYLE, validateManifest } from '../src/api/pose-pipeline.js';
import { isStaticSheet } from '../src/api/static-sheet.js';
import { hindLegBalance } from '../src/api/hind-legs.js';
import { JUDGE_MODEL, pickWalkSheet, WALK_JUDGE, WALK_REVIEW, type WalkReview } from '../src/api/walk-judge.js';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { n: { type: 'string', default: '4' }, judge: { type: 'string', default: JUDGE_MODEL }, out: { type: 'string' } } });
const dir = positionals[0];
if (!dir) throw new Error('usage: npm run walk-sheet -- <packDir> [--n 4] [--judge <model>] [--out <dir>]');

type Review = WalkReview & { reason: string };

async function main(): Promise<void> {
  const manifest: unknown = JSON.parse(await readFile(join(dir!, 'sprite-manifest.json'), 'utf8'));
  validateManifest(manifest);
  const idleFile = await readFile(join(dir!, 'idle_0.png'));
  const { height: packH } = await sharp(idleFile).metadata();
  const idle = await sharp(idleFile).trim({ threshold: 0 }).png().toBuffer();
  const refs = [dataUrl(await sharp(idle).flatten({ background: MAGENTA }).extend({ top: 40, bottom: 40, left: 80, right: 80, background: MAGENTA }).png().toBuffer())];
  const prompt = `${STYLE} ${POSES['walk_sheet8']}`;
  const client = clientForScripts();
  const log = `out/walk-sheet/${manifest.pet}`;
  await mkdir(log, { recursive: true });

  const t0 = Date.now();
  const drawn = await Promise.allSettled(Array.from({ length: Number(values.n) }, async (_, i) => {
    const [img] = await editImage(client, prompt, refs);
    const raw = (img as { buffer: Buffer }).buffer;
    await writeFile(`${log}/sheet-${i}.png`, raw);
    const keyed = await chromaKey(raw);
    if (keyed.opaque < 0.02 || keyed.opaque > 0.9 || keyed.edge > 0.01) throw new Error(`sheet ${i}: degenerate`); // as the pipeline
    const frames = await sheetFrames(keyed, 8, 2);
    if (await isStaticSheet(frames)) throw new Error(`sheet ${i}: static`);
    return { i, raw, frames };
  }));
  const ok = drawn.flatMap((d) => (d.status === 'fulfilled' ? [d.value] : []));
  for (const d of drawn) if (d.status === 'rejected') console.log(String((d.reason as Error).message));
  console.log(`${manifest.pet}: ${ok.length}/${values.n} usable sheets in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (!ok.length) throw new Error('no usable sheet');

  const onWhite = async (b: Buffer): Promise<string> => dataUrl(await sharp(b).flatten({ background: '#ffffff' }).png().toBuffer());
  const input = [{ type: 'message', role: 'user', content: [
    { type: 'input_text', text: `Reference pet: a ${manifest.species ?? 'pet'}. ${ok.length} candidate walk cycles follow.` },
    { type: 'input_image', image_url: await onWhite(idle) },
    ...(await Promise.all(ok.map(async (s) => ({ type: 'input_image', image_url: await onWhite(s.raw) })))),
  ] }];
  const t1 = Date.now();
  const res = await client.postJson<SparkResponse>('/responses', { ...sparkRequestBody({ instructions: WALK_JUDGE, input, schema: WALK_REVIEW, name: 'walk_review', effort: 'medium' }), model: values.judge });
  const review = extractJson(parseResponseText(res)) as Review;
  const judged = Number.isInteger(review.best) && review.best >= 0 && review.best < ok.length ? review.best : 0;
  // As the pipeline: the judge's pick unless its back legs barely step and another sheet's do.
  const balance = await Promise.all(ok.map(async (s) => {
    const laid = (await layoutFrames(Object.fromEntries([['idle_0', { png: idle }], ...s.frames.map((f, i) => [`f${i}`, f])]), 'idle_0')).frames;
    return hindLegBalance(s.frames.map((_, i) => laid[`f${i}`]!));
  }));
  const best = pickWalkSheet({ ...review, best: judged, sheets: Array.isArray(review.sheets) ? review.sheets : [] }, balance);
  await writeFile(`${log}/review.json`, JSON.stringify({ judge: values.judge, sheetFiles: ok.map((s) => `sheet-${s.i}.png`), hindLegBalance: balance, ...review }, null, 2));
  console.log(`back/front leg balance: ${ok.map((s, k) => `sheet-${s.i} ${balance[k]?.toFixed(2) ?? '?'}`).join(', ')}`);
  console.log(`${values.judge} picked sheet-${ok[judged]!.i} in ${((Date.now() - t1) / 1000).toFixed(1)} s: ${review.reason}; shipping sheet-${ok[best]!.i}`);

  const out = values.out ?? `${log}/pack`;
  await cp(dir!, out, { recursive: true });
  const keyed = Object.fromEntries([['idle_0', { png: idle }], ...SIDE_FRAMES.map((n, i) => [n, ok[best]!.frames[i]!])]);
  const laid = (await layoutFrames(keyed, 'idle_0')).frames;
  for (const n of SIDE_FRAMES) {
    const f = laid[n]!;
    const { height } = await sharp(f).metadata();
    // Same canvas height as the pack, so the foot line (footY) matches every other pose.
    await writeFile(join(out, `${n}.png`), await sharp(f).extend({ top: Math.max(0, packH! - height!), background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer());
  }
  const walk = manifest.poses['walk'] ?? { fps: 8, footY: manifest.poses['idle']!.footY };
  const next = { ...manifest, poses: { ...manifest.poses, walk: { ...walk, frames: SIDE_FRAMES.map((n) => `${n}.png`), judge: values.judge } } };
  validateManifest(next);
  await writeFile(join(out, 'sprite-manifest.json'), JSON.stringify(next, null, 2));
  console.log(`${out}: walk = sheet-${ok[best]!.i}`);
}

main().catch((err: unknown) => {
  console.error((err as Error).message);
  process.exit(1);
});
