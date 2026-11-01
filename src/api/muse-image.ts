// Muse Image 1.0 edits: POST /v1/images/edits. In practice it returns WebP, so the mime is
// sniffed from the bytes rather than assumed.

import type { MetaClient } from './meta-client.js';

export const IMAGE_MODEL = 'muse-image-1.0';

export interface EditedImage {
  buffer: Buffer;
  mime: 'image/webp' | 'image/png' | 'image/jpeg';
}

interface ImagesResponse {
  data?: { b64_json?: string; url?: string }[];
}

function sniff(buf: Buffer): EditedImage['mime'] {
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  if (buf.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  throw new Error('Muse Image returned bytes that are not WebP, PNG or JPEG.');
}

/** `images` are data URLs. Hosted result URLs are fetched without the API key. */
export async function editImage(
  client: MetaClient,
  prompt: string,
  images: string[],
  n = 1,
  opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<EditedImage[]> {
  const res = await client.postJson<ImagesResponse>('/images/edits', {
    model: IMAGE_MODEL,
    prompt,
    images: images.map((image_url) => ({ image_url })),
    n,
  });
  if (!res.data?.length) throw new Error('Muse Image returned no images.');
  const get = opts.fetchImpl ?? fetch;
  return Promise.all(
    res.data.map(async (item) => {
      let buffer: Buffer;
      if (item.b64_json) buffer = Buffer.from(item.b64_json, 'base64');
      else if (item.url) {
        const r = await get(item.url, { signal: opts.signal });
        if (!r.ok) throw new Error(`Muse Image download failed with ${r.status}.`);
        buffer = Buffer.from(await r.arrayBuffer());
      } else throw new Error('Muse Image item has neither b64_json nor url.');
      return { buffer, mime: sniff(buffer) };
    }),
  );
}
