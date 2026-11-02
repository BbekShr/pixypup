import { describe, expect, it } from 'vitest';
import { tryKey } from './key-check';

const s = { screenAware: false, voice: false, adminDisableScreenAware: false, offline: false };
const answer = (status: number): typeof fetch => (async () => new Response('{}', { status })) as typeof fetch;

describe('tryKey', () => {
  it('accepts a key Meta answers for', async () => {
    expect(await tryKey('sk-good-key', s, { fetchImpl: answer(200) })).toBe('ok');
  });
  it('rejects a key Meta refuses', async () => {
    expect(await tryKey('sk-bad-key', s, { fetchImpl: answer(401) })).toBe('bad-key');
    expect(await tryKey('sk-bad-key', s, { fetchImpl: answer(403) })).toBe('bad-key');
  });
  it('asks to retry when Meta is unreachable', async () => {
    const offline = (async () => { throw new TypeError('fetch failed', { cause: new Error('ENOTFOUND') }); }) as typeof fetch;
    expect(await tryKey('sk-any-key', s, { fetchImpl: offline })).toBe('network');
  });
  it('keeps the key when Meta accepted it but the call itself failed', async () => {
    expect(await tryKey('sk-good-key', s, { fetchImpl: answer(400) })).toBe('ok');
  });
  it("makes no call under an admin's offline mode and keeps the key", async () => {
    let called = false;
    const spy = (async () => { called = true; return new Response('{}'); }) as typeof fetch;
    expect(await tryKey('sk-any-key', { ...s, offline: true }, { fetchImpl: spy })).toBe('ok');
    expect(called).toBe(false);
  });
});
