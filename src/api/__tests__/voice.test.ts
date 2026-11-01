import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../main/settings';
import { NetworkBlockedError } from '../gate.js';
import { openTranscription, openVoice, type VoiceError } from '../voice.js';

class FakeWS {
  static last: FakeWS;
  sent: (string | Uint8Array)[] = [];
  closedWith: number | undefined;
  onopen?: () => void;
  onmessage?: (e: { data: unknown }) => void;
  onclose?: (e: { code: number; reason: string }) => void;
  onerror?: () => void;
  constructor(readonly url: string) {
    FakeWS.last = this;
  }
  send(d: string | Uint8Array) {
    this.sent.push(d);
  }
  close(code = 1000) {
    this.closedWith = code;
  }
  recv(o: object) {
    this.onmessage?.({ data: JSON.stringify(o) });
  }
}
const Impl = FakeWS as unknown as typeof WebSocket;
const KEY = 'sk-secret-key';
const text = () => FakeWS.last.sent.filter((s): s is string => typeof s === 'string').map((s) => JSON.parse(s));
const frames = () => FakeWS.last.sent.filter((s): s is Uint8Array => typeof s !== 'string');

function setup(extra: object = {}) {
  const onTranscript = vi.fn();
  const onError = vi.fn<(e: VoiceError) => void>();
  const p = openTranscription({ apiKey: KEY, keywords: ['Pakkun'], onTranscript, onError, WebSocketImpl: Impl, ...extra });
  FakeWS.last.onopen?.();
  FakeWS.last.recv({ sessionId: 's1' });
  return { p, onTranscript, onError };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('openTranscription', () => {
  it('sends the handshake with key only there, and keywords', async () => {
    const { p } = setup();
    await p;
    const [hs] = text();
    expect(hs).toMatchObject({
      authorization: { accessToken: `Bearer ${KEY}` },
      audioEncoding: 'PCM_24KHZ',
      model: 'muse-voice-transcribe-1.0',
      mode: 'PUSH_TO_TALK',
    });
    expect(hs.keywords).toEqual(expect.arrayContaining(['Pakkun', 'sit', 'roll over', 'go to bed', 'come here', 'bark', 'nap']));
    expect(FakeWS.last.url).not.toContain(KEY);
  });

  it('waits for the ack before resolving', async () => {
    const p = openTranscription({ apiKey: KEY, onTranscript: vi.fn(), onError: vi.fn(), WebSocketImpl: Impl });
    FakeWS.last.onopen?.();
    let ok = false;
    void p.then(() => (ok = true));
    await vi.advanceTimersByTimeAsync(100);
    expect(ok).toBe(false);
    FakeWS.last.recv({ sessionId: 's' });
    await p;
  });

  it('paces at most one 80 ms frame per tick', async () => {
    const t = await setup().p;
    t.push(new Int16Array(3840 * 3)); // 3 x 160 ms
    expect(frames()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(80);
    expect(frames()).toHaveLength(1);
    expect(frames()[0].byteLength).toBe(3840);
    await vi.advanceTimersByTimeAsync(80 * 5);
    expect(frames()).toHaveLength(6);
    await vi.advanceTimersByTimeAsync(800);
    expect(frames()).toHaveLength(6);
  });

  it('end() drains audio, sends endStream, and resolves on the final transcript', async () => {
    const { p, onTranscript } = setup();
    const t = await p;
    t.push(new Int16Array(1920).buffer);
    const ended = t.end();
    await vi.advanceTimersByTimeAsync(80);
    expect(frames()).toHaveLength(1);
    expect(text().at(-1)).toEqual(expect.objectContaining({ authorization: expect.anything() }));
    await vi.advanceTimersByTimeAsync(80);
    expect(text().at(-1)).toEqual({ type: 'endStream' });
    FakeWS.last.recv({ type: 'transcript', transcript: 'pakkun sit', final: false });
    FakeWS.last.recv({ type: 'transcript', transcript: 'Pakkun, sit.', final: true });
    await ended;
    expect(onTranscript).toHaveBeenLastCalledWith({ text: 'Pakkun, sit.', final: true });
    expect(FakeWS.last.closedWith).toBe(1000);
  });

  it('end() gives up after the timeout', async () => {
    const t = await setup().p;
    const ended = t.end();
    await vi.advanceTimersByTimeAsync(5000);
    await ended;
    expect(FakeWS.last.closedWith).toBe(1000);
  });

  it.each([1008, 1011, 1013])('close %i reports onError with the code and a short reason', async (code) => {
    const { p, onError } = setup();
    await p;
    FakeWS.last.onclose?.({ code, reason: 'x'.repeat(500) });
    expect(onError).toHaveBeenCalledOnce();
    const e = onError.mock.calls[0][0];
    expect(e.code).toBe(code);
    expect(e.message.length).toBeLessThan(80);
  });

  it('does not forward server error event text', async () => {
    const { p, onError } = setup();
    await p;
    FakeWS.last.recv({ type: 'error', message: 'leaky detail' });
    expect(onError).not.toHaveBeenCalled();
  });

  it('rejects when closed before the ack', async () => {
    const p = openTranscription({ apiKey: KEY, onTranscript: vi.fn(), onError: vi.fn(), WebSocketImpl: Impl });
    FakeWS.last.onclose?.({ code: 1008, reason: 'bad' });
    await expect(p).rejects.toMatchObject({ code: 1008 });
  });

  it('abort closes the socket', async () => {
    const ac = new AbortController();
    const t = await setup({ signal: ac.signal }).p;
    t.push(new Int16Array(3840));
    ac.abort();
    expect(FakeWS.last.closedWith).toBe(1000);
    await vi.advanceTimersByTimeAsync(500);
    expect(frames()).toHaveLength(0);
  });
});

describe('openVoice', () => {
  it('is blocked by the gate when voice is off, before any socket exists', () => {
    FakeWS.last = undefined as never;
    expect(() => openVoice(DEFAULT_SETTINGS, KEY, { onTranscript: vi.fn(), onError: vi.fn(), WebSocketImpl: Impl })).toThrow(NetworkBlockedError);
    expect(FakeWS.last).toBeUndefined();
  });
});
