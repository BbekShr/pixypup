import { describe, expect, it } from 'vitest';
import type { Settings } from './settings';

// settings.ts imports electron; mock it so the pure function can be tested.
import { vi } from 'vitest';
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));

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
