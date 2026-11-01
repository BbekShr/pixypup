import { describe, expect, it } from 'vitest';
import { MetaClient } from '../meta-client.js';
import { JUDGE_MODEL, pickWalk } from '../walk-judge.js';

type Body = { model: string; store: boolean; reasoning: { effort: string }; input: { content: { type: string; image_url?: string }[] }[]; text: { format: { name: string; strict: boolean } } };
const reply = (best: unknown) => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ sheets: [], best, reason: 'steadiest' }) }] }] });
function fake(res: unknown, calls: Body[] = [], status = 200) {
  const fetchImpl = (async (_u: string, init?: RequestInit) => {
    calls.push(JSON.parse(init?.body as string));
    return new Response(JSON.stringify(res), { status });
  }) as unknown as typeof fetch;
  return new MetaClient({ apiKey: 'k', fetchImpl });
}
const sheets = ['data:image/png;base64,A', 'data:image/png;base64,B', 'data:image/png;base64,C'];

describe('pickWalk', () => {
  it('asks the judge model once, unstored and strict, with the reference first and every sheet in order', async () => {
    const calls: Body[] = [];
    expect(await pickWalk(fake(reply(2), calls), 'data:image/png;base64,R', sheets)).toBe(2);
    expect(calls).toHaveLength(1);
    const b = calls[0]!;
    expect(b.model).toBe(JUDGE_MODEL);
    expect(b.store).toBe(false);
    expect(b.reasoning.effort).toBe('low');
    expect(b.text.format).toMatchObject({ name: 'walk_review', strict: true });
    expect(b.input[0]!.content.filter((c) => c.type === 'input_image').map((c) => c.image_url)).toEqual(['data:image/png;base64,R', ...sheets]);
  });
  it.each([[3], [-1], [1.5], ['1'], [null]])('is null for a pick out of range or not an index (%j)', async (best) => {
    expect(await pickWalk(fake(reply(best)), 'r', sheets)).toBeNull();
  });
  it('is null when the call fails or the answer does not parse', async () => {
    expect(await pickWalk(fake({ error: 'x' }, [], 500), 'r', sheets)).toBeNull();
    expect(await pickWalk(fake({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'no json' }] }] }), 'r', sheets)).toBeNull();
    expect(await pickWalk(fake({ status: 'incomplete' }), 'r', sheets)).toBeNull();
  });
});
