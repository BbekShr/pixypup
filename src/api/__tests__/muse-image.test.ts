import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { editImage } from '../muse-image.js';
import { MetaClient } from '../meta-client.js';

const img = (format: 'webp' | 'png') =>
  sharp({ create: { width: 4, height: 4, channels: 3, background: '#f0f' } })[format]().toBuffer();

function client(body: unknown, calls: { url: string; init?: RequestInit }[] = []) {
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  return new MetaClient({ apiKey: 'k', fetchImpl });
}

describe('editImage', () => {
  it('posts the documented body and decodes b64_json WebP', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const webp = await img('webp');
    const c = client({ data: [{ b64_json: webp.toString('base64') }] }, calls);
    const out = await editImage(c, 'draw', ['data:image/png;base64,AA'], 1);
    expect(out[0]?.mime).toBe('image/webp');
    expect(calls[0]?.url).toMatch(/\/images\/edits$/);
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({
      model: 'muse-image-1.0',
      prompt: 'draw',
      images: [{ image_url: 'data:image/png;base64,AA' }],
      n: 1,
    });
  });

  it('downloads url results without the Authorization header', async () => {
    const png = await img('png');
    const seen: { url: unknown; init?: RequestInit }[] = [];
    const get = (async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      return new Response(png);
    }) as unknown as typeof fetch;
    const out = await editImage(client({ data: [{ url: 'https://cdn/x.png' }] }), 'p', [], 1, { fetchImpl: get });
    expect(out[0]?.mime).toBe('image/png');
    expect(seen[0]?.url).toBe('https://cdn/x.png');
    expect(JSON.stringify(seen[0]?.init ?? {})).not.toMatch(/authorization/i);
  });

  it('throws on empty data without echoing the body', async () => {
    const err = await editImage(client({ data: [], secret: 'LEAKME' }), 'p', []).catch((e: Error) => e);
    expect((err as Error).message).not.toContain('LEAKME');
    expect(err).toBeInstanceOf(Error);
  });

  it('only follows https urls, with redirects off and a timeout signal', async () => {
    const png = await img('png');
    const seen: RequestInit[] = [];
    const get = (async (_u: string, init?: RequestInit) => {
      seen.push(init ?? {});
      return new Response(png);
    }) as unknown as typeof fetch;
    await editImage(client({ data: [{ url: 'https://cdn/x.png' }] }), 'p', [], 1, { fetchImpl: get });
    expect(seen[0]?.redirect).toBe('error');
    expect(seen[0]?.signal).toBeInstanceOf(AbortSignal);
    const never = (async () => new Response(png)) as unknown as typeof fetch;
    await expect(editImage(client({ data: [{ url: 'http://cdn/x.png' }] }), 'p', [], 1, { fetchImpl: never })).rejects.toThrow(/https/);
  });

  it('rejects oversize downloads by content-length and by actual bytes', async () => {
    const big = (headers: Record<string, string>) =>
      (async () => new Response(Buffer.alloc(21 * 1024 * 1024), { headers })) as unknown as typeof fetch;
    const c = () => client({ data: [{ url: 'https://cdn/x.png' }] });
    await expect(editImage(c(), 'p', [], 1, { fetchImpl: big({ 'content-length': String(21 * 1024 * 1024) }) })).rejects.toThrow(/too large/);
    await expect(editImage(c(), 'p', [], 1, { fetchImpl: big({}) })).rejects.toThrow(/too large/);
  });

  it('passes the abort signal to the API request', async () => {
    let got: AbortSignal | null | undefined;
    const fetchImpl = (async (_u: string, init?: RequestInit) => {
      got = init?.signal;
      return new Response(JSON.stringify({ data: [{ b64_json: (await img('png')).toString('base64') }] }));
    }) as unknown as typeof fetch;
    const ctl = new AbortController();
    await editImage(new MetaClient({ apiKey: 'k', fetchImpl }), 'p', [], 1, { signal: ctl.signal });
    expect(got).toBe(ctl.signal);
  });
});
