// Pose test: the plan's riskiest step. One photo -> SAM cutout -> Muse Image poses -> local
// chroma-key cutouts, written to out/pose-test/ for a human to judge (6 poses or 4?).
//
//   export MODEL_API_KEY=...            (never put the key in a file)
//   npm run pose-test -- [photo] [--species dog] [--terminal crop.png] [--only idle,sit]
//
// Defaults to the first image in assets/photos/. Cost per full run: ~1 SAM call + 7 images,
// well under $0.10.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { clientFromEnv, type MetaClient } from '../src/api/meta-client.js';
import { largest, maskAt, segment } from '../src/api/sam.js';

const OUT = 'out/pose-test';
const IMAGE_MODEL = 'muse-image-1.0';
const MAGENTA = { r: 255, g: 0, b: 255 };

const STYLE =
  'Redraw the exact same pet from the reference photo as a cute chibi sticker character: ' +
  'same breed, same fur colours and markings, same ear shape, big friendly eyes, soft cel shading, ' +
  'thick clean white sticker outline. Full body visible, centred, nothing cropped. ' +
  'Solid flat pure magenta background (#FF00FF) filling the whole canvas, no gradient, ' +
  'no ground shadow, no props, no text.';

// idle_0 is generated first and then fed back as a second reference so every other pose
// copies its character design (the plan's "multi-turn edits with the same reference").
const POSES: Record<string, string> = {
  idle_0: 'Pose: standing on all four legs, side view facing right, tail relaxed.',
  walk_0: 'Pose: mid-walk, side view facing right, front-left and back-right legs forward.',
  walk_1: 'Pose: mid-walk, side view facing right, front-right and back-left legs forward.',
  sit: 'Pose: sitting upright facing the viewer, front paws together.',
  sleep: 'Pose: curled up asleep lying down, eyes closed, side view.',
  bark: 'Pose: barking happily, side view facing right, mouth open, ears perked.',
  roll: 'Pose: rolling over on its back, belly up, paws in the air, playful.',
};

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    species: { type: 'string', default: 'dog' },
    terminal: { type: 'string' },
    only: { type: 'string' },
  },
});

function dataUrl(buf: Buffer, mime = 'image/png'): string {
  return `data:${mime};base64,${buf.toString('base64')}`;
}

async function firstPhoto(): Promise<string> {
  const dir = 'assets/photos';
  const files = (await readdir(dir)).filter((f) => /\.(jpe?g|png|webp|heic)$/i.test(f)).sort();
  if (files.length === 0) throw new Error(`No photos in ${dir}/. Drop 3-4 full-body shots there.`);
  return join(dir, files[0] as string);
}

/** SAM-segment the pet, return a tight transparent PNG cutout. */
async function samCutout(client: MetaClient, png: Buffer, prompt: string): Promise<Buffer | null> {
  const matches = await segment(client, prompt, dataUrl(png));
  const m = largest(matches);
  if (!m) return null;
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const left = Math.max(0, m.box.left);
  const top = Math.max(0, m.box.top);
  const w = Math.min(info.width, m.box.right) - left;
  const h = Math.min(info.height, m.box.bottom) - top;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = ((top + y) * info.width + (left + x)) * 4;
      const dst = (y * w + x) * 4;
      data.copy(out, dst, src, src + 4);
      out[dst + 3] = maskAt(m, x + left - m.box.left, y + top - m.box.top) ? 255 : 0;
    }
  }
  return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

/** Key out the flat magenta background locally (free, instant), then trim. */
async function chromaKey(img: Buffer): Promise<{ png: Buffer; bleed: number }> {
  const { data, info } = await sharp(img).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let bleed = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] as number;
    const g = data[i + 1] as number;
    const b = data[i + 2] as number;
    const dist = Math.hypot(r - MAGENTA.r, g - MAGENTA.g, b - MAGENTA.b);
    if (dist < 90) data[i + 3] = 0;
    else if (dist < 160) {
      // Soft edge; also counts magenta fringe that survived, a sign the key bled.
      data[i + 3] = Math.round(((dist - 90) / 70) * 255);
      if (r > 180 && b > 180 && g < 120) bleed++;
    }
  }
  const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .trim()
    .png()
    .toBuffer();
  return { png, bleed: bleed / (info.width * info.height) };
}

interface ImagesResponse {
  data?: { b64_json?: string; url?: string }[];
}

async function drawPose(client: MetaClient, refs: string[], prompt: string): Promise<Buffer> {
  const res = await client.postJson<ImagesResponse>('/images/edits', {
    model: IMAGE_MODEL,
    prompt,
    images: refs.map((image_url) => ({ image_url })),
    n: 1,
  });
  const item = res.data?.[0];
  if (item?.b64_json) return Buffer.from(item.b64_json, 'base64');
  if (item?.url) return Buffer.from(await (await fetch(item.url)).arrayBuffer());
  throw new Error(`Unexpected Muse Image response: ${JSON.stringify(res).slice(0, 400)}`);
}

async function main(): Promise<void> {
  const client = clientFromEnv();
  await mkdir(OUT, { recursive: true });
  const report: string[] = [`# Pose test ${new Date().toISOString()}`, ''];
  const log = (line: string) => {
    console.log(line);
    report.push(line);
  };

  const photoPath = positionals[0] ?? (await firstPhoto());
  log(`Photo: ${photoPath}`);
  // Normalise to PNG <= 1536px: HEIC/JPEG in, small upload out.
  const photo = await sharp(await readFile(photoPath)).rotate().resize(1536, 1536, { fit: 'inside' }).png().toBuffer();

  let t = Date.now();
  const cutout = await samCutout(client, photo, values.species ?? 'dog');
  if (!cutout) throw new Error(`SAM found no "${values.species}" in ${photoPath}.`);
  await writeFile(join(OUT, 'cutout.png'), cutout);
  log(`- SAM cutout: ${Date.now() - t} ms -> cutout.png`);

  // Reference on magenta so Muse Image sees the target background too.
  const cutoutOnMagenta = await sharp(cutout).flatten({ background: MAGENTA }).png().toBuffer();
  const refs = [dataUrl(cutoutOnMagenta)];
  const only = values.only?.split(',');
  const names = Object.keys(POSES).filter((p) => !only || only.includes(p) || p === 'idle_0');

  for (const name of names) {
    t = Date.now();
    try {
      const prompt = `${STYLE} ${POSES[name]}` + (refs.length > 1 ? ' Match the character design of the second image exactly.' : '');
      const raw = await drawPose(client, refs, prompt);
      await writeFile(join(OUT, `${name}_raw.png`), raw);
      const { png, bleed } = await chromaKey(raw);
      await writeFile(join(OUT, `${name}.png`), png);
      log(`- ${name}: ${Date.now() - t} ms, magenta bleed ${(bleed * 100).toFixed(2)}%`);
      if (name === 'idle_0') refs.push(dataUrl(raw));
    } catch (err) {
      log(`- ${name}: FAILED ${(err as Error).message}`);
    }
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
