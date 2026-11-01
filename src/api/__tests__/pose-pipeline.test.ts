import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MetaApiError, type MetaClient, type StreamEvent } from '../meta-client.js';
import {
  chromaKey,
  generateSpritePack,
  layoutFrames,
  NoPetFoundError,
  POSES,
  validateManifest,
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

const photo = () => sharp({ create: { width: 320, height: 334, channels: 3, background: '#888' } }).png().toBuffer();

interface FakeOpts {
  delayMs?: number;
  fail?: (pose: string) => Error | boolean;
  sam?: string;
  image?: (pose: string) => Promise<Buffer>;
  /** honour the abort signal and never resolve for this pose on these attempts */
  hang?: (pose: string, attempt: number) => boolean;
  signals?: AbortSignal[];
}

function fakeClient(o: FakeOpts = {}) {
  const requested: string[] = [];
  const seen: Record<string, number> = {};
  const client = {
    postStream: () => samEvents(o.sam ?? SAM_OUTPUT),
    postJson: async (_path: string, body: { prompt: string }, signal?: AbortSignal) => {
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
      const png = o.image ? await o.image(pose) : await drawn(100, 100, 50, 50);
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

describe('layoutFrames', () => {
  const frame = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 4, background: '#0a0' } }).png().toBuffer();

  it('scales idle to 256 px and shares one canvas and footY', async () => {
    const out = await layoutFrames(
      {
        idle_0: { png: await frame(100, 50), rawHeight: 200 },
        sit: { png: await frame(40, 80), rawHeight: 200 },
      },
      'idle_0',
    );
    for (const f of Object.values(out.frames)) {
      const m = await sharp(f).metadata();
      expect([m.width, m.height]).toEqual([out.width, out.height]);
    }
    expect(out.height).toBe(Math.round(80 * (256 / 50)) + 2);
    expect(out.footY).toBeCloseTo((out.height - 2) / out.height);
    expect(await drawnHeight(out.frames.idle_0)).toBe(256);
  });

  it('rescales a pose drawn on a bigger canvas to idle size, and keeps natural size on equal canvases', async () => {
    const out = await layoutFrames(
      {
        idle_0: { png: await frame(100, 50), rawHeight: 200 },
        walk_0: { png: await frame(200, 100), rawHeight: 400 },
        sit: { png: await frame(100, 50), rawHeight: 200 },
      },
      'idle_0',
    );
    const h = (n: string) => drawnHeight(out.frames[n] as Buffer);
    expect(await h('walk_0')).toBe(await h('idle_0'));
    expect(await h('sit')).toBe(await h('idle_0'));
  });

  it('keeps a pose drawn twice as large on the same canvas twice as tall', async () => {
    const out = await layoutFrames(
      {
        idle_0: { png: await frame(100, 50), rawHeight: 200 },
        roll: { png: await frame(200, 100), rawHeight: 200 },
      },
      'idle_0',
    );
    expect(out.height).toBe(512 + 2);
  });
});

describe('layoutFrames raw canvas differs', () => {
  it('rescales by the raw height ratio, not width', async () => {
    const frame = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 4, background: '#0a0' } }).png().toBuffer();
    const out = await layoutFrames(
      { idle_0: { png: await frame(100, 100), rawHeight: 1536 }, sit: { png: await frame(100, 100), rawHeight: 1024 } },
      'idle_0',
    );
    // same-size drawing on a 1.5x shorter canvas fills more of it, so it is 1.5x the idle height
    expect(out.height).toBe(Math.round(256 * 1.5) + 2);
  });
});

describe('layoutFrames wide pose', () => {
  it('keeps a pose wider than idle whole', async () => {
    const frame = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 4, background: '#0a0' } }).png().toBuffer();
    const out = await layoutFrames(
      { idle_0: { png: await frame(100, 50), rawHeight: 200 }, walk_0: { png: await frame(200, 50), rawHeight: 200 } },
      'idle_0',
    );
    expect(out.width).toBe(Math.round(200 * (256 / 50)));
    const { data } = await sharp(out.frames.walk_0).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let opaque = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] === 255) opaque++;
    expect(opaque).toBe(Math.round(200 * (256 / 50)) * 256);
  });
});

