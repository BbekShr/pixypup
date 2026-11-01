// Thin client for the Meta Model API (https://api.meta.ai/v1).
// No SDK: fetch + a small server-sent-events reader. Standard tier only: never pass a
// `*-contributor` model ID, those allow Meta to train on request content.

export const META_API_BASE = 'https://api.meta.ai/v1';

export class MetaApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly path: string,
  ) {
    super(`Meta API ${path} failed with ${status}: ${body.slice(0, 500)}`);
    this.name = 'MetaApiError';
  }
}

export interface MetaClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/** A Responses API stream event. Only `type` is guaranteed; the rest depends on it. */
export interface StreamEvent {
  readonly type: string;
  readonly [key: string]: unknown;
}

export function assertStandardTier(model: string): void {
  if (model.endsWith('-contributor')) {
    throw new Error(`Refusing contributor-tier model ${model}: it allows training on your data.`);
  }
}

export class MetaClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: MetaClientOptions) {
    if (!opts.apiKey) throw new Error('Meta API key is missing (set MODEL_API_KEY).');
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? META_API_BASE;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async request(path: string, body: unknown, accept: string): Promise<Response> {
    const model = (body as { model?: unknown }).model;
    if (typeof model === 'string') assertStandardTier(model);
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: accept,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new MetaApiError(res.status, await res.text(), path);
    return res;
  }

  async postJson<T>(path: string, body: unknown): Promise<T> {
    const res = await this.request(path, body, 'application/json');
    return (await res.json()) as T;
  }

  /** POST with `stream: true` and yield each SSE `data:` payload as a parsed event. */
  async *postStream(path: string, body: unknown): AsyncGenerator<StreamEvent> {
    const res = await this.request(path, body, 'text/event-stream');
    if (!res.body) throw new MetaApiError(res.status, 'empty stream body', path);
    yield* parseSse(res.body);
  }
}

/** Parse a text/event-stream body into JSON events. Exported for tests. */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  const decoder = new TextDecoder();
  let buffer = '';
  const reader = body.getReader();
  const flush = function* (block: string): Generator<StreamEvent> {
    const data = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data || data === '[DONE]') return;
    yield JSON.parse(data) as StreamEvent;
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      yield* flush(block);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) yield* flush(buffer);
}

export function clientFromEnv(): MetaClient {
  return new MetaClient({ apiKey: process.env.MODEL_API_KEY ?? '' });
}
