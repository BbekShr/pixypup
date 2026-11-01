import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isStaticSheet } from '../static-sheet.js';
import { MetaApiError, type MetaClient, type StreamEvent } from '../meta-client.js';
import {
  bboxIoU,
  chromaKey,
  generateSpritePack,
  layoutFrames,
  NoPetFoundError,
  POSES,
  STYLE,
  sliceSheet,
  writePack,
  type PipelineEvent,
} from '../pose-pipeline.js';
import { validateManifest } from '../manifest.js';
import { posesFor, styleFor } from '../pose-prompts.js';
import { defaultProfile } from '../profile-defaults.js';

const SAM_OUTPUT =
  '<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334|>' +
  "<|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>\n";

async function* samEvents(text: string): AsyncGenerator<StreamEvent> {
  const lane = { item_id: 'm1', output_index: 0, content_index: 0 };
  yield { type: 'response.output_text.delta', delta: text, ...lane };
  yield { type: 'response.output_text.done', text, ...lane };
  yield { type: 'response.completed' };
}

/** Magenta canvas with a green rect of w x h. */
const drawn = (cw: number, ch: number, w: number, h: number) =>
  sharp({ create: { width: cw, height: ch, channels: 3, background: '#ff00ff' } })
    .composite([{ input: { create: { width: w, height: h, channels: 3, background: '#00aa00' } }, left: 10, top: 10 }])
    .png()
    .toBuffer();

/** A sprite sheet: 4 equal blobs separated by wide magenta gaps. */
// default widths differ so the frames are not a static sheet
const sheetImg = (widths = [50, 58, 50, 58]) => {
  let left = 10;
  const blobs = widths.map((w) => {
    // rounded like a real silhouette: a frame cut by a straight edge is rejected as cropped
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="50"><ellipse cx="${w / 2}" cy="25" rx="${w / 2}" ry="25" fill="#00aa00"/></svg>`;
    const b = { input: Buffer.from(svg), left, top: 10 };
    left += w + 50;
    return b;
  });
  return sharp({ create: { width: left, height: 100, channels: 3, background: '#ff00ff' } }).composite(blobs).png().toBuffer();
};
/** The 8-phase walk sheet: 2 rows x 4 columns of rounded blobs with wide gaps; widths differ so it is not static. */
const gridImg = (widths = [50, 58, 50, 58, 54, 46, 54, 46]) => {
  const blobs = widths.map((w, i) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="50"><ellipse cx="${w / 2}" cy="25" rx="${w / 2}" ry="25" fill="#00aa00"/></svg>`;
    return { input: Buffer.from(svg), left: 10 + (i % 4) * 110, top: 10 + Math.floor(i / 4) * 90 };
  });
  return sharp({ create: { width: 460, height: 170, channels: 3, background: '#ff00ff' } }).composite(blobs).png().toBuffer();
};
const defaultImage = (pose: string) =>
  pose === 'walk_sheet8' ? gridImg() : pose === 'walk_sheet' ? sheetImg() : pose === 'turn_sheet' ? sheetImg([50, 50, 50, 50, 50]) : drawn(100, 100, 50, 50);

const photo = () => sharp({ create: { width: 320, height: 334, channels: 3, background: '#888' } }).png().toBuffer();

interface FakeOpts {
  delayMs?: number;
  fail?: (pose: string) => Error | boolean;
  sam?: string;
  image?: (pose: string) => Promise<Buffer>;
  /** honour the abort signal and never resolve for this pose on these attempts */
  hang?: (pose: string, attempt: number) => boolean;
  signals?: AbortSignal[];
  /** answers POST /responses (Muse Spark); absent = Spark fails */
  spark?: (body: Record<string, unknown>) => Promise<unknown>;
  sparkLog?: string[];
  /** prompts to recognise poses by; default the dog's */
  poses?: Record<string, string>;
}

function fakeClient(o: FakeOpts = {}) {
  const requested: string[] = [];
  const prompts: string[] = [];
  const seen: Record<string, number> = {};
  const stats = { inflight: 0, maxInflight: 0 };
  const client = {
    postStream: () => samEvents(o.sam ?? SAM_OUTPUT),
    postJson: async (path: string, body: { prompt: string }, signal?: AbortSignal) => {
      if (path === '/responses') {
        o.sparkLog?.push(`spark:${requested.length}`);
        if (!o.spark) throw new Error('spark down');
        return o.spark(body as unknown as Record<string, unknown>);
      }
      const lookup = o.poses ?? POSES;
      const pose = Object.keys(lookup).find((k) => body.prompt.includes(lookup[k] as string)) as string;
      requested.push(pose);
      prompts.push(body.prompt);
      const attempt = (seen[pose] = (seen[pose] ?? 0) + 1);
      if (pose === 'sit' && signal) o.signals?.push(signal);
      if (o.hang?.(pose, attempt)) {
        await new Promise((_, rej) => signal?.addEventListener('abort', () => rej(new Error('aborted'))));
      }
      stats.maxInflight = Math.max(stats.maxInflight, ++stats.inflight);
      await new Promise((r) => setTimeout(r, o.delayMs ?? 0));
      stats.inflight--;
      const f = o.fail?.(pose);
      if (f) throw f instanceof Error ? f : new Error(`boom ${pose}`);
      const png = o.image ? await o.image(pose) : await defaultImage(pose);
      const webp = await sharp(png).webp({ lossless: true }).toBuffer();
      return { data: [{ b64_json: webp.toString('base64') }] };
    },
  } as unknown as MetaClient;
  return { client, requested, prompts, stats };
}

describe('chromaKey', () => {
  it('clears the background and trims to the subject', async () => {
    const { png } = await chromaKey(await drawn(100, 100, 40, 30));
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([40, 30]);
    expect(data[3]).toBe(255);
    expect(data[(info.width * 15 + 20) * 4 + 3]).toBe(255);
  });

  it('makes the magenta background transparent', async () => {
    // 100x100 with the square inset: after keying, untrimmed alpha outside would be 0.
    const raw = await drawn(100, 100, 40, 30);
    const { data } = await sharp(raw).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(data[3]).toBe(255); // sanity: input is opaque
    const { info } = await sharp((await chromaKey(raw)).png).raw().toBuffer({ resolveWithObject: true });
    expect(info.width * info.height).toBe(40 * 30); // background rows/cols were all transparent
  });
});

async function drawnHeight(png: Buffer): Promise<number> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let rows = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if ((data[(y * info.width + x) * 4 + 3] as number) > 0) {
        rows++;
        break;
      }
    }
  }
  return rows;
}

