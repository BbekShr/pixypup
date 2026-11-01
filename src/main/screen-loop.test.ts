import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Observation } from '../screen/decide';
import type { Behavior } from '../overlay/behavior';
import { startScreenLoop, type LoopDeps } from './screen-loop';

const obs = (o: Partial<Observation> = {}): Observation => ({ windows: [], slackBadge: null, terminalError: null, ...o });
const BOX = { x: 600, y: 300, w: 200, h: 16 };
const err = obs({ terminalError: { text: 'FAIL a.test.ts', box: BOX } });
const call = obs({ windows: [{ owner: 'zoom.us', title: 'Zoom Meeting', bounds: BOX }] });

function setup(over: Partial<LoopDeps> = {}) {
  const sent: Behavior[] = [];
  let current = err;
  let key = 'k1';
  const settings = { screenAware: true, adminDisableScreenAware: false, offline: false };
  let snoozed = false;
  const reader = { tick: vi.fn(async () => ({ observation: current, debug: { terminalKey: key } })) };
  const decide = vi.fn(async (o: Observation) => ({
    decision: o.windows.length ? { action: 'hide' as const, durationMs: 1, reason: 'call' } : o.terminalError ? { action: 'sniff' as const, target: { x: 700, y: 308 }, durationMs: 1, reason: 'err', bubble: 'Found a bug!' } : o.slackBadge ? { action: 'perk_up' as const, durationMs: 1, reason: 'slack' } : null,
  }));
  const stop = startScreenLoop({ getSettings: () => settings, isSnoozed: () => snoozed, overlay: { bounds: () => ({ x: 0, y: 25, width: 1440, height: 875 }), send: (b) => sent.push(b) }, reader, decider: { decide }, ...over });
  return { sent, reader, decide, settings, stop, set: (o: Observation, k = key) => { current = o; key = k; }, snooze: (v: boolean) => { snoozed = v; } };
}
const tick = (n = 1) => vi.advanceTimersByTimeAsync(5000 * n);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('startScreenLoop', () => {
  it('does nothing at all while screen-aware is off, admin-locked, offline or snoozed', async () => {
    for (const patch of [{ screenAware: false }, { adminDisableScreenAware: true }, { offline: true }]) {
      const t = setup();
      Object.assign(t.settings, patch);
      await tick(3);
      expect(t.reader.tick).not.toHaveBeenCalled();
      t.stop();
    }
    const t = setup();
    t.snooze(true);
    await tick(2);
    expect(t.reader.tick).not.toHaveBeenCalled();
    t.stop();
  });

  it('sends one sniff per failure in overlay coordinates, with the bubble', async () => {
    const t = setup();
    await tick(3);
    expect(t.sent).toEqual([{ seq: 1, action: 'sniff', target: { x: 700, y: 283 }, bubble: 'Found a bug!', reason: 'err' }]);
    t.set(obs(), '');
    await tick();
    t.set(err, 'k1');
    await tick();
    expect(t.sent.map((b) => b.action)).toEqual(['sniff', 'sniff']);
    expect(t.sent.map((b) => b.seq)).toEqual([1, 2]);
    t.stop();
  });

  it('hide is level-triggered: on once, off once', async () => {
    const t = setup();
    t.set(call, '');
    await tick(3);
    t.set(obs(), '');
    await tick(2);
    expect(t.sent.map((b) => [b.action, b.on])).toEqual([['hide', true], ['hide', false]]);
    t.stop();
  });

  it('snoozing during a call lifts the hide, and the call re-hides on wake', async () => {
    const t = setup();
    t.set(call, '');
    await tick();
    t.snooze(true);
    await tick();
    t.snooze(false);
    await tick();
    expect(t.sent.map((b) => b.on)).toEqual([true, false, true]);
    t.stop();
  });

  it('perks up once per new badge', async () => {
    const t = setup();
    t.set(obs({ slackBadge: '3' }), '');
    await tick(3);
    t.set(obs(), '');
    await tick();
    t.set(obs({ slackBadge: '1' }), '');
    await tick();
    expect(t.sent.map((b) => b.action)).toEqual(['perk_up', 'perk_up']);
    t.stop();
  });

  it('never overlaps ticks', async () => {
    let calls = 0;
    let release!: () => void;
    const slow = () => new Promise<{ observation: Observation; debug: { terminalKey: string } }>((r) => { calls++; release = () => r({ observation: obs(), debug: { terminalKey: '' } }); });
    const t = setup({ reader: { tick: slow } });
    await tick(4);
    expect(calls).toBe(1);
    release();
    t.stop();
  });
});
