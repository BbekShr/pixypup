import { describe, expect, it } from 'vitest';
import { storeKey, tryKey } from './key-check';

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

describe('storeKey', () => {
  it('stores only a key Meta accepts', async () => {
    const saved: string[] = [];
    expect(await storeKey('sk-good-key', s, (k) => saved.push(k), { fetchImpl: answer(200) })).toBe('ok');
    expect(saved).toEqual(['sk-good-key']);
  });
  it('does not store a rejected key', async () => {
    const saved: string[] = [];
    expect(await storeKey('sk-bad-key', s, (k) => saved.push(k), { fetchImpl: answer(401) })).toBe('bad-key');
    expect(saved).toEqual([]);
  });
  it('reports unsafe when the Keychain store throws', async () => {
    const boom = () => { throw new Error('no encryption'); };
    expect(await storeKey('sk-good-key', s, boom, { fetchImpl: answer(200) })).toBe('unsafe');
  });
  it('makes no call when offline and keeps the key as typed', async () => {
    let called = false;
    const spy = (async () => { called = true; return new Response('{}'); }) as typeof fetch;
    const saved: string[] = [];
    expect(await storeKey('sk-any-key', { ...s, offline: true }, (k) => saved.push(k), { fetchImpl: spy })).toBe('ok');
    expect(called).toBe(false);
    expect(saved).toEqual(['sk-any-key']);
  });
});