describe('chromaKey colour handling', () => {
  const px = (r: number, g: number, b: number) => ({ create: { width: 20, height: 20, channels: 3 as const, background: { r, g, b } } });
  const subject = async (patch: [number, number, number]) =>
    sharp({ create: { width: 100, height: 100, channels: 3, background: '#ff00ff' } })
      .composite([
        { input: await sharp(px(0, 170, 0)).png().toBuffer(), left: 20, top: 20 },
        { input: await sharp(px(...patch)).png().toBuffer(), left: 40, top: 40 },
      ])
      .png()
      .toBuffer();
  const at = async (png: Buffer, x: number, y: number) => {
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const i = (y * info.width + x) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]] as number[];
  };

  it.each([
    [255, 110, 150],
    [255, 105, 180],
  ])('keeps a pink (%i,%i,%i) patch inside the subject opaque', async (r, g, b) => {
    const { png } = await chromaKey(await subject([r, g, b]));
    // subject trims to 20..60 on both axes, so the patch centre is at (30,30)
    expect((await at(png, 30, 30))[3]).toBe(255);
  });

  it('removes the magenta cast from an anti-aliased edge pixel', async () => {
    const img = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#ff00ff' } })
      .composite([
        { input: await sharp(px(0, 170, 0)).png().toBuffer(), left: 20, top: 20 },
        { input: await sharp({ create: { width: 1, height: 1, channels: 3, background: { r: 255, g: 128, b: 255 } } }).png().toBuffer(), left: 19, top: 30 },
      ])
      .png()
      .toBuffer();
    const { png, bleed } = await chromaKey(img);
    const [r, g, b, a] = await at(png, 0, 10);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(255);
    expect(Math.min(r as number, b as number) - (g as number)).toBeLessThan(40);
    expect(bleed).toBe(0);
  });
});

describe('chromaKey soft fur fringe', () => {
  it('leaves no magenta cast on a semi-transparent cream fringe', async () => {
    // 64 px wide ramp: cream coat alpha 1 -> 0 over magenta, like soft fur on the flat background.
    const W = 64;
    const buf = Buffer.alloc(W * 8 * 3);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < W; x++) {
        const a = 1 - x / (W - 1);
        const i = (y * W + x) * 3;
        buf[i] = Math.round(a * 240 + (1 - a) * 255);
        buf[i + 1] = Math.round(a * 220);
        buf[i + 2] = Math.round(a * 180 + (1 - a) * 255);
      }
    }
    const { png, bleed } = await chromaKey(await sharp(buf, { raw: { width: W, height: 8, channels: 3 } }).png().toBuffer());
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let semi = 0;
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i + 3] as number) === 0) continue;
      if ((data[i + 3] as number) < 255) semi++;
      // keyer's dead zone: a mix under 25% magenta (gap 64) stays; anything redder must be removed or made transparent
      expect(Math.min(data[i] as number, data[i + 2] as number) - (data[i + 1] as number)).toBeLessThanOrEqual(64);
    }
    expect(semi).toBeGreaterThan(0);
    expect(info.width).toBeGreaterThan(10);
    expect(bleed).toBe(0);
  });
});

const solid = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 4, background: '#0a0' } }).png().toBuffer();

describe('layoutFrames', () => {
  it('scales idle to 256 px and shares one canvas and footY', async () => {
    const out = await layoutFrames(
      { idle_0: { png: await solid(100, 50), rawHeight: 200 }, sit: { png: await solid(40, 80), rawHeight: 200 } },
      'idle_0',
    );
    for (const f of Object.values(out.frames)) {
      const m = await sharp(f).metadata();
      expect([m.width, m.height]).toEqual([out.width, out.height]);
    }
    expect(out.height).toBe(256 + 2);
    expect(out.footY).toBeCloseTo((out.height - 2) / out.height);
    expect(await drawnHeight(out.frames.idle_0)).toBe(256);
  });

  it('ends a smaller-drawn standing pose (walk, blink, sit) at idle height', async () => {
    const out = await layoutFrames(
      {
        idle_0: { png: await solid(100, 50), rawHeight: 200 },
        walk_0: { png: await solid(80, 40), rawHeight: 200 },
        walk_3: { png: await solid(200, 100), rawHeight: 400 },
        idle_blink: { png: await solid(100, 50), rawHeight: 200 },
      },
      'idle_0',
    );
    for (const n of ['walk_0', 'walk_3', 'idle_blink']) expect(await drawnHeight(out.frames[n] as Buffer)).toBe(256);
  });

  it('clamps a wildly small drawing to 0.6..1.6 of the raw-canvas estimate', async () => {
    const out = await layoutFrames(
      { idle_0: { png: await solid(100, 50), rawHeight: 200 }, walk_0: { png: await solid(20, 10), rawHeight: 200 } },
      'idle_0',
    );
    expect(await drawnHeight(out.frames.walk_0 as Buffer)).toBe(Math.round(10 * 1.6 * 5.12));
  });

  it('gives the profile walk one shared scale and its own wider canvas at the same height', async () => {
    const out = await layoutFrames(
      {
        idle_0: { png: await solid(100, 50), rawHeight: 200 },
        side_0: { png: await solid(100, 50) },
        side_1: { png: await solid(90, 40) }, // shorter: a lifted paw, not a smaller dog
      },
      'idle_0',
    );
    expect(out.width).toBe(256 * 2);
    const side0 = await sharp(out.frames.side_0 as Buffer).metadata();
    expect([side0.width, side0.height]).toEqual([Math.round(100 * 256 / 50), out.height]);
    expect(await drawnHeight(out.frames.side_0 as Buffer)).toBe(256);
    expect(await drawnHeight(out.frames.side_1 as Buffer)).toBe(Math.round(40 * 256 / 50));
  });

  it('sizes a lying pose to 1.1 x idle width', async () => {
    const out = await layoutFrames(
      { idle_0: { png: await solid(100, 50), rawHeight: 200 }, sleep: { png: await solid(130, 40), rawHeight: 200 } },
      'idle_0',
    );
    expect(out.width).toBe(Math.round(1.1 * 100 * 5.12));
    expect(out.height).toBe(256 + 2);
  });

  it('does not clamp sheet slices (no raw canvas)', async () => {
    const out = await layoutFrames(
      { idle_0: { png: await solid(100, 50), rawHeight: 200 }, walk_0: { png: await solid(20, 10) } },
      'idle_0',
    );
    expect(await drawnHeight(out.frames.walk_0 as Buffer)).toBe(256);
  });

  it('keeps a pose wider than idle whole', async () => {
    const out = await layoutFrames(
      { idle_0: { png: await solid(100, 50), rawHeight: 200 }, walk_0: { png: await solid(200, 50), rawHeight: 200 } },
      'idle_0',
    );
    expect(out.width).toBe(Math.round(200 * (256 / 50)));
    const { data } = await sharp(out.frames.walk_0).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let opaque = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] === 255) opaque++;
    expect(opaque).toBe(Math.round(200 * (256 / 50)) * 256);
  });
});

