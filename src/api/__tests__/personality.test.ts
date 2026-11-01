import { describe, expect, it } from 'vitest';
import { MetaClient } from '../meta-client.js';
import { extractJson, parseResponseText, sparkRequestBody } from '../muse-spark.js';
import { breedFacts, meetPet, sanitizePersonality } from '../personality.js';
import { validateManifest } from '../manifest.js';

const GOOD = {
  breed: 'Shiba Inu',
  coat: 'red and cream',
  traits: ['curious', 'brave', 'sneaky'],
  energy: 'playful',
  lines: ['Walk time?', 'I smell a snack.', 'Pet me, human.', 'Zoomies incoming!', 'Is it dinner yet?', 'I guard this desk.'],
};
type Body = { model: string; store: boolean; reasoning: unknown; text: { format: object }; tools?: unknown; include?: unknown; input: { content: unknown[] }[] };
const text = (t: string, annotations: { type: string; url?: string }[] = []) => ({
  status: 'completed',
  output: [{ type: 'message', content: [{ type: 'output_text', text: t, annotations }] }],
});

function fake(res: unknown, calls: Body[] = []) {
  const fetchImpl = (async (_u: string, init?: RequestInit) => {
    calls.push(JSON.parse(init?.body as string));
    return new Response(JSON.stringify(res), { status: 200 });
  }) as unknown as typeof fetch;
  return new MetaClient({ apiKey: 'k', fetchImpl });
}

describe('parseResponseText', () => {
  it('joins output_text parts and ignores reasoning parts', () => {
    const res = {
      status: 'completed',
      output: [
        { type: 'reasoning', content: [{ type: 'reasoning_text', text: 'hmm' }] },
        { type: 'message', content: [{ type: 'output_text', text: '{"a":' }, { type: 'output_text', text: '1}' }] },
      ],
    };
    expect(parseResponseText(res)).toBe('{"a":1}');
  });
  it('fails on refusal, incomplete and empty', () => {
    expect(() => parseResponseText({ status: 'completed', output: [{ content: [{ type: 'refusal', refusal: 'no' }] }] })).toThrow();
    expect(() => parseResponseText({ ...text('{}'), status: 'incomplete' })).toThrow();
    expect(() => parseResponseText({ status: 'completed', output: [] })).toThrow();
  });
});

describe('extractJson', () => {
  const narrated =
    "Gathering kid-friendly facts about this breed for you.I've got some friendly traits in mind — now I'll pull the sources to verify them." +
    '{"facts": [{"text": "A } brace and \\"quote\\" inside", "source": "https://a.org"}]}';
  it('takes the JSON after narration, respecting braces inside strings', () => {
    expect(extractJson(narrated)).toEqual({ facts: [{ text: 'A } brace and "quote" inside', source: 'https://a.org' }] });
  });
  it('returns the last object, skips stray braces, throws when none', () => {
    expect(extractJson('{"a":1} then {"b":2}')).toEqual({ b: 2 });
    expect(extractJson('oops { not json {"a":1}')).toEqual({ a: 1 });
    expect(() => extractJson('no json')).toThrow();
  });
});