describe('validateManifest', () => {
  const ok = { pet: 'P', species: 'dog', poses: { idle: { frames: ['a.png'], fps: 2, footY: 0.9 } } };
  it('accepts a good manifest', () => expect(() => validateManifest(ok)).not.toThrow());
  it.each([
    { ...ok, species: 'cow' },
    { ...ok, extra: 1 },
    { ...ok, poses: { idle: { frames: ['a.png'], fps: '2', footY: 0.9 } } },
    { ...ok, poses: { idle: { frames: [1], fps: 2, footY: 0.9 } } },
    { ...ok, poses: { idle: { frames: [], fps: 2 } } },
    { ...ok, poses: { idle: { frames: [], fps: 2, footY: 0.9 } } },
    null,
  ])('rejects %j', (bad) => expect(() => validateManifest(bad)).toThrow(/Invalid sprite manifest/));
});

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

  it('emits cutout, 7 poses, done, and writes the pack', async () => {
    const events: PipelineEvent[] = [];
    const { p } = await run({}, events);
    const manifest = await p;
    expect(events.map((e) => e.stage)).toEqual(['cutout', ...Array(7).fill('pose'), 'done']);
    expect((await readdir(out)).sort()).toEqual([
      'bark.png',
      'idle_0.png',
      'roll.png',
      'sit.png',
      'sleep.png',
      'sprite-manifest.json',
      'walk_0.png',
      'walk_1.png',
    ]);
    expect(JSON.parse(await readFile(join(out, 'sprite-manifest.json'), 'utf8'))).toEqual(manifest);
    expect(manifest.poses.walk?.frames).toEqual(['walk_0.png', 'walk_1.png']);
    expect(await readdir(root)).toEqual(['pack']);
  });

  it('draws idle first, then the rest in parallel', async () => {
    const t = Date.now();
    const { p, requested } = await run({ delayMs: 50 });
    await p;
    expect(requested[0]).toBe('idle_0');
    expect(Date.now() - t).toBeLessThan(300);
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
    expect(Object.keys(manifest.poses)).toHaveLength(6);
    expect(await readdir(out)).toContain('sprite-manifest.json');
  });

  it.each([
    ['all magenta', () => sharp({ create: { width: 100, height: 100, channels: 3, background: '#ff00ff' } }).png().toBuffer()],
    ['all subject', () => sharp({ create: { width: 100, height: 100, channels: 3, background: '#00aa00' } }).png().toBuffer()],
    ['touches the canvas edge', () => drawn(100, 100, 100, 50)],
  ])('treats a degenerate pose (%s) as a failure and retries', async (_n, make) => {
    const events: PipelineEvent[] = [];
    const { p, requested } = await run({ image: async (n) => (n === 'sit' ? make() : drawn(100, 100, 50, 50)) }, events);
    await p;
    expect(requested.filter((n) => n === 'sit')).toHaveLength(2);
    expect(events.find((e) => e.stage === 'pose-failed')).toMatchObject({ name: 'sit', error: 'bad-output' });
  });

  it('emits a body-free pose-failed and a fallback pose event so 7 pose events always arrive', async () => {
    const events: PipelineEvent[] = [];
    const { p } = await run({ fail: (n) => (n === 'bark' ? new MetaApiError(500, 'SECRET-BODY', '/images/edits') : false) }, events);
    await p;
    const failed = events.find((e) => e.stage === 'pose-failed');
    expect(failed).toMatchObject({ name: 'bark', error: 'generation-failed (HTTP 500)' });
    expect(JSON.stringify(events.filter((e) => e.stage !== 'pose' && e.stage !== 'cutout'))).not.toContain('SECRET-BODY');
    const poses = events.filter((e) => e.stage === 'pose');
    expect(poses).toHaveLength(7);
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
