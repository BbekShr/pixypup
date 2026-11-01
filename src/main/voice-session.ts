// One listen window at a time: mic -> transcription -> command. Pure of Electron so tests drive it with fakes.
// Transcripts pass through here but are never logged or stored.
import type { Transcription, VoiceOptions } from '../api/voice';
import { matchCommand, type Command } from '../voice/commands';
import { CAP_MS, LISTEN_MS, createSilenceDetector, listenNext, type ListenEvent, type ListenState } from '../voice/listen';

export type VoiceUi = { kind: 'listening' | 'thinking' | 'idle' | 'huh' | 'error' | 'nokey' } | { kind: 'partial'; text: string };

export interface VoiceDeps {
  allowed(): boolean;
  key(): string | undefined;
  petName(): string;
  open(key: string, opts: Omit<VoiceOptions, 'apiKey'>): Promise<Transcription>;
  mic: { start(): void; stop(): void };
  ui(m: VoiceUi): void;
  command(c: Command): void;
  heard(text: string): void;
}

export function createVoiceSession(d: VoiceDeps): { press(): void; chunk(b: ArrayBuffer): void; abort(): void; state(): ListenState } {
  let state: ListenState = 'idle';
  let id = 0;
  let tr: Transcription | null = null;
  let pending: ArrayBuffer[] = []; // audio that arrives while the socket is still shaking hands
  let text = '';
  let silent = createSilenceDetector();
  let warned = false;
  let t1: NodeJS.Timeout | undefined;
  let t2: NodeJS.Timeout | undefined;

  const fire = (ev: ListenEvent): void => {
    const r = listenNext(state, ev);
    state = r.state;
    if (r.effect === 'start') start();
    else if (r.effect === 'stop') stop();
    else if (r.effect === 'abort') teardown(ev === 'error');
  };

  function start(): void {
    const me = ++id;
    pending = [];
    text = '';
    silent = createSilenceDetector();
    d.ui({ kind: 'listening' });
    d.mic.start();
    t1 = setTimeout(() => fire('timeout'), LISTEN_MS);
    t2 = setTimeout(() => fire('error'), CAP_MS);
    d.open(d.key()!, {
      onTranscript: (t) => {
        if (me !== id) return;
        text = t.text;
        d.ui({ kind: 'partial', text });
      },
      onError: () => me === id && fire('error'),
    }).then(
      (t) => {
        if (me !== id) return t.close();
        tr = t;
        for (const b of pending) t.push(b);
        pending = [];
        if (state === 'thinking') finish(t, me);
      },
      () => me === id && fire('error'),
    );
  }

  function stop(): void {
    clearTimeout(t1);
    d.mic.stop();
    d.ui({ kind: 'thinking' });
    if (tr) finish(tr, id);
  }

  function finish(t: Transcription, me: number): void {
    void t.end().then(() => {
      if (me !== id) return;
      clearTimeout(t2);
      const heard = text;
      fire('done');
      d.heard(heard.slice(0, 60));
      const cmd = matchCommand(heard, d.petName());
      if (cmd) d.command(cmd);
      d.ui({ kind: cmd ? 'idle' : 'huh' });
    });
  }

  function teardown(failed: boolean): void {
    id++;
    clearTimeout(t1);
    clearTimeout(t2);
    d.mic.stop();
    tr?.close();
    tr = null;
    pending = [];
    d.ui({ kind: failed ? 'error' : 'idle' });
  }

  return {
    press() {
      if (state === 'idle') {
        if (!d.allowed()) return;
        if (!d.key()) {
          if (!warned) d.ui({ kind: 'nokey' });
          warned = true; // once per launch: the pill is a hint, not a nag
          return;
        }
      }
      fire('press');
    },
    chunk(b) {
      if (state !== 'listening') return;
      if (tr) tr.push(b);
      else pending.push(b);
      if (silent(b)) fire('silence');
    },
    abort: () => fire('abort'),
    state: () => state,
  };
}