describe('request shapes', () => {
  it('meetPet sends image data URL, json_schema text.format, low effort, store false, standard model', async () => {
    const calls: Body[] = [];
    const out = await meetPet(fake(text(JSON.stringify(GOOD)), calls), Buffer.from('png'), 'Pakkun', 'dog');
    expect(out).toEqual(GOOD);
    const b = calls[0]!;
    expect(b.model).toBe('muse-spark-1.3');
    expect(b.store).toBe(false);
    expect(b.reasoning).toEqual({ effort: 'low' });
    expect(b.text.format).toMatchObject({ type: 'json_schema', name: 'pet_personality' });
    expect(b.tools).toBeUndefined();
    const content = b.input[0]!.content;
    expect(content[1]).toEqual({ type: 'input_image', image_url: `data:image/png;base64,${Buffer.from('png').toString('base64')}` });
    expect(JSON.stringify(b)).not.toMatch(/contributor/);
  });

  it('breedFacts enables web_search', async () => {
    const calls: Body[] = [];
    await breedFacts(fake(text(JSON.stringify({ facts: [] })), calls), 'Shiba Inu', 'dog');
    expect(calls[0]!.tools).toEqual([{ type: 'web_search' }]);
    expect(calls[0]!.include).toBeUndefined();
    expect(JSON.stringify(calls[0])).not.toMatch(/image/);
  });

  it('uses strict schemas: every object closed, every property required', async () => {
    const calls: Body[] = [];
    await meetPet(fake(text('x'), calls), Buffer.from(''), 'P', 'dog');
    await breedFacts(fake(text('x'), calls), 'Shiba', 'dog');
    const closed = (n: unknown): void => {
      if (typeof n !== 'object' || n === null) return;
      const o = n as { type?: string; properties?: object; required?: string[] };
      if (o.type === 'object') {
        expect(o).toMatchObject({ additionalProperties: false });
        expect([...(o.required ?? [])].sort()).toEqual(Object.keys(o.properties ?? {}).sort());
      }
      Object.values(n).forEach(closed);
    };
    for (const c of calls) {
      expect(c.text.format).toMatchObject({ strict: true });
      closed((c.text.format as { schema: unknown }).schema);
    }
  });

  it('never sends effort none', () => {
    expect(sparkRequestBody({ instructions: '', input: '', schema: {}, name: 'x', effort: 'minimal' }).reasoning.effort).not.toBe('none');
  });
});

describe('sanitizePersonality', () => {
  it('trims and accepts a good personality; the manifest accepts it', () => {
    const p = sanitizePersonality({ ...GOOD, breed: '  Shiba Inu ' });
    expect(p.breed).toBe('Shiba Inu');
    validateManifest({ pet: 'a', species: 'dog', poses: {}, personality: p });
  });
  it('drops long, URL, @ and emoji lines', () => {
    const p = sanitizePersonality({ ...GOOD, lines: [...GOOD.lines.slice(0, 3), 'x'.repeat(41), 'see https://x.io', 'mail @me'] });
    expect(p.lines).toEqual(GOOD.lines.slice(0, 3));
    expect(sanitizePersonality({ ...GOOD, lines: [...GOOD.lines.slice(0, 3), 'woof \u{1F436}'] }).lines).toHaveLength(3);
  });
  it.each([
    ['too few usable lines', { ...GOOD, lines: ['a', 'b'] }],
    ['bad energy', { ...GOOD, energy: 'hyper' }],
    ['two traits', { ...GOOD, traits: ['a', 'b'] }],
    ['long breed', { ...GOOD, breed: 'x'.repeat(61) }],
    ['not an object', 'hi'],
  ])('rejects %s', (_n, v) => expect(() => sanitizePersonality(v)).toThrow());

  it('meetPet returns null on garbage, refusal, http error', async () => {
    expect(await meetPet(fake(text('nope')), Buffer.from(''), 'P', 'dog')).toBeNull();
    expect(await meetPet(fake(text(JSON.stringify({ ...GOOD, energy: 'x' }))), Buffer.from(''), 'P', 'dog')).toBeNull();
    const bad = new MetaClient({ apiKey: 'k', fetchImpl: (async () => new Response('x', { status: 500 })) as unknown as typeof fetch });
    expect(await meetPet(bad, Buffer.from(''), 'P', 'dog')).toBeNull();
  });
});

