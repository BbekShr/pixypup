import type { MetaClient } from './meta-client.js';
import { extractJson, parseResponseText, sparkRequestBody, type SparkResponse } from './muse-spark.js';
import { JUDGE_MODEL } from './walk-judge.js';

/** What each reviewed pose should show; the judge checks the drawing against this. */
export const POSE_MEANING: Record<string, string> = {
  sit: 'sitting',
  sleep: 'curled up asleep',
  bark: 'barking or meowing happily, mouth open',
  roll: 'a fun trick, such as rolling over or a playful pose',
  idle_blink: 'the idle pose with both eyes closed in a blink',
};

const SCORE = { type: 'integer', minimum: 0, maximum: 10 };
export const POSE_REVIEW = {
  type: 'object',
  additionalProperties: false,
  required: ['poses'],
  properties: {
    poses: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'same_pet', 'pose_matches', 'anatomy', 'tails', 'issue'],
        properties: { name: { type: 'string' }, same_pet: SCORE, pose_matches: SCORE, anatomy: SCORE, tails: { type: 'integer' }, issue: { type: 'string' } },
      },
    },
  },
};

export const POSE_JUDGE =
  'You are a strict art director checking sprites for a desktop pet before they ship. Image 1 is the reference pet; each further image is one ' +
  'pose, in the order listed. A flat magenta background is only a chroma key. Score each pose 0-10: same_pet (same character, colours, face and ' +
  'markings as the reference; do not mark down a collar or tag the reference also has), pose_matches (it clearly shows the named pose), anatomy ' +
  '(the right number of legs, ears and eyes, nothing fused, cropped or floating). Count tails: a curled or wrapped tail is still one tail; a second ' +
  'tail anywhere, for example across the face, counts as 2; 0 if none is visible. issue: the main problem in one short sentence an illustrator can ' +
  'act on, or "" when there is none.';

export interface PoseVerdict { name: string; same_pet: number; pose_matches: number; anatomy: number; tails: number; issue: string }

/** One number to compare attempts at the same pose: the weakest score, with a second tail counted as a failure. */
export const poseScore = (v: PoseVerdict): number => Math.min(v.same_pet, v.pose_matches, v.anatomy) - (v.tails > 1 ? 10 : 0);

export const posePasses = (v: PoseVerdict): boolean => poseScore(v) >= 7;

/**
 * The judge's verdict for each named pose, or null when it can't be had (failure, timeout, an answer that doesn't parse):
 * the caller then ships the poses as drawn. Images are data URLs on magenta; nothing here is logged.
 */
export async function reviewPoses(
  client: MetaClient,
  reference: string,
  poses: { name: string; image: string }[],
  signal?: AbortSignal,
): Promise<Map<string, PoseVerdict> | null> {
  if (!poses.length) return new Map();
  try {
    const input = [{ type: 'message', role: 'user', content: [
      { type: 'input_text', text: 'Poses in order after the reference: ' + poses.map((p) => `${p.name} (${POSE_MEANING[p.name] ?? p.name})`).join('; ') + '.' },
      { type: 'input_image', image_url: reference },
      ...poses.map((p) => ({ type: 'input_image', image_url: p.image })),
    ] }];
    const body = { ...sparkRequestBody({ instructions: POSE_JUDGE, input, schema: POSE_REVIEW, name: 'pose_review', effort: 'low' }), model: JUDGE_MODEL };
    const res = await client.postJson<SparkResponse>('/responses', body, signal);
    const list = (extractJson(parseResponseText(res)) as { poses?: unknown }).poses;
    if (!Array.isArray(list)) return null;
    const out = new Map<string, PoseVerdict>();
    for (const v of list as PoseVerdict[]) if (v && poses.some((p) => p.name === v.name) && [v.same_pet, v.pose_matches, v.anatomy, v.tails].every(Number.isInteger)) out.set(v.name, v);
    return out;
  } catch {
    return null;
  }
}
