// "How does it move?": Muse Spark reads the cutout and returns a MotionProfile (gait, cycle, rests, sounds, tricks).
// Privacy: the only inputs are the cutout, the pet's name and species. Never screen data.
// Any failure gives null; the caller falls back to defaultProfile(species).

import type { CycleKind, Fidget, Locomotion, MotionProfile, RoleDef, RoleName } from '../../contracts/types.js';
import type { MetaClient } from './meta-client.js';
import { sparkJson, type SparkOptions } from './muse-spark.js';
import { clean } from './personality.js';
import { CYCLES, FIDGETS, LOCOMOTIONS, RANGE, ROLES, STRIDE_PLAUSIBLE, clamp, defaultProfile } from './profile-defaults.js';

const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {});
const num = (v: unknown, key: keyof typeof RANGE, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? clamp(v, RANGE[key]) : fallback;
const oneOf = <T extends string>(list: readonly T[], v: unknown): T => {
  if (!list.includes(v as T)) throw new Error('Bad profile enum.');
  return v as T;
};
// Prose over the cap is cut at a word boundary rather than failing the whole profile.
const fit = (v: unknown, max: number): unknown => {
  const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  if (s.length <= max) return v;
  const cut = s.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : max);
};
const need = (v: unknown, max: number): string => {
  const s = clean(fit(v, max), max);
  if (!s) throw new Error('Bad profile text.');
  return s;
};

/** Enums checked, text cleaned, numbers clamped. Throws when too little is usable; a bad role falls back to the default's. */
export function sanitizeProfile(v: unknown, species: string): MotionProfile {
  const o = obj(v);
  const locomotion: Locomotion = oneOf(LOCOMOTIONS, o.locomotion);
  const def = defaultProfile(species);
  const g = obj(o.gait);
  const [lo, hi] = STRIDE_PLAUSIBLE[locomotion];
  const stride = typeof g.strideBody === 'number' && g.strideBody >= lo && g.strideBody <= hi ? g.strideBody : def.gait.strideBody;
  const a = obj(o.air);
  const roles = {} as Record<RoleName, RoleDef>;
  for (const r of ROLES) {
    const d = obj(obj(o.roles)[r]);
    const label = clean(d.label, 16);
    const prompt = clean(d.prompt, 200);
    const bubble = clean(d.bubble, 12);
    roles[r] = label && prompt ? { label, prompt, ...(bubble ? { bubble } : {}) } : def.roles[r];
  }
  const fidgets = [...new Set(Array.isArray(o.fidgets) ? o.fidgets.filter((f): f is Fidget => FIDGETS.includes(f as Fidget)) : [])].slice(0, 5);
  if (fidgets.length < 2) throw new Error('Too few fidgets.');
  const cycle = obj(o.cycle);
  const kind: CycleKind = oneOf(CYCLES, cycle.kind);
  const minLift = num(a.minLiftBody, 'minLiftBody', 1);
  const profile: MotionProfile = {
    locomotion,
    subject: need(o.subject, 60),
    styleHints: need(o.styleHints, 120),
    gait: {
      cadenceHz: num(g.cadenceHz, 'cadenceHz', def.gait.cadenceHz),
      strideBody: clamp(stride, RANGE.strideBody),
      bounce: num(g.bounce, 'bounce', def.gait.bounce),
      pitchDeg: num(g.pitchDeg, 'pitchDeg', def.gait.pitchDeg),
      speedBody: num(g.speedBody, 'speedBody', def.gait.speedBody),
    },
    cycle: { kind, prompt: need(cycle.prompt, 900) },
    idlePrompt: need(o.idlePrompt, 200),
    fidgets,
    roles,
    energy: need(o.energy, 40),
  };
  if (locomotion === 'fly') {
    profile.air = {
      minLiftBody: minLift,
      maxLiftBody: Math.max(minLift + 0.5, num(a.maxLiftBody, 'maxLiftBody', 4)),
      flutterHz: num(a.flutterHz, 'flutterHz', 6),
      perches: a.perches === true,
      sway: num(a.sway, 'sway', 0.4),
    };
  }
  return profile;
}

