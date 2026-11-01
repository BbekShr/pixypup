import { describe, expect, it } from 'vitest';
import { largest, maskAt, matchesFromEvents, samRequestBody, type SamMatch } from '../sam.js';
import { assertStandardTier, parseSse, type StreamEvent } from '../meta-client.js';

// Real SAM 3.1 output shape, taken from @meta-sam/parser's README (a 320x334 frame, 2 objects).
const OUTPUT =
  '<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334|>' +
  "<|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>" +
  ',1<|box;x1=155;y1=228;x2=202;y2=254;w=320;h=334|>' +
  '<|mask;x=0;y=0;data=27,48,~!!!!J!0c[q=Pj_zs=*4C4(/./x#:/`S_GnD`=o3?X{emCgO$y@|>\n';

async function* events(text: string): AsyncGenerator<StreamEvent> {
  const lane = { item_id: 'm1', output_index: 0, content_index: 0 };
  const cut = Math.floor(text.length / 2); // split mid-payload on purpose
  yield { type: 'response.output_text.delta', delta: text.slice(0, cut), ...lane };
  yield { type: 'response.output_text.delta', delta: text.slice(cut), ...lane };
  yield { type: 'response.output_text.done', text, ...lane };
  yield { type: 'response.completed' };
}

describe('sam', () => {
  it('decodes boxes and mask rasters from a streamed response', async () => {
    const matches = await matchesFromEvents(events(OUTPUT));
    expect(matches).toHaveLength(2);
    const [a, b] = matches as [SamMatch, SamMatch];
    expect(a.box).toEqual({ left: 211, top: 228, right: 271, bottom: 255 });
    expect(a.mask).toHaveLength(a.maskWidth * a.maskHeight);
    expect(a.maskWidth * a.maskHeight).toBe(27 * 60);
    expect(b.maskWidth * b.maskHeight).toBe(27 * 48);
    expect(a.mask.some((v) => v === 1)).toBe(true);
    expect(largest(matches)).toBe(a);
  });

  it('returns no matches for an empty completed response', async () => {
    expect(await matchesFromEvents(events(''))).toEqual([]);
  });

  it('samples the mask through box-relative coordinates', async () => {
    const [a] = (await matchesFromEvents(events(OUTPUT))) as [SamMatch];
    const bw = a.box.right - a.box.left;
    const bh = a.box.bottom - a.box.top;
    let on = 0;
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) on += maskAt(a, x, y);
    expect(on).toBeGreaterThan(0);
    expect(on).toBeLessThanOrEqual(bw * bh);
  });

  it('builds the documented request body', () => {
    const body = samRequestBody('dog', 'data:image/png;base64,AAAA');
    expect(body.model).toBe('sam-3.1');
    expect(body.stream).toBe(true);
    expect(body.input[0]?.content).toEqual([
      { type: 'input_text', text: 'dog' },
      { type: 'input_image', image_url: 'data:image/png;base64,AAAA' },
    ]);
  });
});

describe('meta-client', () => {
  it('refuses contributor-tier models', () => {
    expect(() => assertStandardTier('muse-spark-1.3-contributor')).toThrow(/contributor/);
    expect(() => assertStandardTier('muse-spark-1.3')).not.toThrow();
  });

  it('parses SSE split across chunks', async () => {
    const raw = 'event: x\ndata: {"type":"a"}\n\ndata: {"type":"b",\ndata: "n":1}\r\n\r\ndata: [DONE]\n\n';
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode(raw.slice(0, 13)));
        c.enqueue(enc.encode(raw.slice(13)));
        c.close();
      },
    });
    const out: StreamEvent[] = [];
    for await (const e of parseSse(stream)) out.push(e);
    expect(out).toEqual([{ type: 'a' }, { type: 'b', n: 1 }]);
  });
});