describe('sliceSheet', () => {
  const sheet = (blobs: [number, number][], W = 400, H = 20) => {
    const buf = Buffer.alloc(W * H * 4);
    // rounded blobs (column height peaks mid-frame), like real silhouettes
    for (const [x0, w] of blobs) {
      for (let x = x0; x < x0 + w; x++) {
        const half = Math.max(1, Math.round(8 * Math.sin((Math.PI * (x - x0 + 0.5)) / w)));
        for (let y = 10 - half; y < 10 + half; y++) buf[(y * W + x) * 4 + 3] = 255;
      }
    }
    return { buf, W, H };
  };
  it('finds 4 equal runs', () => {
    const { buf, W, H } = sheet([[10, 50], [110, 50], [210, 50], [310, 50]]);
    expect(sliceSheet(buf, W, H, 4)).toEqual([{ x0: 10, x1: 59 }, { x0: 110, x1: 159 }, { x0: 210, x1: 259 }, { x0: 310, x1: 359 }]);
  });
  it('splits frames that nearly touch (1-px gutters) and keeps each frame whole', () => {
    const { buf, W, H } = sheet([[5, 90], [96, 99], [196, 99], [296, 99]]);
    expect(sliceSheet(buf, W, H, 4)).toEqual([{ x0: 5, x1: 94 }, { x0: 96, x1: 194 }, { x0: 196, x1: 294 }, { x0: 296, x1: 394 }]);
  });
  it('rejects a cut through a solid body (no gap near a boundary)', () => {
    const { buf, W, H } = sheet([[0, 400]]);
    expect(sliceSheet(buf, W, H, 4)).toBeNull();
  });
  it('slices a real Muse walk sheet (frames nearly touch)', async () => {
    const { data, info } = await sharp(new URL('./fixtures/walk-sheet-keyed.png', import.meta.url).pathname)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const runs = sliceSheet(data, info.width, info.height, 4);
    expect(runs).toHaveLength(4);
    for (const r of runs!) expect(r.x1 - r.x0 + 1).toBeGreaterThanOrEqual(120);
    for (const r of runs!) expect(r.x1 - r.x0 + 1).toBeLessThanOrEqual(200);
    for (let i = 1; i < 4; i++) expect(runs![i]!.x0).toBeGreaterThan(runs![i - 1]!.x1);
  });
  it('rejects frames cut by a straight edge (a sheet drawn as cropped panels)', () => {
    const { buf, W, H } = sheet([[10, 50], [110, 50], [210, 50], [310, 50]]);
    for (const x0 of [10, 110, 210, 310]) for (let y = 3; y < 17; y++) buf[(y * W + x0) * 4 + 3] = 255; // a flat back edge
    expect(sliceSheet(buf, W, H, 4)).toBeNull();
  });
  it('rejects 3 blobs, 5 blobs and unequal widths', () => {
    const three = sheet([[10, 50], [110, 50], [210, 50]]);
    expect(sliceSheet(three.buf, three.W, three.H, 4)).toBeNull();
    const five = sheet([[10, 30], [60, 30], [110, 30], [160, 30], [210, 30]]);
    expect(sliceSheet(five.buf, five.W, five.H, 4)).toBeNull();
    const unequal = sheet([[10, 50], [110, 50], [210, 50], [310, 20]]);
    expect(sliceSheet(unequal.buf, unequal.W, unequal.H, 4)).toBeNull();
  });
});

describe('bboxIoU', () => {
  const b = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });
  it('is 1 for identical, 0 for disjoint, partial otherwise', () => {
    expect(bboxIoU(b(0, 0, 9, 9), b(0, 0, 9, 9))).toBe(1);
    expect(bboxIoU(b(0, 0, 9, 9), b(20, 20, 29, 29))).toBe(0);
    expect(bboxIoU(b(0, 0, 9, 9), b(5, 0, 14, 9))).toBeCloseTo(50 / 150);
  });
});

const PERSONA = {
  breed: 'Shiba Inu',
  coat: 'red',
  traits: ['a', 'b', 'c'],
  energy: 'normal',
  lines: ['one', 'two', 'three', 'four', 'five', 'six'],
};
const sparkName = (b: Record<string, unknown>) => (b.text as { format: { name: string } }).format.name;
const sparkReply = (body: Record<string, unknown>) => {
  const isFacts = body.tools !== undefined;
  const t = isFacts ? { facts: [{ text: 'Old breed.', source: 'https://a.org' }] } : PERSONA;
  return {
    status: 'completed',
    output: [
      { type: 'web_search_call' },
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(t), annotations: [{ type: 'url_citation', url: 'https://a.org' }] }] },
    ],
  };
};

