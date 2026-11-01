import { describe, expect, it } from 'vitest';
import type { Settings } from './settings';

// settings.ts imports electron; mock it so the pure function can be tested.
import { vi } from 'vitest';
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));
const fsMock = vi.hoisted(() => ({ files: {} as Record<string, string> }));
vi.mock('node:fs', () => ({
  existsSync: (p: string) => p in fsMock.files,
  readFileSync: (p: string) => fsMock.files[p],
}));

const defaults: Settings = {
  screenAware: false,
  voice: false,
  offline: true,
  adminDisableScreenAware: false,
  petName: 'Pakkun',
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
  it('rejects petName over 40 chars, accepts valid one', async () => {
    expect((await load({ [USER]: JSON.stringify({ petName: 'x'.repeat(41) }) })).petName).toBe('Pakkun');
    expect((await load({ [USER]: '{"petName":"Rex"}' })).petName).toBe('Rex');
  });
  it('corrupt admin file forces screenAware and voice off despite user enabling them', async () => {
    const { ADMIN_FILE } = await import('./settings');
    const s = await load({ [USER]: '{"screenAware":true,"voice":true}', [ADMIN_FILE]: '{oops' });
    expect(s.screenAware).toBe(false);
    expect(s.voice).toBe(false);
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
});
