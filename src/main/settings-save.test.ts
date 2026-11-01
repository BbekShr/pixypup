import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dir = vi.hoisted(() => ({ cur: '' }));
vi.mock('electron', () => ({ app: { getPath: () => dir.cur } }));

import { loadSettings, saveSettings } from './settings';

const file = (): string => join(dir.cur, 'settings.json');

describe('saveSettings', () => {
  beforeEach(() => {
    dir.cur = mkdtempSync(join(tmpdir(), 'pixy-settings-'));
  });
  it('writes the patch and loadSettings reads it back', () => {
    saveSettings({ petName: 'milo', onboarded: true });
    const s = loadSettings();
    expect(s.petName).toBe('milo');
    expect(s.onboarded).toBe(true);
  });
  it('keeps the keys it did not touch, even unknown ones', () => {
    writeFileSync(file(), JSON.stringify({ voice: true, future: 1 }));
    saveSettings({ onboarded: true });
    expect(JSON.parse(readFileSync(file(), 'utf8'))).toEqual({ voice: true, future: 1, onboarded: true });
  });
  it('stores snooze and clears it with null', () => {
    saveSettings({ snoozeUntil: 99, size: 'small' });
    expect(loadSettings()).toMatchObject({ snoozeUntil: 99, size: 'small' });
    saveSettings({ snoozeUntil: null });
    expect(loadSettings().snoozeUntil).toBeNull();
  });
  it.each([{ size: 'tiny' }, { energy: 'x' }, { snoozeUntil: 'x' }, { onboarded: 'yes' }, { petName: '' }, { petName: 5 }, {}, null, 'x', { unknown: true }])('rejects %j and writes nothing', (bad) => {
    expect(() => saveSettings(bad)).toThrow();
    expect(() => readFileSync(file(), 'utf8')).toThrow();
  });
});