describe('generateSpritePack', () => {
  let root: string;
  let out: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pixy-test-'));
    out = join(root, 'pack');
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  const run = async (o: FakeOpts, events: PipelineEvent[] = []) => {
    const { client, requested, stats } = fakeClient(o);
    const p = generateSpritePack({
      client,
      photo: await photo(),
      petName: 'Pakkun',
      species: 'dog',
      outDir: out,
      onProgress: (e) => events.push(e),
      timing: { timeoutMs: o.hang ? 50 : 60_000, backoffMs: 1 },
    });
    return { p, requested, stats };
  };

  it('emits cutout, 19 poses, done, and writes the pack', async () => {
    const events: PipelineEvent[] = [];
    const { p } = await run({}, events);
    const manifest = await p;
    expect(events.map((e) => e.stage)).toEqual(['cutout', 'profile', ...Array(19).fill('pose'), 'done']);
    expect((await readdir(out)).sort()).toEqual([
      'bark.png',
      'idle_0.png',
      'idle_blink.png',
      'roll.png',
      'side_0.png',
      'side_1.png',
      'side_2.png',
      'side_3.png',
      'side_4.png',
      'side_5.png',
      'side_6.png',
      'side_7.png',
      'sit.png',
      'sleep.png',
      'sprite-manifest.json',
      'turn_back.png',
      'turn_back34.png',
      'turn_front.png',
      'turn_front34.png',
      'turn_side.png',
    ]);
    expect(JSON.parse(await readFile(join(out, 'sprite-manifest.json'), 'utf8'))).toEqual(manifest);
    expect(manifest.poses.walk?.fps).toBe(8);
    expect(manifest.poses.blink?.frames).toEqual(['idle_blink.png']);
    expect(manifest.poses.blink?.footY).toBe(manifest.poses.idle?.footY);
    expect(manifest.poses.walk?.frames).toEqual(Array.from({ length: 8 }, (_, i) => `side_${i}.png`)); // the 8-phase walk
    expect(await readdir(root)).toEqual(['pack']);
  });

  it('draws idle, then the turnaround, then the walk sheet, sit, sleep, bark, roll and blink in parallel (8 requests)', async () => {
    const { p, requested, stats } = await run({ delayMs: 50 });
    await p;
    expect(requested[0]).toBe('idle_0');
    expect(requested[1]).toBe('turn_sheet');
    expect(requested.slice(2).sort()).toEqual(['bark', 'idle_blink', 'roll', 'sit', 'sleep', 'walk_sheet8']);
    expect(stats.maxInflight).toBe(6); // idle alone, then the other 6 at once; serial would peak at 1
  });

  it('references: idle alone for blink, cutout+idle for the others', async () => {
    const refCount: Record<string, number> = {};
    const { client } = fakeClient();
    const post = client.postJson.bind(client) as (path: string, body: { prompt: string; images: unknown[] }, s?: AbortSignal) => Promise<unknown>;
    (client as unknown as { postJson: typeof post }).postJson = (path, body, sig) => {
      const name = Object.keys(POSES).find((k) => body.prompt.includes(POSES[k] as string)) as string;
      refCount[name] = body.images.length;
      if (name === 'idle_blink') expect(body.prompt).toBe(POSES.idle_blink);
      else expect(body.prompt.startsWith(STYLE)).toBe(true);
      return post(path, body, sig);
    };
    await generateSpritePack({ client, photo: await photo(), petName: 'P', species: 'dog', outDir: out, timing: { backoffMs: 1 } });
    expect(refCount).toEqual({ idle_0: 1, turn_sheet: 2, walk_sheet8: 3, sit: 3, sleep: 3, bark: 3, roll: 3, idle_blink: 2 });
  });

  it.each([
    ['3 blobs', () => sheetImg().then((b) => sharp(b).composite([{ input: { create: { width: 60, height: 100, channels: 3, background: '#ff00ff' } }, left: 310, top: 0 }]).png().toBuffer())],
    ['unequal widths', () => sheetImg([50, 50, 50, 20])],
    ['one blob', () => drawn(100, 100, 50, 50)],
  ])('omits the walk instead of copying idle when the walk sheet is bad (%s): 2 grid tries, 1 four-frame try, 1 pair try', async (_n, make) => {
    const events: PipelineEvent[] = [];
    const { p, requested } = await run({ image: async (n) => (n.startsWith('walk_sheet') ? make() : n === 'walk_pair' ? drawn(100, 100, 50, 50) : defaultImage(n)) }, events);
    const manifest = await p;
    expect(requested.filter((n) => n === 'walk_sheet8')).toHaveLength(2);
    expect(requested.filter((n) => n === 'walk_sheet')).toHaveLength(1);
    expect(requested.filter((n) => n === 'walk_pair')).toHaveLength(1);
    const failed = events.filter((e) => e.stage === 'pose-failed').map((e) => e.stage === 'pose-failed' && e.name);
    expect(failed).toEqual([...Array.from({ length: 8 }, (_, i) => `side_${i}`), 'walk']);
    expect(manifest.poses.walk).toBeUndefined();
    expect(events.filter((e) => e.stage === 'pose')).toHaveLength(19);
    expect((await readdir(out)).filter((f) => f.startsWith('side_'))).toEqual([]);
  });

  describe('static walk sheet (husky pack fixture)', () => {
    const fx = (f: string) => readFile(new URL(`./fixtures/husky-pack/${f}`, import.meta.url));
    /** The husky's 4 identical side frames laid out as one sheet on magenta. */
    const staticSheet = async () => {
      const side = await fx('side_0.png');
      const { width } = await sharp(side).metadata();
      const w = width as number;
      return sharp({ create: { width: 4 * (w + 60) + 20, height: 280, channels: 3, background: '#ff00ff' } })
        .composite([0, 1, 2, 3].map((i) => ({ input: side, left: 10 + i * (w + 60), top: 10 })))
        .png()
        .toBuffer();
    };
    /** The same 4 identical frames as an 8-cell 2 x 4 grid. */
    const staticGrid = async () => {
      const side = await fx('side_0.png');
      const { width } = await sharp(side).metadata();
      const w = width as number;
      return sharp({ create: { width: 4 * (w + 60) + 20, height: 580, channels: 3, background: '#ff00ff' } })
        .composite(Array.from({ length: 8 }, (_, i) => ({ input: side, left: 10 + (i % 4) * (w + 60), top: 10 + Math.floor(i / 4) * 290 })))
        .png()
        .toBuffer();
    };

    it('isStaticSheet is true for the real identical frames and false for different shapes', async () => {
      const same = await Promise.all([0, 1, 2, 3].map(async (i) => ({ png: await fx(`side_${i}.png`) })));
      expect(await isStaticSheet(same)).toBe(true);
      const wide = { png: await sharp({ create: { width: 300, height: 100, channels: 4, background: '#0a0' } }).png().toBuffer() };
      expect(await isStaticSheet([same[0]!, wide])).toBe(false);
    });

    it('rejects a sheet of identical slices and retries it', async () => {
      const events: PipelineEvent[] = [];
      const [grid, sheetPng] = [await staticGrid(), await staticSheet()];
      const { p, requested } = await run({ image: async (n) => (n === 'walk_sheet8' ? grid : n === 'walk_sheet' ? sheetPng : defaultImage(n)) }, events);
      await p;
      expect(requested.filter((n) => n === 'walk_sheet8')).toHaveLength(2);
      expect(events.find((e) => e.stage === 'pose-failed' && e.name === 'walk')).toMatchObject({ error: 'bad-output' });
    });

    it('falls back to a 2-frame sheet: stride, idle, stride, idle', async () => {
      const events: PipelineEvent[] = [];
      const [grid, sheetPng] = [await staticGrid(), await staticSheet()];
      const { p, requested } = await run(
        { image: async (n) => (n === 'walk_sheet8' ? grid : n === 'walk_sheet' ? sheetPng : n === 'walk_pair' ? sheetImg([50, 70]) : defaultImage(n)) },
        events,
      );
      const manifest = await p;
      expect(requested.filter((n) => n.startsWith('walk_'))).toHaveLength(4); // grid x2, four-frame sheet, pair: the worst case
      expect(events.some((e) => e.stage === 'pose' && e.name === 'side_4')).toBe(false);
      expect(manifest.poses.walk?.frames).toEqual(['side_0.png', 'side_1.png', 'side_2.png', 'side_3.png']);
      expect(events.some((e) => e.stage === 'pose-failed')).toBe(false);
      const px = async (f: string) => sharp(await readFile(join(out, f))).raw().toBuffer();
      expect(await px('side_1.png')).toEqual(await px('side_3.png'));
      expect((await px('side_0.png')).equals(await px('side_1.png'))).toBe(false);
      expect((await px('side_0.png')).equals(await px('side_2.png'))).toBe(false);
    });
  });

  it('falls back to the 4-frame sheet when the grid is bad, with 3 walk calls', async () => {
    const events: PipelineEvent[] = [];
    const { p, requested } = await run({ image: async (n) => (n === 'walk_sheet8' ? drawn(100, 100, 50, 50) : defaultImage(n)) }, events);
    const manifest = await p;
    expect(requested.filter((n) => n.startsWith('walk_'))).toEqual(['walk_sheet8', 'walk_sheet8', 'walk_sheet']);
    expect(manifest.poses.walk?.frames).toEqual(['side_0.png', 'side_1.png', 'side_2.png', 'side_3.png']);
    expect(events.filter((e) => e.stage === 'pose')).toHaveLength(15);
    expect(events.some((e) => e.stage === 'pose-failed')).toBe(false);
  });

  it('slices a good sheet into 8 walk frames at idle height', async () => {
    const { p } = await run({});
    await p;
    for (let i = 0; i < 8; i++) expect(await drawnHeight(await readFile(join(out, `side_${i}.png`)))).toBe(256);
  });

  it('falls back to idle when the blink jumps (IoU < 0.85)', async () => {
    const events: PipelineEvent[] = [];
    const moved = () => sharp({ create: { width: 100, height: 100, channels: 3, background: '#ff00ff' } })
      .composite([{ input: { create: { width: 50, height: 50, channels: 3, background: '#00aa00' } }, left: 40, top: 40 }]).png().toBuffer();
    const { p, requested } = await run({ image: async (n) => (n === 'idle_blink' ? moved() : defaultImage(n)) }, events);
    await p;
    expect(requested.filter((n) => n === 'idle_blink')).toHaveLength(2);
    expect(events.find((e) => e.stage === 'pose-failed')).toMatchObject({ name: 'idle_blink', error: 'bad-output' });
    expect(await readFile(join(out, 'idle_blink.png'))).toEqual(await readFile(join(out, 'idle_0.png')));
  });

  it('keeps a blink that stays put', async () => {
    const events: PipelineEvent[] = [];
    const { p } = await run({}, events);
    await p;
    expect(events.some((e) => e.stage === 'pose-failed')).toBe(false);
  });

  it('falls back to idle when a pose fails', async () => {
    const events: PipelineEvent[] = [];
    const { p } = await run({ fail: (n) => n === 'sit' }, events);
    await p;
    expect(events.find((e) => e.stage === 'pose-failed')).toMatchObject({ name: 'sit' });
    expect(await readFile(join(out, 'sit.png'))).toEqual(await readFile(join(out, 'idle_0.png')));
  });

  it('rejects instead of hanging when SAM never answers', async () => {
    const { client } = fakeClient();
    (client as unknown as { postStream: unknown }).postStream = async function* (_p: string, _b: unknown, signal?: AbortSignal) {
      await new Promise((_, rej) => signal?.addEventListener('abort', () => rej(new Error('aborted'))));
      yield {};
    };
    await expect(
      generateSpritePack({ client, photo: await photo(), petName: 'P', species: 'dog', outDir: out, timing: { timeoutMs: 50, backoffMs: 1 } }),
    ).rejects.toThrow();
  }, 3000);

  it('throws NoPetFoundError when SAM finds nothing', async () => {
    const { p } = await run({ sam: '' });
    await expect(p).rejects.toBeInstanceOf(NoPetFoundError);
  });

  it('keeps an existing pack when idle fails, and leaves no temp dir', async () => {
    await mkdir(out);
    await writeFile(join(out, 'keep.txt'), 'old');
    const { p } = await run({ fail: (n) => n === 'idle_0' });
    await expect(p).rejects.toThrow(/boom/);
    expect(await readdir(root)).toEqual(['pack']);
    expect(await readdir(out)).toEqual(['keep.txt']);
  });

  it('replaces an existing pack cleanly', async () => {
    await mkdir(out);
    await writeFile(join(out, 'keep.txt'), 'old');
    const { p } = await run({});
    await p;
    expect(await readdir(root)).toEqual(['pack']);
    expect(await readdir(out)).not.toContain('keep.txt');
  });

  it('aborts a hung attempt, backs off, retries once and then succeeds', async () => {
    const signals: AbortSignal[] = [];
    const { p, requested } = await run({ hang: (n, a) => n === 'sit' && a === 1, signals });
    await p;
    expect(requested.filter((n) => n === 'sit')).toHaveLength(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });

  it('gives up after two attempts and reports a timeout', async () => {
    const events: PipelineEvent[] = [];
    const { p, requested } = await run({ hang: (n) => n === 'sit' }, events);
    await p;
    expect(requested.filter((n) => n === 'sit')).toHaveLength(2);
    expect(events.find((e) => e.stage === 'pose-failed')).toMatchObject({ name: 'sit', error: 'timeout' });
  });

  it('never lets a throwing onProgress change the result', async () => {
    const { client } = fakeClient();
    const manifest = await generateSpritePack({
      client,
      photo: await photo(),
      petName: 'Pakkun',
      species: 'dog',
      outDir: out,
      onProgress: () => {
        throw new Error('ui bug');
      },
      timing: { backoffMs: 1 },
    });
    expect(Object.keys(manifest.poses)).toHaveLength(8);
    expect(await readdir(out)).toContain('sprite-manifest.json');
  });

  it.each([
    ['all magenta', () => sharp({ create: { width: 100, height: 100, channels: 3, background: '#ff00ff' } }).png().toBuffer()],
    ['all subject', () => sharp({ create: { width: 100, height: 100, channels: 3, background: '#00aa00' } }).png().toBuffer()],
    ['touches the canvas edge', () => drawn(100, 100, 100, 50)],
  ])('treats a degenerate pose (%s) as a failure and retries', async (_n, make) => {
    const events: PipelineEvent[] = [];
    const { p, requested } = await run({ image: async (n) => (n === 'sit' ? make() : defaultImage(n)) }, events);
    await p;
    expect(requested.filter((n) => n === 'sit')).toHaveLength(2);
    expect(events.find((e) => e.stage === 'pose-failed')).toMatchObject({ name: 'sit', error: 'bad-output' });
  });

  it('emits a body-free pose-failed and a fallback pose event so 19 pose events always arrive', async () => {
    const events: PipelineEvent[] = [];
    const { p } = await run({ fail: (n) => (n === 'bark' ? new MetaApiError(500, 'SECRET-BODY', '/images/edits') : false) }, events);
    await p;
    const failed = events.find((e) => e.stage === 'pose-failed');
    expect(failed).toMatchObject({ name: 'bark', error: 'generation-failed (HTTP 500)' });
    expect(JSON.stringify(events.filter((e) => e.stage !== 'pose' && e.stage !== 'cutout'))).not.toContain('SECRET-BODY');
    const poses = events.filter((e) => e.stage === 'pose');
    expect(poses).toHaveLength(19);
    expect(poses.find((e) => e.stage === 'pose' && e.name === 'bark')).toMatchObject({ fallback: true });
  });
});

describe('writePack', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pixy-wp-'));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it('restores the old pack when publishing the new one fails', async () => {
    const out = join(root, 'pack');
    await mkdir(out);
    await writeFile(join(out, 'old.txt'), 'old');
    let calls = 0;
    const mv = (async (from: string, to: string) => {
      if (++calls === 2) throw new Error('disk full');
      return (await import('node:fs/promises')).rename(from, to);
    }) as typeof import('node:fs/promises').rename;
    await expect(writePack(out, { 'new.txt': 'new' }, mv)).rejects.toThrow('disk full');
    expect(await readdir(out)).toEqual(['old.txt']);
    expect(await readdir(root)).toEqual(['pack']);
  });

  it('handles a trailing slash and a missing old pack', async () => {
    await writePack(join(root, 'pack') + '/', { 'a.txt': 'a' });
    expect(await readdir(root)).toEqual(['pack']);
    expect(await readdir(join(root, 'pack'))).toEqual(['a.txt']);
  });

  it('does not treat a non-ENOENT failure as "no old pack"', async () => {
    const out = join(root, 'pack');
    await mkdir(out);
    const mv = (async () => {
      throw Object.assign(new Error('perm'), { code: 'EACCES' });
    }) as unknown as typeof import('node:fs/promises').rename;
    await expect(writePack(out, { 'a.txt': 'a' }, mv)).rejects.toThrow('perm');
    expect(await readdir(root)).toEqual(['pack']);
  });
});

