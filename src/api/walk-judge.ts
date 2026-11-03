import type { MetaClient } from './meta-client.js';
import { MIN_HIND_BALANCE } from './hind-legs.js';
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
        required: ['index', 'same_pet', 'consistent', 'cycle', 'even', 'legs', 'notes'],
        properties: { index: { type: 'integer' }, same_pet: SCORE, consistent: SCORE, cycle: SCORE, even: SCORE, legs: SCORE, notes: { type: 'string' } },
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
  'a distinct phase that follows from the previous one and frame 8 leading back into frame 1), even (the steps are evenly spaced so the pet does not ' +
  'limp or hitch: no two neighbouring frames nearly the same while others jump far, and frames 5 to 8 lead with the other side rather than ' +
  'repeating frames 1 to 4), legs (four legs, each visible and anatomically plausible, no fused, missing or extra legs, and the back legs ' +
  'step as far forward and back as the front legs rather than staying tucked under the body). ' +
  'Pick the best for looking like a real, cute walk on screen; consistent, cycle and even matter most. notes: the main flaw in one short sentence.';

export interface SheetReview { index: number; same_pet: number; consistent: number; cycle: number; even: number; legs: number; notes: string }
export interface WalkReview { best: number; sheets: SheetReview[] }

/** A sheet good enough to ship without asking for more: smooth, even and steady. */
export const walkPasses = (s: SheetReview | undefined): boolean => !s || (s.even >= 7 && s.cycle >= 7 && s.consistent >= 7);

/**
 * The sheet to ship: the judge's pick, unless its measured back-leg balance (hind-legs.ts) is too low and another sheet's
 * is fine; then the best-scored of those. Without a review, the first sheet. `balance[i]` null means "can't tell": fine.
 */
export function pickWalkSheet(review: WalkReview | null, balance: (number | null)[], min = MIN_HIND_BALANCE): number {
  const ok = (i: number) => (balance[i] ?? 1) >= min;
  if (!review) return 0;
  if (ok(review.best)) return review.best;
  const total = (i: number) => { const s = review.sheets.find((x) => x.index === i); return s ? s.same_pet + s.consistent + s.cycle + s.even + s.legs : -1; };
  const fine = balance.map((_, i) => i).filter(ok).sort((a, b) => total(b) - total(a));
  return fine[0] ?? review.best;
}

/** Model output: keep only objects with an integer index, and make notes a short string (it is re-used in a prompt). */
const cleanSheets = (v: unknown): SheetReview[] =>
  Array.isArray(v)
    ? v.filter((x) => x && typeof x === 'object' && Number.isInteger((x as SheetReview).index)).map((x) => ({ ...x, notes: typeof x.notes === 'string' ? x.notes.slice(0, 300) : '' }))
    : [];

/** The judge's whole review (best index in range), or null when it can't be had. Images are data URLs; nothing is logged. */
export async function reviewWalks(client: MetaClient, reference: string, sheets: string[], signal?: AbortSignal): Promise<WalkReview | null> {
  try {
    const input = [{ type: 'message', role: 'user', content: [
      { type: 'input_text', text: `${sheets.length} candidate walk cycles follow the reference.` },
      { type: 'input_image', image_url: reference },
      ...sheets.map((s) => ({ type: 'input_image', image_url: s })),
    ] }];
    const body = { ...sparkRequestBody({ instructions: WALK_JUDGE, input, schema: WALK_REVIEW, name: 'walk_review', effort: 'low' }), model: JUDGE_MODEL };
    const res = await client.postJson<SparkResponse>('/responses', body, signal);
    const r = extractJson(parseResponseText(res)) as { best?: unknown; sheets?: unknown };
    const best = r.best;
    if (!(Number.isInteger(best) && (best as number) >= 0 && (best as number) < sheets.length)) return null;
    return { best: best as number, sheets: cleanSheets(r.sheets) };
  } catch {
    return null;
  }
}

/**
 * Index of the sheet the judge picks, or null when it can't (failure, timeout, an answer that doesn't parse or is out of
 * range): the caller then treats the walk as unjudged. Images are data URLs; nothing here is logged.
 */
export async function pickWalk(client: MetaClient, reference: string, sheets: string[], signal?: AbortSignal): Promise<number | null> {
  return (await reviewWalks(client, reference, sheets, signal))?.best ?? null;
}
