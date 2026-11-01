import { describe, expect, it } from 'vitest';
import type { Settings } from './settings';

// settings.ts imports electron; mock it so the pure function can be tested.
import { vi } from 'vitest';
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));
const fsMock = vi.hoisted(() => ({ files: {} as Record<string, string> }));
vi.mock('node:fs', () => ({
  readFileSync: (p: string) => {
    if (!(p in fsMock.files)) throw Object.assign(new Error('nope'), { code: 'ENOENT' });
    const v = fsMock.files[p];
    if (v === 'EACCES') throw Object.assign(new Error('denied'), { code: 'EACCES' });
    return v;
  },
}));

const defaults: Settings = {
  screenAware: false,
  voice: false,
  offline: true,
  adminDisableScreenAware: false,
  petName: 'Pakkun',
  onboarded: false,
  size: 'medium',
  hideInShares: false,
  openAtLogin: false,
  snoozeUntil: null,
};

describe('mergeSettings', () => {
  it('returns defaults when nothing else given', async () => {
    const { mergeSettings } = await import('./settings');
    expect(mergeSettings(defaults)).toEqual(defaults);
  });
  it('user overrides defaults, admin overrides user', async () => {
    const { mergeSettings } = await import('./settings');
    const s = mergeSettings(defaults, { petName: 'Rex', voice: true }, { petName: 'Corp' });
    expect(s.petName).toBe('Corp');
    expect(s.voice).toBe(true);
  });
  it('admin disable forces screenAware off', async () => {
    const { mergeSettings } = await import('./settings');
    const s = mergeSettings(defaults, { screenAware: true }, { adminDisableScreenAware: true });
    expect(s.screenAware).toBe(false);
  });
});

describe('loadSettings (real read/merge path)', () => {
  const USER = '/tmp/settings.json';
  const load = async (files: Record<string, string>) => {
    fsMock.files = files;
    const { loadSettings } = await import('./settings');
    return loadSettings();
  };
  it('drops wrong-typed values: "false" string does not enable screenAware', async () => {
    const s = await load({ [USER]: '{"screenAware":"false","voice":1,"petName":"","extra":true}' });
    expect(s).toEqual(defaults);
  });
  it('reads the calm keys; wrong types are dropped from the user file', async () => {
    const ok = await load({ [USER]: '{"size":"large","energy":"sleepy","hideInShares":true,"openAtLogin":true,"snoozeUntil":1234}' });
    expect(ok).toMatchObject({ size: 'large', energy: 'sleepy', hideInShares: true, openAtLogin: true, snoozeUntil: 1234 });
    const bad = await load({ [USER]: '{"size":"huge","energy":3,"hideInShares":"y","openAtLogin":1,"snoozeUntil":"x"}' });
    expect(bad).toEqual(defaults);
    expect(bad.energy).toBeUndefined();
  });
  it('admin overrides the calm keys', async () => {
    const { ADMIN_FILE } = await import('./settings');
    const s = await load({ [USER]: '{"size":"large","hideInShares":false}', [ADMIN_FILE]: '{"size":"small","hideInShares":true}' });
    expect(s).toMatchObject({ size: 'small', hideInShares: true });
  });
  it('rejects petName over 40 chars, accepts valid one', async () => {
    expect((await load({ [USER]: JSON.stringify({ petName: 'x'.repeat(41) }) })).petName).toBe('Pakkun');
    expect((await load({ [USER]: '{"petName":"Rex"}' })).petName).toBe('Rex');
  });
  it('corrupt admin file forces screenAware and voice off despite user enabling them', async () => {
    const { ADMIN_FILE } = await import('./settings');
    const s = await load({ [USER]: '{"screenAware":true,"voice":true}', [ADMIN_FILE]: '{oops' });
    expect(s.screenAware).toBe(false);
    expect(s.voice).toBe(false);
    expect(s.offline).toBe(true);
  });
  it('admin file that is not a JSON object fails closed', async () => {
    const { ADMIN_FILE } = await import('./settings');
    const s = await load({ [USER]: '{"screenAware":true,"voice":true}', [ADMIN_FILE]: '[]' });
    expect(s.screenAware).toBe(false);
    expect(s.voice).toBe(false);
  });
  it('valid admin adminDisableScreenAware turns screenAware off', async () => {
    const { ADMIN_FILE } = await import('./settings');
    const s = await load({ [USER]: '{"screenAware":true}', [ADMIN_FILE]: '{"adminDisableScreenAware":true}' });
    expect(s.screenAware).toBe(false);
  });
  it('missing admin file: user settings apply; corrupt user file gives defaults', async () => {
    expect((await load({ [USER]: '{"screenAware":true,"voice":true}' })).screenAware).toBe(true);
    expect(await load({ [USER]: '{oops' })).toEqual(defaults);
  });
  it.each([
    '{"adminDisableScreenAware":"true"}',
    '{"adminDisableScreenAware":1}',
    '{"screenAware":"false"}',
    '{"petName":""}',
    '{"size":"huge"}',
    '{"energy":"hyper"}',
    '{"hideInShares":"yes"}',
    '{"openAtLogin":1}',
    '{"snoozeUntil":"soon"}',
  ])('admin file with invalid known key %s fails closed', async (admin) => {
    const { ADMIN_FILE } = await import('./settings');
    const s = await load({ [USER]: '{"screenAware":true,"voice":true}', [ADMIN_FILE]: admin });
    expect(s.screenAware).toBe(false);
    expect(s.voice).toBe(false);
  });
  it('unreadable (EACCES) admin file fails closed', async () => {
    const { ADMIN_FILE } = await import('./settings');
    const s = await load({ [USER]: '{"screenAware":true,"voice":true}', [ADMIN_FILE]: 'EACCES' });
    expect(s.screenAware).toBe(false);
    expect(s.voice).toBe(false);
  });
});