describe('meet your pet in the pipeline', () => {
  let root: string;
  let out: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pixy-test-'));
    out = join(root, 'pack');
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  const run = async (o: FakeOpts, events: PipelineEvent[] = [], timing: Record<string, number> = {}) => {
    const { client } = fakeClient(o);
    const p = generateSpritePack({
      client,
      photo: await photo(),
      petName: 'Pakkun',
      species: 'dog',
      outDir: out,
      onProgress: (e) => events.push(e),
      timing: { timeoutMs: 60_000, backoffMs: 1, sparkGraceMs: 100, ...timing },
    });
    return { p };
  };

  it('meets the pet beside the poses: events fire, personality and facts land in the manifest', async () => {
    const events: PipelineEvent[] = [];
    const sparkLog: string[] = [];
    const { p } = await run({ spark: async (b) => sparkReply(b), sparkLog, delayMs: 20 }, events);
    const manifest = await p;
    const stages = events.map((e) => e.stage);
    expect(stages).toContain('personality');
    expect(stages.indexOf('facts')).toBeGreaterThan(stages.indexOf('personality'));
    expect(stages.indexOf('personality')).toBeLessThan(stages.indexOf('done'));
    expect(manifest.personality).toMatchObject({ breed: 'Shiba Inu', facts: [{ text: 'Old breed.', source: 'https://a.org' }] });
    expect(JSON.parse(await readFile(join(out, 'sprite-manifest.json'), 'utf8')).personality.energy).toBe('normal');
    // Spark starts right after the cutout, before idle (the first Muse Image request) completes.
    expect(sparkLog[0]).toBe('spark:0');
  });

  it('still succeeds, with no personality, when Spark fails', async () => {
    const events: PipelineEvent[] = [];
    const { p } = await run({}, events);
    const manifest = await p;
    expect(manifest.personality).toBeUndefined();
    expect(events.map((e) => e.stage)).not.toContain('personality');
    expect(events.at(-1)?.stage).toBe('done');
  });

  it('a slow Spark that finishes within the poses adds no wall time', async () => {
    // Spark must overlap the poses (start before the pose requests, end before the pack is done),
    // so total time is the poses' time.
    const log: string[] = [];
    const slow = async (b: Record<string, unknown>) => {
      log.push('spark-start');
      await new Promise((r) => setTimeout(r, 40));
      log.push('spark-end');
      return sparkReply(b);
    };
    const events: PipelineEvent[] = [];
    const sparkLog: string[] = [];
    const manifest = await (await run({ delayMs: 60, spark: slow, sparkLog }, events)).p;
    expect(sparkLog[0]).toBe('spark:0'); // started before any pose request
    expect(log.filter((x) => x === 'spark-end')).toHaveLength(3); // profile, meetPet, breedFacts, all done before the pack
    expect(manifest.personality).toBeDefined(); // finished inside the grace, was not cut
    expect(events.at(-1)?.stage).toBe('done');
  });

  it('does not wait for a hanging Spark past the grace period, and aborts it', async () => {
    const events: PipelineEvent[] = [];
    let signal: AbortSignal | undefined;
    const hang = (_b: Record<string, unknown>) => new Promise(() => undefined);
    const { client } = fakeClient({ spark: hang });
    const post = client.postJson.bind(client) as (p: string, b: unknown, s?: AbortSignal) => Promise<unknown>;
    (client as unknown as { postJson: typeof post }).postJson = (path, b, s) => {
      if (path === '/responses') signal = s;
      return post(path, b, s);
    };
    // an infinite hang: the test completing at all proves the grace period cuts it off
    const manifest = await generateSpritePack({
      client, photo: await photo(), petName: 'P', species: 'dog', outDir: out,
      onProgress: (e) => events.push(e), timing: { backoffMs: 1, sparkGraceMs: 100, profileMs: 50 },
    });
    expect(manifest.personality).toBeUndefined();
    expect(signal?.aborted).toBe(true);
    expect(events.at(-1)?.stage).toBe('done');
  });

  it('a failed pack aborts Spark, never starts breedFacts, emits nothing after', async () => {
    const events: PipelineEvent[] = [];
    const bodies: Record<string, unknown>[] = [];
    let signal: AbortSignal | undefined;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { client } = fakeClient({
      fail: (pose) => pose === 'idle_0',
      spark: async (b) => {
        if (sparkName(b) === 'motion_profile') return sparkReply(b); // unparseable as a profile: the default is used at once
        bodies.push(b);
        await gate;
        return sparkReply(b);
      },
    });
    const post = client.postJson.bind(client) as (p: string, b: unknown, s?: AbortSignal) => Promise<unknown>;
    (client as unknown as { postJson: typeof post }).postJson = (path, b, s) => {
      if (path === '/responses') signal ??= s;
      return post(path, b, s);
    };
    await expect(
      generateSpritePack({ client, photo: await photo(), petName: 'P', species: 'dog', outDir: out, onProgress: (e) => events.push(e), timing: { backoffMs: 1 } }),
    ).rejects.toThrow();
    expect(signal?.aborted).toBe(true);
    release();
    await new Promise((r) => setTimeout(r, 50));
    expect(bodies).toHaveLength(1); // meetPet only
    expect(events.map((e) => e.stage)).toEqual(['cutout', 'profile']);
  });
});

