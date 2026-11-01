// "Meet your pet": Muse Spark reads the cutout and writes a personality; with web_search it adds sourced breed facts.
// Privacy: the only inputs are the cutout, the pet's name and species/breed. Never screen data.

import type { Personality, PetFact, Species } from '../../contracts/types.js';
import { citedUrls, extractJson, parseResponseText, sparkJson, sparkResponse } from './muse-spark.js';
import type { MetaClient } from './meta-client.js';

export type { Personality, PetFact };

const BAD_TEXT = /https?:|www\.|@|\p{Extended_Pictographic}/u;
const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/\s+/g, ' ');
  return s && s.length <= max && !BAD_TEXT.test(s) ? s : null;
};

/** Trim and bound model text; lines that are too long or carry a URL/@/emoji are dropped. Throws when too little is left. */
export function sanitizePersonality(v: unknown): Personality {
  const o = (v ?? {}) as Record<string, unknown>;
  const breed = clean(o.breed, 60);
  const coat = clean(o.coat, 80);
  const traits = Array.isArray(o.traits) ? o.traits.map((t) => clean(t, 30)) : [];
  const lines = (Array.isArray(o.lines) ? o.lines : []).map((l) => clean(l, 40)).filter((l): l is string => l !== null);
  if (!breed || !coat || traits.length !== 3 || traits.includes(null)) throw new Error('Bad personality.');
  if (o.energy !== 'sleepy' && o.energy !== 'normal' && o.energy !== 'playful') throw new Error('Bad personality energy.');
  if (lines.length < 3) throw new Error('Too few usable lines.');
  return { breed, coat, traits: traits as Personality['traits'], energy: o.energy, lines: lines.slice(0, 6) };
}

const PERSONALITY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['breed', 'coat', 'traits', 'energy', 'lines'],
  properties: {
    breed: { type: 'string', description: 'Best-guess breed or mix, e.g. "Shiba Inu".' },
    coat: { type: 'string', description: 'Coat colour and markings in a few words.' },
    traits: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string', description: 'One word or short phrase.' } },
    energy: { enum: ['sleepy', 'normal', 'playful'] },
    lines: {
      type: 'array',
      minItems: 6,
      maxItems: 6,
      items: { type: 'string', description: 'First person, cute, in the pet\'s voice, at most 40 characters, no emojis.' },
    },
  },
};

export async function meetPet(
  client: MetaClient,
  cutoutPng: Buffer,
  name: string,
  species: Species,
  signal?: AbortSignal,
): Promise<Personality | null> {
  try {
    return await sparkJson(client, {
      instructions:
        'You meet a pet from its photo and describe it for a kids-friendly desktop pet app. ' +
        'Base every answer on what you see. Be warm and playful. Never include links or emojis.',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: `This is ${name.slice(0, 40)}, a ${species}. Who are they? Write 6 short catchphrases they would say.` },
            { type: 'input_image', image_url: `data:image/png;base64,${cutoutPng.toString('base64')}` },
          ],
        },
      ],
      schema: PERSONALITY_SCHEMA,
      name: 'pet_personality',
      effort: 'low',
      signal,
      validate: sanitizePersonality,
    });
  } catch {
    return null;
  }
}

const FACTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['facts'],
  properties: {
    facts: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'source'],
        properties: {
          text: { type: 'string', description: 'One true, kid-friendly fact, at most 90 characters.' },
          source: { type: 'string', description: 'URL of the page that supports the fact, or an empty string.' },
        },
      },
    },
  },
};

export async function breedFacts(
  client: MetaClient,
  breed: string,
  species: Species,
  signal?: AbortSignal,
): Promise<PetFact[] | null> {
  try {
    const res = await sparkResponse(client, {
      instructions:
        'Search the web and give 3 true, kid-friendly facts about the breed. Each fact is at most 90 characters, ' +
        'plain words, no links in the text. Give the URL of the page that supports each fact as its source.',
      input: `Breed: ${breed.slice(0, 60)} (${species}).`,
      schema: FACTS_SCHEMA,
      name: 'breed_facts',
      effort: 'low',
      signal,
      tools: [{ type: 'web_search' }],
    });
    const raw = (extractJson(parseResponseText(res)) as { facts?: { text?: unknown; source?: unknown }[] }).facts ?? [];
    const cited = citedUrls(res);
    const facts: PetFact[] = [];
    for (const f of raw) {
      const text = clean(f.text, 90);
      if (!text) continue;
      // The model may invent a source: show it only when the search actually returned or cited that URL.
      const source = typeof f.source === 'string' && f.source.startsWith('https://') && f.source.length <= 300 && cited.has(f.source) ? f.source : undefined;
      facts.push(source ? { text, source } : { text });
    }
    return facts.length ? facts.slice(0, 3) : null;
  } catch {
    return null;
  }
}
