import { describe, expect, it } from 'vitest';
import { commandToPatch, energyParams, isSnoozed, parsePrefs, sizeScale, snoozeUntil } from './prefs';

describe('snoozeUntil', () => {
  it('1 hour is exactly 3600 s later', () => {
    const n = new Date(2026, 10, 3, 14, 30);
    expect(snoozeUntil('1h', n) - n.getTime()).toBe(3_600_000);
  });
  it('tomorrow is the next 8:00 local: today before 8, tomorrow after (incl. after 8 pm and exactly 8:00)', () => {
    expect(new Date(snoozeUntil('tomorrow', new Date(2026, 10, 3, 3, 0)))).toEqual(new Date(2026, 10, 3, 8, 0));
    expect(new Date(snoozeUntil('tomorrow', new Date(2026, 10, 3, 14, 0)))).toEqual(new Date(2026, 10, 4, 8, 0));
    expect(new Date(snoozeUntil('tomorrow', new Date(2026, 10, 3, 22, 15)))).toEqual(new Date(2026, 10, 4, 8, 0));
    expect(new Date(snoozeUntil('tomorrow', new Date(2026, 10, 3, 8, 0)))).toEqual(new Date(2026, 10, 4, 8, 0));
  });
  it('stays at 8:00 wall-clock across a DST change and month end', () => {
    for (const [y, m, d] of [[2026, 2, 7], [2026, 9, 31], [2026, 10, 0]] as const) {
      const t = new Date(snoozeUntil('tomorrow', new Date(y, m, d, 21, 0)));
      expect([t.getHours(), t.getMinutes()]).toEqual([8, 0]);
    }
  });
  it('isSnoozed is true only while the time is in the future', () => {
    expect(isSnoozed(null, 10)).toBe(false);
    expect(isSnoozed(11, 10)).toBe(true);
    expect(isSnoozed(10, 10)).toBe(false);
  });
});

describe('energyParams', () => {
  it('sleepy is slower with longer dwell and sleeps sooner; playful the opposite; normal is today', () => {
    const [s, n, p] = (['sleepy', 'normal', 'playful'] as const).map(energyParams) as [ReturnType<typeof energyParams>, ReturnType<typeof energyParams>, ReturnType<typeof energyParams>];
    expect(n).toMatchObject({ dwell: 1, speed: 1, sleepAfterMs: 60_000, trickChance: 0 });
    expect(s.sleepAfterMs).toBe(30_000);
    expect(p.sleepAfterMs).toBe(180_000);
    expect(s.dwell).toBeGreaterThan(n.dwell);
    expect(p.dwell).toBeLessThan(n.dwell);
    expect(s.speed).toBeLessThan(n.speed);
    expect(p.speed).toBeGreaterThan(n.speed);
    expect(p.trickChance).toBeGreaterThan(0);
  });
});

describe('sizeScale / parsePrefs / commandToPatch', () => {
  it('scales relative to medium', () => {
    expect(sizeScale('medium')).toBe(1);
    expect(sizeScale('small')).toBeCloseTo(110 / 140);
    expect(sizeScale('large')).toBeCloseTo(180 / 140);
  });
  it('parsePrefs accepts only the exact shape', () => {
    expect(parsePrefs({ size: 'small', energy: 'sleepy', snoozed: true })).toEqual({ size: 'small', energy: 'sleepy', snoozed: true });
    for (const bad of [null, 'x', {}, { size: 'huge', energy: 'normal', snoozed: false }, { size: 'small', energy: 'x', snoozed: false }, { size: 'small', energy: 'normal', snoozed: 1 }]) {
      expect(parsePrefs(bad)).toBeNull();
    }
  });
  it('maps commands to settings patches and rejects the rest', () => {
    const n = new Date(2026, 10, 3, 14, 0);
    expect(commandToPatch('size:large', n)).toEqual({ size: 'large' });
    expect(commandToPatch('energy:playful', n)).toEqual({ energy: 'playful' });
    expect(commandToPatch('hide:on', n)).toEqual({ hideInShares: true });
    expect(commandToPatch('screen:yes', n)).toEqual({ screenAware: true });
    expect(commandToPatch('screen:off', n)).toEqual({ screenAware: false });
    expect(commandToPatch('screen:on', n)).toBeNull(); // on must go through the explainer
    expect(commandToPatch('voice:yes', n)).toEqual({ voice: true });
    expect(commandToPatch('voice:off', n)).toEqual({ voice: false });
    expect(commandToPatch('voice:on', n)).toBeNull(); // voice:on alone never enables
    expect(commandToPatch('login:off', n)).toEqual({ openAtLogin: false });
    expect(commandToPatch('wake', n)).toEqual({ snoozeUntil: null });
    expect(commandToPatch('snooze:1h', n)).toEqual({ snoozeUntil: n.getTime() + 3_600_000 });
    for (const bad of ['sit', 'size:huge', 'energy:', 'hide:maybe', 'snooze:5y', 'snooze', '']) expect(commandToPatch(bad, n)).toBeNull();
  });
});