describe('breedFacts', () => {
  const facts = (...f: { text: string; source: string }[]) => JSON.stringify({ facts: f });
  it('keeps only sources the model cited (annotations), not merely retrieved ones, drops long or URL facts', async () => {
    const res = {
      status: 'completed',
      output: [
        { type: 'web_search_call', status: 'completed', results: [{ url: 'https://a.org/shiba' }, { url: 'https://retrieved-only.org' }] },
        { type: 'message', content: [{ type: 'output_text', annotations: [{ type: 'url_citation', url: 'https://b.org/x' }, { type: 'url_citation', url: 'https://a.org/shiba' }],
          text: facts(
            { text: 'Shibas are very old.', source: 'https://a.org/shiba' },
            { text: 'They scream a lot.', source: 'https://invented.org' },
            { text: 'Retrieved only.', source: 'https://retrieved-only.org' },
            { text: 'y'.repeat(91), source: 'https://b.org/x' },
            { text: 'Go to https://evil.io', source: 'https://b.org/x' },
          ) }] },
      ],
    };
    expect(await breedFacts(fake(res), 'Shiba', 'dog')).toEqual([
      { text: 'Shibas are very old.', source: 'https://a.org/shiba' },
      { text: 'They scream a lot.' },
      { text: 'Retrieved only.' },
    ]);
    expect((await breedFacts(fake(res), 'Shiba', 'dog'))!.length).toBe(3);
  });
  it('reads narrated output and ignores garbled keys and an empty source', async () => {
    const body =
      'Searching now.' +
      JSON.stringify({ facts: [{ text: 'Garbled key.', 'source人生': 'https://a.org' }, { text: 'Empty source.', source: '' }] });
    const res = { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: body, annotations: [{ type: 'url_citation', url: 'https://a.org' }] }] }] };
    expect(await breedFacts(fake(res), 'Shiba', 'dog')).toEqual([{ text: 'Garbled key.' }, { text: 'Empty source.' }]);
  });
  it('null when nothing usable or the call fails', async () => {
    expect(await breedFacts(fake(text(facts())), 'Shiba', 'dog')).toBeNull();
    expect(await breedFacts(fake({ status: 'incomplete' }), 'Shiba', 'dog')).toBeNull();
  });
});

describe('breedFacts without annotations', () => {
  it('keeps the facts but no sources', async () => {
    const body = JSON.stringify({ facts: [{ text: 'Old breed.', source: 'https://a.org' }] });
    const res = { status: 'completed', output: [{ type: 'web_search_call', results: [{ url: 'https://a.org' }] }, { type: 'message', content: [{ type: 'output_text', text: body }] }] };
    expect(await breedFacts(fake(res), 'Shiba', 'dog')).toEqual([{ text: 'Old breed.' }]);
  });
});

describe('validateManifest personality', () => {
  const base = { pet: 'a', species: 'dog', poses: {} };
  it('accepts facts, rejects unknown keys and over-long text', () => {
    validateManifest({ ...base, personality: { ...GOOD, facts: [{ text: 'ok', source: 'https://a.org' }] } });
    expect(() => validateManifest({ ...base, personality: { ...GOOD, extra: 1 } })).toThrow();
    const bad = (personality: object) => expect(() => validateManifest({ ...base, personality })).toThrow();
    bad({ ...GOOD, facts: [{ text: 'ok', source: 'http://a.org' }] });
    bad({ ...GOOD, facts: [{ text: 'ok', source: 'javascript:alert(1)' }] });
    bad({ ...GOOD, facts: [{ text: 'see https://evil.io' }] });
    bad({ ...GOOD, lines: ['mail me @x', 'a', 'b'] });
    bad({ ...GOOD, lines: ['visit www.x.io', 'a', 'b'] });
    bad({ ...GOOD, traits: ['a', 'b', 'c \u{1F436}'] });
    bad({ ...GOOD, breed: 'https://x.io' });
    expect(() => validateManifest({ ...base, personality: { ...GOOD, lines: ['x'.repeat(41), 'a', 'b'] } })).toThrow();
    expect(() => validateManifest({ ...base, personality: { ...GOOD, facts: [{ text: 'x'.repeat(91) }] } })).toThrow();
  });
});
