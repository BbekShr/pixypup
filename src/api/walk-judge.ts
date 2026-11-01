import type { MetaClient } from './meta-client.js';
import { extractJson, parseResponseText, sparkRequestBody, type SparkResponse } from './muse-spark.js';

/** Meta's strongest model reviews the drawn walk sheets; Muse Image draws a believable cycle often, but not every time. */
export const JUDGE_MODEL = 'muse-wonder-1.0';

const SCORE = { type: 'integer', minimum: 0, maximum: 10 };
export const WALK_REVIEW = {
  type: 'object',
  additionalProperties: false,
  required: ['sheets', 'best', 'reason'],
  properties: {
    sheets: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'same_pet', 'consistent', 'cycle', 'legs', 'notes'],
        properties: { index: { type: 'integer' }, same_pet: SCORE, consistent: SCORE, cycle: SCORE, legs: SCORE, notes: { type: 'string' } },
      },
    },
    best: { type: 'integer' },
    reason: { type: 'string' },
  },
};

export const WALK_JUDGE =
  'You are a senior character animator choosing a walk cycle for a desktop pet. Image 1 is the reference pet. Images 2 onward are candidate walk ' +
  'cycles (candidate index 0 is image 2), each 8 frames in reading order (top row left to right, then bottom row), played in a loop while the pet ' +
  'moves right; a flat magenta background is only a chroma key. Score each 0-10: same_pet (same character, colours, face and markings as the ' +
  'reference in every frame), consistent (identical size, body, head and tail drawing across frames so nothing pops when frames swap; only the ' +
  'legs and a small bob should change), cycle (the 8 frames form one smooth walk: contact, down, passing, up, then the other side, with each frame ' +
  'a distinct phase that follows from the previous one and frame 8 leading back into frame 1), legs (four legs, each visible and anatomically ' +
  'plausible, no fused, missing or extra legs). Pick the best for looking like a real, cute walk on screen; consistent and cycle matter most.';

/**
 * Index of the sheet the judge picks, or null when it can't (failure, timeout, an answer that doesn't parse or is out of
 * range): the caller then treats the walk as unjudged. Images are data URLs; nothing here is logged.
 */
export async function pickWalk(client: MetaClient, reference: string, sheets: string[], signal?: AbortSignal): Promise<number | null> {
  try {
    const input = [{ type: 'message', role: 'user', content: [
      { type: 'input_text', text: `${sheets.length} candidate walk cycles follow the reference.` },
      { type: 'input_image', image_url: reference },
      ...sheets.map((s) => ({ type: 'input_image', image_url: s })),
    ] }];
    const body = { ...sparkRequestBody({ instructions: WALK_JUDGE, input, schema: WALK_REVIEW, name: 'walk_review', effort: 'low' }), model: JUDGE_MODEL };
    const res = await client.postJson<SparkResponse>('/responses', body, signal);
    const best = (extractJson(parseResponseText(res)) as { best?: unknown }).best;
    return Number.isInteger(best) && (best as number) >= 0 && (best as number) < sheets.length ? (best as number) : null;
  } catch {
    return null;
  }
}
