import type { BehaviorDecision } from '../../contracts/types.js';
import type { Observation } from '../screen/decide.js';
import type { MetaClient } from './meta-client.js';

export const SPARK_MODEL = 'muse-spark-1.3';

// Request shapes, from the official docs (fetched as Markdown by appending .md to the URL):
// https://dev.meta.ai/docs/image-understanding  Responses: input: [{type:'message', role:'user',
//   content:[{type:'input_text', text}, {type:'input_image', image_url: 'https://...' | 'data:image/png;base64,...'}]}]
// https://dev.meta.ai/docs/structured-output  Responses: `text.format` (not `response_format`, which is Chat Completions)
//   = {type:'json_schema', name, schema, strict}; name is [A-Za-z0-9_-]{1,64}; recursive schemas are a 400.
// https://dev.meta.ai/docs/reasoning  Responses: `reasoning: {effort}`; 'none' is a 400 for Spark.
//   Reasoning tokens count against `max_output_tokens`.
// https://dev.meta.ai/docs/search-grounding  `tools: [{type:'web_search'}]`; the model decides whether to search; output has a
//   `web_search_call` item and `url_citation` annotations ({url, title, start_index, end_index}) on output_text parts;
//   `include: ['web_search_call.results']` adds `results: [{type:'text_result', title, url, snippet}]` to the call item.

export type Effort = 'minimal' | 'low' | 'medium' | 'high';

export interface SparkOptions {
  instructions: string;
  /** Pre-built Responses `input` (a plain string or message items). */
  input: unknown;
  schema: object;
  name: string;
  effort: Effort;
  signal?: AbortSignal;
  tools?: { type: 'web_search' }[];
  maxOutputTokens?: number;
}

interface Part {
  type: string;
  text?: string;
  refusal?: string;
  annotations?: { type: string; url?: string }[];
}
export interface SparkResponse {
  status?: string;
  output?: { type?: string; content?: Part[]; results?: { url?: string }[] }[];
}

export function sparkRequestBody(o: SparkOptions) {
  return {
    model: SPARK_MODEL,
    store: false,
    instructions: o.instructions,
    input: o.input,
    reasoning: { effort: o.effort },
    max_output_tokens: o.maxOutputTokens ?? 4096,
    text: { format: { type: 'json_schema', name: o.name, schema: o.schema, strict: true } },
    ...(o.tools ? { tools: o.tools, include: ['web_search_call.results'] } : {}),
  };
}

/** The answer text; a refusal, an unfinished response or an empty answer is an error. */
export function parseResponseText(res: SparkResponse): string {
  if (res.status !== 'completed') throw new Error(`Muse Spark response ${res.status ?? 'without status'}.`);
  const parts = (res.output ?? []).flatMap((item) => item.content ?? []);
  if (parts.some((p) => p.type === 'refusal')) throw new Error('Muse Spark refused.');
  const text = parts.filter((p) => p.type === 'output_text').map((p) => p.text ?? '').join('');
  if (!text.trim()) throw new Error('Muse Spark returned no text.');
  return text;
}

/**
 * URLs the search itself produced: url_citation annotations plus the pages the web_search call returned
 * (JSON-schema output carries no annotations, live). A source is shown only if the model named it AND it is in
 * this set, so a URL the model merely made up never becomes a source.
 */
export function citedUrls(res: SparkResponse): Set<string> {
  const urls = new Set<string>();
  for (const item of res.output ?? []) {
    for (const r of item.results ?? []) if (r.url) urls.add(r.url);
    for (const p of item.content ?? []) for (const a of p.annotations ?? []) if (a.type === 'url_citation' && a.url) urls.add(a.url);
  }
  return urls;
}

/**
 * The LAST top-level JSON object in `text`. With web_search on, the model narrates before the JSON
 * ("Gathering facts...{"facts":[...]}"), so JSON.parse on the whole text fails.
 */
export function extractJson(text: string): unknown {
  let last: unknown;
  let found = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    let depth = 0;
    let inStr = false;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (inStr) {
        if (c === '\\') j++;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        try {
          last = JSON.parse(text.slice(i, j + 1));
          found = true;
          i = j;
        } catch {
          /* a brace in the narration: keep scanning */
        }
        break;
      }
    }
  }
  if (!found) throw new Error('Muse Spark text has no JSON object.');
  return last;
}

export function sparkResponse(client: MetaClient, o: SparkOptions): Promise<SparkResponse> {
  return client.postJson<SparkResponse>('/responses', sparkRequestBody(o), o.signal);
}

export async function sparkJson<T>(client: MetaClient, o: SparkOptions & { validate: (v: unknown) => T }): Promise<T> {
  return o.validate(extractJson(parseResponseText(await sparkResponse(client, o))));
}

// TODO(F7): LLM behavior decision; must validate against contracts/behavior-decision.schema.json.
export function decideBehavior(_observation: Observation): Promise<BehaviorDecision> {
  throw new Error('not implemented');
}
