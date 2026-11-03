import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../main/settings';
import { NetworkBlockedError, openClient, useFetch, type Purpose } from '../gate.js';

const s = DEFAULT_SETTINGS;
const on = { ...s, offline: false };
const blocked = (p: Purpose, st: typeof s) => () => openClient(p, st, 'k');

describe('openClient', () => {
  it("uses the app's fetch (Electron net.fetch: system proxy + Keychain certs) once set", () => {
    const f = (() => Promise.reject(new Error('unused'))) as unknown as typeof fetch;
    useFetch(f);
    expect(openClient('create-pet', s, 'k').fetchImpl).toBe(f);
  });
  it('defaults: create-pet allowed, screen and voice blocked', () => {
    expect(() => openClient('create-pet', s, 'k')).not.toThrow();
    expect(blocked('screen', s)).toThrow(NetworkBlockedError);
    expect(blocked('voice', s)).toThrow(NetworkBlockedError);
  });
  it('screenAware allows screen when online', () => {
    expect(() => openClient('screen', { ...on, screenAware: true }, 'k')).not.toThrow();
  });
  it('admin disable blocks screen even if screenAware', () => {
    expect(blocked('screen', { ...on, screenAware: true, adminDisableScreenAware: true })).toThrow(NetworkBlockedError);
  });
  it('offline blocks screen and voice but not create-pet', () => {
    const o = { ...s, screenAware: true, voice: true, offline: true };
    expect(blocked('screen', o)).toThrow(NetworkBlockedError);
    expect(blocked('voice', o)).toThrow(NetworkBlockedError);
    expect(() => openClient('create-pet', o, 'k')).not.toThrow();
  });
  it('talk is allowed by default and blocked only by offline', () => {
    expect(() => openClient('talk', s, 'k')).not.toThrow();
    expect(blocked('talk', { ...s, offline: true })).toThrow(NetworkBlockedError);
  });
  it('voice setting allows voice when online', () => {
    expect(() => openClient('voice', { ...on, voice: true }, 'k')).not.toThrow();
    expect(blocked('voice', on)).toThrow(NetworkBlockedError);
  });
});

const SRC = join(__dirname, '../..');
function walk(d: string): string[] {
  return readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? (f === '__tests__' ? [] : walk(p)) : /\.ts$/.test(f) && !/\.test\.ts$/.test(f) ? [p] : [];
  });
}
const files = walk(SRC).map((p) => ({ rel: relative(join(SRC, '..'), p), text: readFileSync(p, 'utf8') }));

describe('architecture: network goes through the gate', () => {
  const ALLOW = new Set(['src/api/meta-client.ts', 'src/api/gate.ts', 'src/api/muse-image.ts', 'src/api/voice.ts']);
  it('only allow-listed files open sockets, fetch, or construct MetaClient', () => {
    const bad = files.filter((f) => !ALLOW.has(f.rel) && /new MetaClient\(|new WebSocket\(|(?<![.\w])fetch\(/.test(f.text));
    expect(bad.map((f) => f.rel)).toEqual([]);
  });
  it('MetaClient is only constructed in meta-client.ts and gate.ts', () => {
    const bad = files.filter((f) => !['src/api/meta-client.ts', 'src/api/gate.ts'].includes(f.rel) && /new MetaClient\(/.test(f.text));
    expect(bad.map((f) => f.rel)).toEqual([]);
  });
  it('screen and voice code never import meta-client directly', () => {
    const bad = files.filter((f) => /^src\/(screen|voice)\//.test(f.rel) && /from ['"][^'"]*meta-client/.test(f.text));
    expect(bad.map((f) => f.rel)).toEqual([]);
  });
});
