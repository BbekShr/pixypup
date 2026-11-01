import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
const sheetImg = (widths = [50, 50, 50, 50]) => {
  let left = 10;
  const blobs = widths.map((w) => {
    const b = { input: { create: { width: w, height: 50, channels: 3 as const, background: '#00aa00' } }, left, top: 10 };
    left += w + 50;
    return b;
  });
  return sharp({ create: { width: left, height: 100, channels: 3, background: '#ff00ff' } }).composite(blobs).png().toBuffer();
};
const defaultImage = (pose: string) => (pose === 'walk_sheet' ? sheetImg() : drawn(100, 100, 50, 50));

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
}

function fakeClient(o: FakeOpts = {}) {
  const requested: string[] = [];
  const seen: Record<string, number> = {};
  const client = {
    postStream: () => samEvents(o.sam ?? SAM_OUTPUT),
    postJson: async (path: string, body: { prompt: string }, signal?: AbortSignal) => {
      if (path === '/responses') {
        o.sparkLog?.push(`spark:${requested.length}`);
        if (!o.spark) throw new Error('spark down');
        return o.spark(body as unknown as Record<string, unknown>);
      }
      const pose = Object.keys(POSES).find((k) => body.prompt.includes(POSES[k] as string)) as string;
      requested.push(pose);
      const attempt = (seen[pose] = (seen[pose] ?? 0) + 1);
      if (pose === 'sit' && signal) o.signals?.push(signal);
      if (o.hang?.(pose, attempt)) {
        await new Promise((_, rej) => signal?.addEventListener('abort', () => rej(new Error('aborted'))));
      }
      await new Promise((r) => setTimeout(r, o.delayMs ?? 0));
      const f = o.fail?.(pose);
      if (f) throw f instanceof Error ? f : new Error(`boom ${pose}`);
      const png = o.image ? await o.image(pose) : await defaultImage(pose);
      const webp = await sharp(png).webp({ lossless: true }).toBuffer();
      return { data: [{ b64_json: webp.toString('base64') }] };
    },
  } as unknown as MetaClient;
  return { client, requested };
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
    for (const [x0, w] of blobs) for (let y = 2; y < 18; y++) for (let x = x0; x < x0 + w; x++) buf[(y * W + x) * 4 + 3] = 255;
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
    const { client, requested } = fakeClient(o);
    const p = generateSpritePack({
      client,
      photo: await photo(),
      petName: 'Pakkun',
      species: 'dog',
      outDir: out,
      onProgress: (e) => events.push(e),
      timing: { timeoutMs: o.hang ? 50 : 60_000, backoffMs: 1 },
    });
    return { p, requested };
  };

  it('emits cutout, 10 poses, done, and writes the pack', async () => {
    const events: PipelineEvent[] = [];
    const { p } = await run({}, events);
    const manifest = await p;
    expect(events.map((e) => e.stage)).toEqual(['cutout', ...Array(10).fill('pose'), 'done']);
    expect((await readdir(out)).sort()).toEqual([
      'bark.png',
      'idle_0.png',
      'idle_blink.png',
      'roll.png',
      'sit.png',
      'sleep.png',
      'sprite-manifest.json',
      'walk_0.png',
      'walk_1.png',
      'walk_2.png',
      'walk_3.png',
    ]);
    expect(JSON.parse(await readFile(join(out, 'sprite-manifest.json'), 'utf8'))).toEqual(manifest);
    expect(manifest.poses.walk?.fps).toBe(8);
    expect(manifest.poses.blink?.frames).toEqual(['idle_blink.png']);
    expect(manifest.poses.blink?.footY).toBe(manifest.poses.idle?.footY);
    expect(manifest.poses.walk?.frames).toEqual(['walk_0.png', 'walk_1.png', 'walk_2.png', 'walk_3.png']);
    expect(await readdir(root)).toEqual(['pack']);
  });

  it('draws idle first, then the sheet, sit, sleep, bark, roll and blink in parallel (7 requests)', async () => {
    const t = Date.now();
    const { p, requested } = await run({ delayMs: 50 });
    await p;
    expect(requested[0]).toBe('idle_0');
    expect(requested.slice(1).sort()).toEqual(['bark', 'idle_blink', 'roll', 'sit', 'sleep', 'walk_sheet']);
    expect(Date.now() - t).toBeLessThan(300);
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
    expect(refCount).toEqual({ idle_0: 1, walk_sheet: 2, sit: 2, sleep: 2, bark: 2, roll: 2, idle_blink: 1 });
  });

  it.each([
    ['3 blobs', () => sheetImg().then((b) => sharp(b).composite([{ input: { create: { width: 60, height: 100, channels: 3, background: '#ff00ff' } }, left: 310, top: 0 }]).png().toBuffer())],
    ['unequal widths', () => sheetImg([50, 50, 50, 20])],
    ['one blob', () => drawn(100, 100, 50, 50)],
  ])('falls back to 4 idle frames when the walk sheet is bad (%s), after one retry', async (_n, make) => {
    const events: PipelineEvent[] = [];
    const { p, requested } = await run({ image: async (n) => (n === 'walk_sheet' ? make() : defaultImage(n)) }, events);
    await p;
    expect(requested.filter((n) => n === 'walk_sheet')).toHaveLength(2);
    expect(events.filter((e) => e.stage === 'pose-failed').map((e) => e.stage === 'pose-failed' && e.name)).toEqual(['walk_0', 'walk_1', 'walk_2', 'walk_3']);
    for (let i = 0; i < 4; i++) expect(await readFile(join(out, `walk_${i}.png`))).toEqual(await readFile(join(out, 'idle_0.png')));
  });

  it('slices a good sheet into 4 walk frames at idle height', async () => {
    const { p } = await run({});
    await p;
    for (let i = 0; i < 4; i++) expect(await drawnHeight(await readFile(join(out, `walk_${i}.png`)))).toBe(256);
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
    expect(Object.keys(manifest.poses)).toHaveLength(7);
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

  it('emits a body-free pose-failed and a fallback pose event so 10 pose events always arrive', async () => {
    const events: PipelineEvent[] = [];
    const { p } = await run({ fail: (n) => (n === 'bark' ? new MetaApiError(500, 'SECRET-BODY', '/images/edits') : false) }, events);
    await p;
    const failed = events.find((e) => e.stage === 'pose-failed');
    expect(failed).toMatchObject({ name: 'bark', error: 'generation-failed (HTTP 500)' });
    expect(JSON.stringify(events.filter((e) => e.stage !== 'pose' && e.stage !== 'cutout'))).not.toContain('SECRET-BODY');
    const poses = events.filter((e) => e.stage === 'pose');
    expect(poses).toHaveLength(10);
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
    // poses take 2 sequential rounds of 60 ms; Spark takes 2 x 40 ms in parallel.
    const slow = async (b: Record<string, unknown>) => {
      await new Promise((r) => setTimeout(r, 40));
      return sparkReply(b);
    };
    const t0 = Date.now();
    await (await run({ delayMs: 60 })).p;
    const base = Date.now() - t0;
    const t1 = Date.now();
    await (await run({ delayMs: 60, spark: slow })).p;
    expect(Date.now() - t1).toBeLessThan(base + 40);
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
    const t = Date.now();
    const manifest = await generateSpritePack({
      client, photo: await photo(), petName: 'P', species: 'dog', outDir: out,
      onProgress: (e) => events.push(e), timing: { backoffMs: 1, sparkGraceMs: 100 },
    });
    expect(Date.now() - t).toBeLessThan(1500);
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
    expect(events.map((e) => e.stage)).toEqual(['cutout']);
  });
});