describe('profile-driven prompts', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pixy-test-'));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  const profileReply = (p: unknown) => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(p) }] }] });
  const pack = async (species: string, o: FakeOpts, timing: Record<string, number> = {}) => {
    const events: PipelineEvent[] = [];
    const f = fakeClient(o);
    const manifest = await generateSpritePack({
      client: f.client, photo: await photo(), petName: 'P', species, outDir: join(root, 'pack'),
      onProgress: (e) => events.push(e), timing: { backoffMs: 1, sparkGraceMs: 50, ...timing },
    });
    return { ...f, events, manifest };
  };
  const spark = (profile: unknown) => async (b: Record<string, unknown>) => (sparkName(b) === 'motion_profile' ? profileReply(profile) : sparkReply(b));

  it('the dog default reproduces the original dog prompts', () => {
    const d = posesFor(defaultProfile('dog'));
    expect(styleFor(defaultProfile('dog'))).toBe(
      'Render the exact same pet from the reference photo as a cute 3D animated-movie character, ' +
        'Pixar-style: soft volumetric fur, gentle studio lighting with soft highlights, subtle ambient occlusion, ' +
        'slightly stylised proportions (big expressive glossy eyes, rounded body), same breed, same fur colour and markings. ' +
        'Full body visible, centred, nothing cropped. Thin clean white outline around the silhouette. ' +
        'Solid flat pure magenta background (#FF00FF) filling the whole canvas, no gradient, ' +
        'no ground shadow, no reflections, no props, no text. ' +
        'Keep the same soft ears (same shape and how they hang), same face shape and same collar as the reference; ' +
        'do not change the breed or ear shape. ' +
        'Leave a clear margin of empty background on all four sides so nothing touches the canvas edge.',
    );
    expect(d.walk_sheet).toBe(defaultProfile('dog').cycle.prompt);
    expect(d.walk_pair).toContain('left front leg reaching far forward');
    expect(d.sit).toBe('Pose: sitting upright facing the viewer, front paws together.');
  });

  it('asks a butterfly for wing frames, with no fur and no legs walking', async () => {
    const bf = { ...defaultProfile('butterfly'), cycle: { kind: 'flap' as const, prompt: 'slow, lazy wingbeats' } };
    const poses = posesFor(bf);
    const { prompts, manifest } = await pack('butterfly', { spark: spark(bf), poses, image: async (n) => (n === 'walk_sheet' ? sheetImg() : drawn(100, 100, 50, 50)) });
    const sheet = prompts.find((p) => p.includes('exactly 4 frames'))!;
    expect(sheet).toMatch(/wings raised high/);
    expect(sheet).toContain('slow, lazy wingbeats');
    expect(sheet).not.toMatch(/walking|legs reaching|front leg/);
    expect(prompts.every((p) => !/fur|ears|four legs/.test(p) || p === poses.idle_blink)).toBe(true);
    expect(manifest.profile?.cycle.kind).toBe('flap');
    expect(manifest.poses.walk?.frames).toHaveLength(4);
  });

  it('spells out the 8 walk phases on a 2 x 4 grid; other cycles keep 4 frames', () => {
    const w = posesFor(defaultProfile('dog')).walk_sheet8!;
    for (const part of ['exactly 8 frames', '2 rows of 4', 'Frame 1 contact', 'Frame 2 down', 'Frame 3 pass', 'Frame 4 up', 'Frames 5 to 8', 'one step behind', 'tail sways']) expect(w).toContain(part);
    expect(posesFor(defaultProfile('butterfly')).walk_sheet).toContain('exactly 4 frames');
  });

  it('does not append a 4-frame motion hint to the 8-frame sheet', () => {
    const d = defaultProfile('dog');
    const w = posesFor({ ...d, cycle: { ...d.cycle, prompt: 'A sprite sheet of exactly 4 frames in 4 equal columns, trotting.' } }).walk_sheet8!;
    expect(w).not.toMatch(/exactly 4 frames|Motion notes|trotting/);
    expect(w).toContain('exactly 8 frames');
  });

  it('asks a snake for body undulation', () => {
    const p = posesFor(defaultProfile('snake'));
    expect(p.walk_sheet).toMatch(/S curve/);
    expect(p.walk_sheet).not.toMatch(/legs/);
    expect(p.walk_pair).toMatch(/S curve/);
    expect(p.idle_0).not.toMatch(/legs/);
  });

  it.each([['hop', /crouched low/], ['spin', /quarter turn/]] as const)('%s has its own scaffold', (kind, re) => {
    expect(posesFor({ ...defaultProfile('dog'), cycle: { kind, prompt: 'x' } }).walk_sheet).toMatch(re);
  });

  it('wraps role prompts in the style and keeps the manifest pose keys', async () => {
    const p = { ...defaultProfile('cat'), roles: { ...defaultProfile('cat').roles, voice: { label: 'Meow', prompt: 'Pose: yowling loudly.' } } };
    const { prompts, manifest } = await pack('cat', { spark: spark(p), poses: posesFor(p) });
    expect(prompts.find((x) => x.includes('yowling'))!.startsWith(styleFor(p))).toBe(true);
    expect(Object.keys(manifest.poses).sort()).toEqual(['bark', 'blink', 'idle', 'roll', 'sit', 'sleep', 'turn', 'walk']);
  });

  it('emits the profile before the first pose and puts it in a valid manifest', async () => {
    const { events, manifest } = await pack('dog', { spark: spark(defaultProfile('dog')) });
    const stages = events.map((e) => e.stage);
    expect(stages.indexOf('profile')).toBeGreaterThan(stages.indexOf('cutout'));
    expect(stages.indexOf('profile')).toBeLessThan(stages.indexOf('pose'));
    const ev = events.find((e) => e.stage === 'profile');
    expect(ev && ev.stage === 'profile' && ev.profile).toEqual(manifest.profile);
    expect(() => validateManifest(JSON.parse(JSON.stringify(manifest)))).not.toThrow();
  });

  it.each([
    ['Spark is down', {}, {}],
    ['a profile that never answers', { spark: () => new Promise(() => undefined) }, { profileMs: 40 }],
    ['an unusable profile', { spark: async () => profileReply({ locomotion: 'nope' }) }, {}],
  ])('falls back to the species default when %s, and still completes', async (_n, o, timing) => {
    const { manifest, events } = await pack('rabbit', o as FakeOpts, timing);
    expect(manifest.profile).toEqual(defaultProfile('rabbit'));
    expect(events.at(-1)?.stage).toBe('done');
  });

  it('makes SAM 1, Spark 3 (profile, personality, facts) and Image 8 requests (7 + the turnaround)', async () => {
    const paths: string[] = [];
    const f = fakeClient({ spark: spark(defaultProfile('dog')) });
    const post = f.client.postJson.bind(f.client) as (p: string, b: unknown, s?: AbortSignal) => Promise<unknown>;
    (f.client as unknown as { postJson: typeof post }).postJson = (path, b, s) => (paths.push(path), post(path, b, s));
    let streams = 0;
    const stream = f.client.postStream.bind(f.client);
    (f.client as unknown as { postStream: typeof stream }).postStream = ((...a: Parameters<typeof stream>) => (streams++, stream(...a))) as typeof stream;
    await generateSpritePack({ client: f.client, photo: await photo(), petName: 'P', species: 'dog', outDir: join(root, 'pack'), timing: { backoffMs: 1, sparkGraceMs: 200 } });
    expect(streams).toBe(1);
    expect(paths.filter((x) => x === '/responses')).toHaveLength(3);
    expect(paths.filter((x) => x !== '/responses')).toHaveLength(8);
  });
});

