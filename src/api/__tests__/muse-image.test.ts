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
});