const text = (description: string) => ({ type: 'string', description });
const number = (description: string) => ({ type: 'number', description });
const role = (what: string) => ({
  type: 'object',
  additionalProperties: false,
  required: ['label', 'prompt', 'bubble'],
  properties: {
    label: text(`Menu label for ${what}, at most 16 characters.`),
    prompt: text(`Pose description for ${what}, at most 200 characters, starting with "Pose:". It describes only the pose; the same character is kept.`),
    bubble: text('A short sound or word the creature says, at most 12 characters, or an empty string.'),
  },
});

const PROFILE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['locomotion', 'subject', 'styleHints', 'gait', 'air', 'cycle', 'idlePrompt', 'fidgets', 'roles', 'energy'],
  properties: {
    locomotion: { enum: LOCOMOTIONS },
    subject: text('What it is, e.g. "a husky", without its name, at most 60 characters.'),
    styleHints: text('Features that must stay recognisable in every drawing, at most 120 characters.'),
    gait: {
      type: 'object',
      additionalProperties: false,
      required: ['cadenceHz', 'strideBody', 'bounce', 'pitchDeg', 'speedBody'],
      properties: {
        cadenceHz: number('Gait cycles per second, 0.5 to 8.'),
        strideBody: number('Body widths travelled per full cycle, 0.1 to 4. A walking dog is about 0.9.'),
        bounce: number('Vertical bob in body heights, 0 to 0.3.'),
        pitchDeg: number('Forward lean in degrees, 0 to 25.'),
        speedBody: number('Cruise speed in body widths per second, 0.05 to 5. A walking dog is about 0.5.'),
      },
    },
    air: {
      type: 'object',
      additionalProperties: false,
      required: ['minLiftBody', 'maxLiftBody', 'flutterHz', 'perches', 'sway'],
      properties: {
        minLiftBody: number('Lowest flight height in body heights above the floor, 0 to 6. Ignored unless it flies.'),
        maxLiftBody: number('Highest flight height in body heights, 0.5 to 10.'),
        flutterHz: number('Wing or fin beats per second, 1 to 40.'),
        perches: { type: 'boolean' },
        sway: number('Side-to-side drift, 0 to 1.'),
      },
    },
    cycle: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'prompt'],
      properties: {
        kind: { enum: CYCLES },
        prompt: text(
          'An image prompt for a horizontal sprite sheet of exactly 4 frames of this same character moving, in strict side profile facing right, ' +
            'one eye visible, same size in every frame, 4 equal columns with wide magenta gaps. At most 900 characters.',
        ),
      },
    },
    idlePrompt: text('Pose description for standing or hovering still in side view facing right, starting with "Pose:", at most 200 characters.'),
    fidgets: { type: 'array', minItems: 2, maxItems: 5, items: { enum: FIDGETS } },
    roles: {
      type: 'object',
      additionalProperties: false,
      required: ROLES,
      properties: {
        rest: role('a calm rest (sit, perch, land, float)'),
        sleep: role('sleeping'),
        voice: role('its sound'),
        trick: role('a playful trick'),
      },
    },
    energy: text('One or two words, e.g. "playful".'),
  },
};

export async function motionProfile(
  client: MetaClient,
  cutoutPng: Buffer,
  name: string,
  species: string,
  signal?: AbortSignal,
  opts: { webSearch?: boolean } = {},
): Promise<MotionProfile | null> {
  try {
    const o: SparkOptions & { validate: (v: unknown) => MotionProfile } = {
      instructions:
        'You plan the animation of a kids-friendly desktop pet drawn from a photo. Base every answer on what you see and on how this ' +
        'kind of creature really moves. Pose and cycle prompts keep the same character and use side-profile wording for the cycle. ' +
        'Choose rests, sounds and tricks that suit the creature. Never include links or emojis.',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `This is ${name.slice(0, 40)}, a ${species.slice(0, 30)}. How does this creature move and idle? Which rests, sounds and tricks suit it?`,
            },
            { type: 'input_image', image_url: `data:image/png;base64,${cutoutPng.toString('base64')}` },
          ],
        },
      ],
      schema: PROFILE_SCHEMA,
      name: 'motion_profile',
      effort: 'low',
      signal,
      ...(opts.webSearch ? { tools: [{ type: 'web_search' as const }] } : {}),
      validate: (v) => sanitizeProfile(v, species),
    };
    return await sparkJson(client, o);
  } catch {
    return null;
  }
}