describe('turnaround sheet', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pixy-test-'));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  /** Records every image request as {pose, refs}. */
  const go = async (o: FakeOpts = {}) => {
    const f = fakeClient(o);
    const calls: { pose: string; refs: string[]; prompt: string }[] = [];
    const post = f.client.postJson.bind(f.client) as (p: string, b: { prompt: string; images: { image_url: string }[] }, s?: AbortSignal) => Promise<unknown>;
    (f.client as unknown as { postJson: typeof post }).postJson = (path, b, s) => {
      if (path !== '/responses') {
        const pose = Object.keys(POSES).find((k) => b.prompt.includes(POSES[k] as string)) as string;
        calls.push({ pose, refs: b.images.map((i) => i.image_url), prompt: b.prompt });
      }
      return post(path, b, s);
    };
    const events: PipelineEvent[] = [];
    const manifest = await generateSpritePack({
      client: f.client, photo: await photo(), petName: 'P', species: 'dog', outDir: join(root, 'pack'),
      onProgress: (e) => events.push(e), timing: { backoffMs: 1 },
    });
    return { calls, manifest, events };
  };

  it('is requested once, right after idle, with cutout + idle as references', async () => {
    const { calls } = await go();
    expect(calls.map((c) => c.pose).slice(0, 2)).toEqual(['idle_0', 'turn_sheet']);
    expect(calls.filter((c) => c.pose === 'turn_sheet')).toHaveLength(1);
    expect(calls[1]?.refs).toHaveLength(2);
    expect(calls[1]?.prompt).toMatch(/exactly 5 views/);
  });

  it('gives five turn frames in the manifest, on one canvas height', async () => {
    const { manifest, events } = await go();
    expect(manifest.poses.turn?.frames).toEqual(['turn_front.png', 'turn_front34.png', 'turn_side.png', 'turn_back34.png', 'turn_back.png']);
    expect(manifest.poses.turn?.footY).toBe(manifest.poses.idle?.footY);
    expect(events.filter((e) => e.stage === 'pose' && e.name.startsWith('turn_'))).toHaveLength(5);
  });

  it('passes the turnaround sheet as an extra reference to every later pose', async () => {
    const { calls } = await go();
    const later = calls.slice(2);
    expect(later.map((c) => c.pose).sort()).toEqual(['bark', 'idle_blink', 'roll', 'sit', 'sleep', 'walk_sheet8']);
    for (const c of later) expect(c.refs.length).toBe(c.pose === 'idle_blink' ? 2 : 3);
    expect(new Set(later.map((c) => c.refs.at(-1))).size).toBe(1);
  });

  it('skips turn after one retry and still completes when the sheet is bad', async () => {
    const { calls, manifest, events } = await go({ image: async (n) => (n === 'turn_sheet' ? drawn(100, 100, 50, 50) : defaultImage(n)) });
    expect(calls.filter((c) => c.pose === 'turn_sheet')).toHaveLength(2);
    expect(manifest.poses.turn).toBeUndefined();
    expect(calls.filter((c) => c.pose === 'sit')[0]?.refs).toHaveLength(2);
    expect(events.filter((e) => e.stage === 'pose-failed' && e.name === 'turn')).toHaveLength(1);
    expect(events.at(-1)?.stage).toBe('done');
  });
});
