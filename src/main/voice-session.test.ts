import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transcription, VoiceOptions } from '../api/voice';
import { CAP_MS, LISTEN_MS } from '../voice/listen';
import { createVoiceSession, type VoiceUi } from './voice-session';

const loud = new Int16Array(960).fill(8000).buffer;
const quiet = new Int16Array(960).buffer;

function rig(o: { key?: string; allowed?: boolean; transcript?: string; openFails?: boolean } = {}) {
  const log: string[] = [];
  const ui: VoiceUi[] = [];
  const cmds: string[] = [];
  let opts!: Omit<VoiceOptions, 'apiKey'>;
  let opened = 0;
  let pushed = 0;
  const got: ArrayBuffer[] = [];
  const tr: Transcription = {
    push: (b) => { pushed++; got.push(b as ArrayBuffer); },
    close: () => void log.push('close'),
    end: async () => {
      if (o.transcript) opts.onTranscript({ text: o.transcript, final: true });
    },
  };
  const s = createVoiceSession({
    allowed: () => o.allowed ?? true,
    key: () => ('key' in o ? o.key : 'k'),
    petName: () => 'Pakkun',
    open: async (_k, op) => {
      opened++;
      opts = op;
      if (o.openFails) throw new Error('x');
      return tr;
    },
    mic: { start: () => void log.push('mic+'), stop: () => void log.push('mic-') },
    ui: (m) => void ui.push(m),
    command: (c) => void cmds.push(c),
    heard: () => undefined,
  });
  return { s, log, ui, cmds, opened: () => opened, pushed: () => pushed, got, fail: () => opts.onError({ code: 1011 } as never) };
}
const kinds = (ui: VoiceUi[]) => ui.map((u) => u.kind);

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

describe('voice session', () => {
  it('every chunk from the press is kept through a slow handshake and pushed in order', async () => {
    let ack!: (t: Transcription) => void;
    const got: ArrayBuffer[] = [];
    const s = createVoiceSession({ allowed: () => true, key: () => 'k', petName: () => 'P', open: () => new Promise((r) => (ack = r)), mic: { start: () => undefined, stop: () => undefined }, ui: () => undefined, command: () => undefined, heard: () => undefined });
    s.press();
    const chunks = [1, 2, 3].map((n) => new Int16Array(960).fill(n).buffer);
    chunks.slice(0, 2).forEach((c) => s.chunk(c)); // before the ack
    await vi.advanceTimersByTimeAsync(1500); // a slow handshake must not eat the window
    ack({ push: (b) => void got.push(b as ArrayBuffer), close: () => undefined, end: async () => undefined });
    await vi.advanceTimersByTimeAsync(0);
    s.chunk(chunks[2]!);
    expect(got).toEqual(chunks);
    expect(s.state()).toBe('listening');
    await vi.advanceTimersByTimeAsync(3900); // 4 s counts from the ack
    expect(s.state()).toBe('listening');
    await vi.advanceTimersByTimeAsync(200);
    expect(s.state()).not.toBe('listening');
  });
  it('the name is optional after a press', async () => {
    for (const [said, cmd] of [['can you roll over?', 'roll'], ['sit', 'sit']] as const) {
      const r = rig({ transcript: said });
      r.s.press();
      await vi.advanceTimersByTimeAsync(0);
      r.s.press();
      await vi.advanceTimersByTimeAsync(0);
      expect(r.cmds).toEqual([cmd]);
    }
  });
  it('silence after speech ends the window and the final transcript runs the command', async () => {
    const r = rig({ transcript: 'Pakkun, sit' });
    r.s.press();
    await vi.advanceTimersByTimeAsync(0);
    r.s.chunk(loud);
    for (let i = 0; i < 24; i++) r.s.chunk(quiet);
    expect(r.s.state()).toBe('thinking');
    await vi.advanceTimersByTimeAsync(0);
    expect(r.cmds).toEqual(['sit']);
    expect(r.s.state()).toBe('idle');
    expect(r.log).toEqual(['mic+', 'mic-']);
    expect(r.pushed()).toBe(24);
  });
  it('4 s with no speech stops listening; a second press stops early; never two sessions', async () => {
    const r = rig();
    r.s.press();
    r.s.press();
    expect(r.opened()).toBe(1);
    expect(r.s.state()).toBe('thinking');
    r.s.press();
    expect(r.opened()).toBe(1);
    await vi.advanceTimersByTimeAsync(0);
    const r2 = rig();
    r2.s.press();
    await vi.advanceTimersByTimeAsync(LISTEN_MS);
    expect(r2.s.state()).toBe('idle'); // fake end() resolved at once
    expect(r2.log).toContain('mic-');
  });
  it('unmatched speech shows the huh pose, not an error', async () => {
    const r = rig({ transcript: 'hello there' });
    r.s.press();
    await vi.advanceTimersByTimeAsync(0);
    r.s.press();
    await vi.advanceTimersByTimeAsync(0);
    expect(r.cmds).toEqual([]);
    expect(kinds(r.ui).at(-1)).toBe('huh');
  });
  it('an ASR error or a failed open gives the gentle error and frees the mic', async () => {
    const r = rig();
    r.s.press();
    await vi.advanceTimersByTimeAsync(0);
    r.fail();
    expect(kinds(r.ui).at(-1)).toBe('error');
    expect(r.log).toEqual(['mic+', 'mic-', 'close']);
    expect(r.s.state()).toBe('idle');
    const r2 = rig({ openFails: true });
    r2.s.press();
    await vi.advanceTimersByTimeAsync(0);
    expect(kinds(r2.ui).at(-1)).toBe('error');
  });
  it('abort (snooze, voice off, quit) closes everything and starts no command', async () => {
    const r = rig({ transcript: 'Pakkun sit' });
    r.s.press();
    await vi.advanceTimersByTimeAsync(0);
    r.s.abort();
    await vi.advanceTimersByTimeAsync(CAP_MS);
    expect(r.s.state()).toBe('idle');
    expect(r.log).toEqual(['mic+', 'mic-', 'close']);
    expect(r.cmds).toEqual([]);
    expect(kinds(r.ui).at(-1)).toBe('idle');
  });
  it('the 6 s hard cap ends a session whose socket never answers', async () => {
    const hang = createVoiceSession({ allowed: () => true, key: () => 'k', petName: () => 'P', open: () => new Promise(() => undefined), mic: { start: () => undefined, stop: () => undefined }, ui: () => undefined, command: () => undefined, heard: () => undefined });
    hang.press();
    await vi.advanceTimersByTimeAsync(CAP_MS);
    expect(hang.state()).toBe('idle');
  });
  it('audio is ignored outside the listening window', async () => {
    const r = rig();
    r.s.chunk(loud);
    expect(r.pushed()).toBe(0);
  });
  it('not allowed: no mic, no socket; no key: one hint per launch', async () => {
    const off = rig({ allowed: false });
    off.s.press();
    expect(off.opened() + off.log.length).toBe(0);
    const nokey = rig({ key: undefined });
    nokey.s.press();
    nokey.s.press();
    expect(kinds(nokey.ui)).toEqual(['nokey']);
    expect(nokey.opened() + nokey.log.length).toBe(0);
  });
});
