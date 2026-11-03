import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Observation } from '../screen/decide';
import type { Behavior } from '../overlay/behavior';
import type { DebugInfo } from '../overlay/debug-panel';
import { CHEERS, startScreenLoop, type LoopDeps } from './screen-loop';

const obs = (o: Partial<Observation> = {}): Observation => ({ windows: [], badge: null, terminalError: null, ...o });
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
    decision: o.windows.length ? { action: 'hide' as const, durationMs: 1, reason: 'call' } : o.terminalError ? { action: 'sniff' as const, target: { x: 700, y: 308 }, durationMs: 1, reason: 'err', bubble: 'Found a bug!' } : o.badge ? { action: 'perk_up' as const, durationMs: 1, reason: 'slack' } : null,
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

  it('celebrates once when the sniffed failure goes green, and remembers the failure only until then', async () => {
    const failures: (string | null)[] = [];
    const t = setup({ onFailure: (f) => failures.push(f), canHint: () => true });
    const withCtx = obs({ terminalError: { text: 'Tests 1 failed', box: BOX, context: 'FAIL a.test.ts\nexpected 4 to be 5' } });
    t.set(withCtx, 'k1');
    await tick();
    expect(t.sent[0]).toMatchObject({ action: 'sniff', hint: true });
    expect(failures).toEqual(['FAIL a.test.ts\nexpected 4 to be 5']);
    t.set(obs({ terminalPass: true }), '');
    await tick(3);
    expect(t.sent.map((b) => b.action)).toEqual(['sniff', 'celebrate']);
    expect(t.sent[1]).toMatchObject({ seq: 2, bubble: CHEERS[0], reason: 'tests pass again' });
    expect(failures).toEqual(['FAIL a.test.ts\nexpected 4 to be 5', null]);
    t.stop();
  });

  it('a green run with no sniff before it, or during a call, is no party', async () => {
    const t = setup();
    t.set(obs({ terminalPass: true }), '');
    await tick(2);
    expect(t.sent).toEqual([]);
    t.set(err, 'k1');
    await tick();
    t.set({ ...call, terminalPass: true }, '');
    await tick();
    expect(t.sent.map((b) => b.action)).toEqual(['sniff', 'hide']);
    t.stop();
  });

  it('offers no hint without a key', async () => {
    const t = setup({ canHint: () => false });
    await tick();
    expect(t.sent[0]?.hint).toBeUndefined();
    t.stop();
  });

  it('hide is resent every tick during a call, and lifted only after two clear reads', async () => {
    const t = setup();
    t.set(call, '');
    await tick(3);
    t.set(obs(), '');
    await tick(1);
    expect(t.sent.map((b) => b.on)).toEqual([true, true, true]); // one clear read is not enough
    await tick(1);
    expect(t.sent.map((b) => b.on)).toEqual([true, true, true, false]);
    await tick(2);
    expect(t.sent).toHaveLength(4);
    t.stop();
  });

  it('a failed window read (no windows) neither ends the hide nor counts as clear', async () => {
    let cur = call;
    let wins = 5;
    const t = setup({ reader: { tick: async () => ({ observation: cur, debug: { terminalKey: '', windowCount: wins } }) } });
    await tick(1);
    cur = obs();
    wins = 0;
    await tick(5);
    expect(t.sent.every((b) => b.on === true)).toBe(true);
    wins = 5;
    await tick(2);
    expect(t.sent.at(-1)?.on).toBe(false);
    t.stop();
  });

  it('skips a sniff whose target is on another display instead of clamping it', async () => {
    const t = setup({ overlay: { bounds: () => ({ x: 1440, y: 0, width: 1440, height: 900 }), send: () => undefined } });
    await tick(3);
    expect(t.sent).toEqual([]);
    t.stop();
  });

  it('sniffs a failure whose line is flush with the display left edge (maximized terminal)', async () => {
    const flush = obs({ terminalError: { text: 'FAIL a.test.ts', box: { x: 4, y: 300, w: 200, h: 16 } } });
    const decide = async () => ({ decision: { action: 'sniff' as const, target: { x: -12, y: 308 }, durationMs: 1, reason: 'err', bubble: 'b' } });
    const t = setup({ reader: { tick: async () => ({ observation: flush, debug: { terminalKey: 'k1' } }) }, decider: { decide }, overlay: { bounds: () => ({ x: 0, y: 25, width: 1440, height: 875 }), send: (b) => t.sent.push(b) } });
    await tick();
    expect(t.sent).toEqual([{ seq: 1, action: 'sniff', target: { x: 0, y: 283 }, bubble: 'b', reason: 'err' }]);
    t.stop();
  });


  it('still skips a flush-left-looking failure that is on the second display', async () => {
    const other = obs({ terminalError: { text: 'FAIL', box: { x: 1500, y: 300, w: 200, h: 16 } } });
    const decide = async () => ({ decision: { action: 'sniff' as const, target: { x: 1484, y: 308 }, durationMs: 1, reason: 'err', bubble: 'b' } });
    const sent: Behavior[] = [];
    const t = setup({ reader: { tick: async () => ({ observation: other, debug: { terminalKey: 'k1' } }) }, decider: { decide }, overlay: { bounds: () => ({ x: 0, y: 0, width: 1440, height: 900 }), send: (b) => sent.push(b) } });
    await tick(2);
    expect(sent).toEqual([]);
    t.stop();
  });

  it('keeps the Spark bubble for a failure whose sniff was held back by a call', async () => {
    let step = 0;
    const decide = async () => {
      step++;
      if (step === 1) return { decision: { action: 'hide' as const, durationMs: 1, reason: 'call' } };
      const bubble = step === 2 ? 'Spark words' : undefined;
      return { decision: { action: 'sniff' as const, target: { x: 700, y: 308 }, durationMs: 1, reason: 'err', ...(bubble ? { bubble } : {}) } };
    };
    const t = setup({ decider: { decide } });
    await tick(3);
    const sniff = t.sent.filter((b) => b.action === 'sniff');
    expect(sniff).toHaveLength(1);
    expect(sniff[0]!.bubble).toBe('Spark words');
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
    expect(t.sent.filter((b) => b.on !== undefined).map((b) => b.on)).toEqual([true, false, true]);
    t.stop();
  });

  it('perks up once per new badge', async () => {
    const t = setup();
    t.set(obs({ badge: { app: 'Mail', label: '3' } }), '');
    await tick(3);
    t.set(obs(), '');
    await tick();
    t.set(obs({ badge: { app: 'Mail', label: '1' } }), '');
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

  it('with the panel on, sends a debug info per tick (text cut to 80, box in overlay coords) and keeps the sniff bubble after the first tick', async () => {
    const infos: DebugInfo[] = [];
    let on = true;
    const long = 'FAIL ' + 'x'.repeat(200);
    const t = setup({ debug: { on: () => on, send: (i) => infos.push(i) } });
    t.set(obs({ terminalError: { text: long, box: BOX } }));
    await tick(2);
    expect(infos).toHaveLength(2);
    expect(infos[0]!.terminal).toEqual({ found: true, box: { x: 600, y: 275, w: 200, h: 16 }, text: long.slice(0, 80) });
    expect(infos[0]!.decision).toMatchObject({ action: 'sniff', bubble: 'Found a bug!' });
    expect(infos[1]!.gate).toBe('on');
    on = false;
    await tick();
    expect(infos).toHaveLength(2);
    t.stop();
  });

  it('with the panel on, reports why nothing is being read, and nothing from the screen', async () => {
    const infos: DebugInfo[] = [];
    const t = setup({ debug: { on: () => true, send: (i) => infos.push(i) } });
    t.settings.screenAware = false;
    await tick();
    t.settings.screenAware = true;
    t.snooze(true);
    await tick();
    t.snooze(false);
    t.settings.adminDisableScreenAware = true;
    await tick();
    expect(infos.map((i) => i.gate)).toEqual(['off', 'snoozed', 'admin']);
    expect(infos.every((i) => !i.terminal.found && !i.terminal.text)).toBe(true);
    expect(t.reader.tick).not.toHaveBeenCalled();
    t.stop();
  });
});
