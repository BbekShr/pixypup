import { describe, expect, it } from 'vitest';
import { ACCELERATOR, createSilenceDetector, listenNext, parseVoice, shouldRegister, syncShortcut, validChunk, type ListenEvent, type ListenState } from './listen';

const run = (evs: ListenEvent[], s: ListenState = 'idle') => evs.reduce((a, e) => ({ ...listenNext(a.state, e), prev: a.state }), { state: s, effect: 'none', prev: s } as ReturnType<typeof listenNext> & { prev: ListenState });

describe('listenNext', () => {
  it('press starts, silence/timeout/second press stop, done ends', () => {
    expect(listenNext('idle', 'press')).toEqual({ state: 'listening', effect: 'start' });
    for (const e of ['silence', 'timeout', 'press'] as const) expect(listenNext('listening', e)).toEqual({ state: 'thinking', effect: 'stop' });
    expect(listenNext('thinking', 'done')).toEqual({ state: 'idle', effect: 'none' });
  });
  it('error and abort tear down from any live state; a second window cannot start while one runs', () => {
    for (const s of ['listening', 'thinking'] as const) for (const e of ['error', 'abort'] as const) expect(listenNext(s, e)).toEqual({ state: 'idle', effect: 'abort' });
    expect(run(['press', 'press', 'press']).state).toBe('thinking');
    expect(listenNext('thinking', 'press').effect).toBe('none');
  });
  it('stray events while idle do nothing', () => {
    for (const e of ['silence', 'timeout', 'done', 'error', 'abort'] as const) expect(listenNext('idle', e)).toEqual({ state: 'idle', effect: 'none' });
  });
});

describe('shortcut', () => {
  const fake = () => {
    const on = new Set<string>();
    return { on, register: (a: string) => !!on.add(a), unregister: (a: string) => void on.delete(a), isRegistered: (a: string) => on.has(a) };
  };
  it('exists only while voice is on, online and awake', () => {
    expect(shouldRegister({ voice: true, offline: false }, false)).toBe(true);
    expect(shouldRegister({ voice: false, offline: false }, false)).toBe(false);
    expect(shouldRegister({ voice: true, offline: true }, false)).toBe(false);
    expect(shouldRegister({ voice: true, offline: false }, true)).toBe(false);
  });
  it('registers once and unregisters when no longer wanted', () => {
    const gs = fake();
    syncShortcut(gs, true, () => undefined);
    syncShortcut(gs, true, () => undefined);
    expect([...gs.on]).toEqual([ACCELERATOR]);
    syncShortcut(gs, false, () => undefined);
    expect(gs.on.size).toBe(0);
  });
});

describe('validChunk', () => {
  it('accepts a whole-sample ArrayBuffer up to 64 KB only', () => {
    expect(validChunk(new ArrayBuffer(1920))).not.toBeNull();
    expect(validChunk(new ArrayBuffer(64 * 1024))).not.toBeNull();
    expect(validChunk(new ArrayBuffer(64 * 1024 + 2))).toBeNull();
    expect(validChunk(new ArrayBuffer(0))).toBeNull();
    expect(validChunk(new ArrayBuffer(3))).toBeNull();
    expect(validChunk(new Uint8Array(100))).toBeNull();
    expect(validChunk('x')).toBeNull();
  });
});

describe('createSilenceDetector', () => {
  const loud = new Int16Array(960).fill(8000).buffer; // 40 ms
  const quiet = new Int16Array(960).buffer;
  it('needs speech first, then 900 ms of quiet', () => {
    const d = createSilenceDetector();
    for (let i = 0; i < 40; i++) expect(d(quiet)).toBe(false); // 1.6 s of room tone is not "trailing"
    expect(d(loud)).toBe(false);
    for (let i = 0; i < 22; i++) expect(d(quiet)).toBe(false); // 880 ms
    expect(d(quiet)).toBe(true);
  });
  it('speech resets the quiet clock', () => {
    const d = createSilenceDetector();
    d(loud);
    for (let i = 0; i < 20; i++) d(quiet);
    d(loud);
    for (let i = 0; i < 20; i++) expect(d(quiet)).toBe(false);
  });
});

describe('parseVoice', () => {
  it('keeps known kinds, cuts partial text to the last 30 chars, drops the rest', () => {
    expect(parseVoice({ kind: 'listening' })).toEqual({ kind: 'listening' });
    expect(parseVoice({ kind: 'partial', text: 'x'.repeat(50) })).toEqual({ kind: 'partial', text: 'x'.repeat(30) });
    expect(parseVoice({ kind: 'partial' })).toBeNull();
    expect(parseVoice({ kind: 'boom' })).toBeNull();
    expect(parseVoice(null)).toBeNull();
  });
});
