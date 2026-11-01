import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MetaClient, StreamEvent } from '../meta-client.js';
import {
  chromaKey,
  generateSpritePack,
  layoutFrames,
  NoPetFoundError,
  POSES,
  validateManifest,
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
  fail?: (pose: string) => boolean;
  sam?: string;
}

function fakeClient(o: FakeOpts = {}) {
  const requested: string[] = [];
  const client = {
    postStream: () => samEvents(o.sam ?? SAM_OUTPUT),
    postJson: async (_path: string, body: { prompt: string }) => {
      const pose = Object.keys(POSES).find((k) => body.prompt.includes(POSES[k] as string)) as string;
      requested.push(pose);
      await new Promise((r) => setTimeout(r, o.delayMs ?? 0));
      if (o.fail?.(pose)) throw new Error(`boom ${pose}`);
      const webp = await sharp(await drawn(100, 100, 50, 50)).webp({ lossless: true }).toBuffer();
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

describe('layoutFrames', () => {
  const frame = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 4, background: '#0a0' } }).png().toBuffer();

  it('scales idle to 256 px and shares one canvas and footY', async () => {
    const out = await layoutFrames(
      {
        idle_0: { png: await frame(100, 50), rawWidth: 200 },
        sit: { png: await frame(40, 80), rawWidth: 200 },
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
        idle_0: { png: await frame(100, 50), rawWidth: 200 },
        walk_0: { png: await frame(200, 100), rawWidth: 400 },
        sit: { png: await frame(100, 50), rawWidth: 200 },
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
        idle_0: { png: await frame(100, 50), rawWidth: 200 },
        roll: { png: await frame(200, 100), rawWidth: 200 },
      },
      'idle_0',
    );
    expect(out.height).toBe(512 + 2);
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
});
