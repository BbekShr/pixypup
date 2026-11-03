// The screen-aware loop: read -> decide -> tell the overlay. Pure of Electron so tests drive it with fakes.
// Screen text passes through here but is never logged or stored.
import type { BehaviorDecision } from '../../contracts/types';
import type { Behavior } from '../overlay/behavior';
import { toOverlayPoint } from '../overlay/behavior';
import type { DebugInfo, Gate } from '../overlay/debug-panel';
import type { Decided, Observation } from '../screen/decide';
import type { Settings } from './settings';

export const LOOP_MS = 5000;
const CLEAR_TICKS = 2; // consecutive call-free reads before the pet comes out
const EMPTY_CLEAR_TICKS = 10; // 10 x LOOP_MS = 50 s of failed (empty) reads: stop waiting, the overlay's hide has no timeout of its own

export type LoopDeps = {
  getSettings: () => Pick<Settings, 'screenAware' | 'adminDisableScreenAware' | 'offline' | 'callMode'>;
  isSnoozed: () => boolean;
  overlay: { bounds: () => { x: number; y: number; width: number; height: number } | null; send: (b: Behavior) => void };
  reader: { tick: () => Promise<{ observation: Observation; debug: { terminalKey: string; windowCount?: number } }> };
  decider: { decide: (o: Observation, key: string) => Promise<{ decision: BehaviorDecision | null; source?: Decided['source'] }> };
  debug?: { on: () => boolean; send: (i: DebugInfo) => void }; // the local "what Pakkun sees" panel; screen text goes nowhere else
  /** The failure he just sniffed (in memory only), for a hint the user may ask for; null once it is fixed. */
  onFailure?: (context: string | null) => void;
  /** Whether a hint can be asked for (a key is set); the sniff tells the overlay to offer one. */
  canHint?: () => boolean;
  intervalMs?: number;
};

export const CHEERS = ['You fixed it!', 'All green! Good human!', 'Yay, tests pass!', 'Yay! It works now!'];

const inside = (p: { x: number; y: number }, b: { x: number; y: number; width: number; height: number }): boolean =>
  p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;

export function startScreenLoop(d: LoopDeps): () => void {
  let inFlight = false;
  let seq = 0;
  let hideOn = false;
  let clear = 0;
  let empty = 0;
  let lastKey = '';
  let lastBadge: Observation['badge'] = null;
  let sniffed = false; // a failure he ran to and has not seen fixed yet
  let cheers = 0;
  const allowed = (): boolean => {
    const s = d.getSettings();
    return s.screenAware && !s.adminDisableScreenAware && !s.offline && !d.isSnoozed();
  };
  const gate = (): Gate => {
    const s = d.getSettings();
    return s.adminDisableScreenAware ? 'admin' : s.offline ? 'offline' : !s.screenAware ? 'off' : d.isSnoozed() ? 'snoozed' : 'on';
  };
  // Spark words a bubble once per failure; the following ticks keep showing what it said.
  let lastSniff: { key: string; bubble?: string; source: Decided['source']; sparkMs?: number } | null = null;
  const send = (b: Omit<Behavior, 'seq'>): void => d.overlay.send({ seq: ++seq, ...b });
  const setHide = (on: boolean, reason: string): void => {
    if (on === hideOn) return;
    hideOn = on;
    clear = 0;
    empty = 0;
    send({ action: 'hide', on, reason });
  };

  async function tick(): Promise<void> {
    if (inFlight) return;
    inFlight = true;
    try {
      if (!allowed()) {
        if (d.debug?.on()) d.debug.send({ ts: Date.now(), gate: gate(), terminal: { found: false }, badge: null, call: false, decision: null });
        return setHide(false, 'paused');
      }
      const { observation, debug } = await d.reader.tick();
      const t0 = Date.now();
      const { decision, source = 'rule' } = await d.decider.decide(observation, debug.terminalKey);
      const ms = Date.now() - t0;
      if (!allowed()) return setHide(false, 'paused');
      if (decision?.action === 'hide') {
        hideOn = true;
        clear = 0;
        empty = 0;
        send({ action: 'hide', on: true, mode: d.getSettings().callMode, reason: decision.reason }); // every tick: a reloaded overlay or swapped pet must not stay visible during a call
      } else if (hideOn) {
        // An empty window list is a failed read (unknown), not "the call ended": one never clears, a long run gives up.
        if (debug.windowCount === 0) empty++;
        else {
          empty = 0;
          clear++;
        }
        if (clear >= CLEAR_TICKS || empty >= EMPTY_CLEAR_TICKS) setHide(false, 'call ended');
      }
      if (debug.terminalKey === '') lastKey = '';
      const badge = observation.badge;
      let cheered = false;
      if (hideOn) {
        /* still hidden: the overlay would drop it, so keep it pending */
      } else if (decision?.action === 'sniff' && decision.target && debug.terminalKey !== lastKey) {
        const bounds = d.overlay.bounds();
        // Which display: judged by the failing line itself. The target sits 16 px left of it, outside the display for a window flush with the left edge.
        const box = observation.terminalError?.box;
        const probe = box ? { x: box.x + box.w / 2, y: box.y + box.h / 2 } : decision.target;
        // A failure on another display is skipped; on this one the target is clamped into the overlay.
        if (bounds && inside(probe, bounds)) {
          lastKey = debug.terminalKey;
          sniffed = true;
          const te = observation.terminalError;
          d.onFailure?.(te ? te.context || te.text : null);
          send({ action: 'sniff', target: toOverlayPoint(decision.target, bounds), bubble: decision.bubble ?? (lastSniff?.key === debug.terminalKey ? lastSniff.bubble : undefined), reason: decision.reason, ...(d.canHint?.() ? { hint: true } : {}) });
        }
      } else if (sniffed && !observation.terminalError && observation.terminalPass) {
        sniffed = false;
        cheered = true;
        d.onFailure?.(null);
        send({ action: 'celebrate', bubble: CHEERS[cheers++ % CHEERS.length], reason: 'tests pass again' });
      } else if (decision?.action === 'perk_up' && badge !== lastBadge) {
        send({ action: 'perk_up', bubble: decision.bubble ?? '!', reason: decision.reason });
      }
      lastBadge = badge;
      if (decision?.action === 'sniff' && decision.bubble) lastSniff = { key: debug.terminalKey, bubble: decision.bubble, source, ...(source === 'spark+rule' ? { sparkMs: ms } : {}) };
      if (d.debug?.on()) {
        const keep = decision?.action === 'sniff' && !decision.bubble && lastSniff?.key === debug.terminalKey ? lastSniff : null;
        const bounds = d.overlay.bounds();
        const box = observation.terminalError?.box;
        const bubble = decision?.bubble ?? keep?.bubble;
        const sparkMs = keep?.sparkMs ?? (source === 'spark+rule' ? ms : undefined);
        const info: DebugInfo = {
          ts: Date.now(),
          gate: 'on',
          terminal: { found: !!observation.terminalError, ...(box && bounds ? { box: { ...toOverlayPoint(box, bounds), w: box.w, h: box.h } } : {}), ...(observation.terminalError ? { text: observation.terminalError.text.slice(0, 80) } : {}) },
          badge: badge?.label ?? null,
          call: decision?.action === 'hide',
          decision: decision ? { action: decision.action, reason: decision.reason, ...(bubble ? { bubble } : {}), source: keep?.source ?? source } : cheered ? { action: 'celebrate', reason: 'tests pass again', source: 'rule' } : null,
          ...(sparkMs !== undefined ? { sparkMs } : {}),
        };
        d.debug.send(info);
      }
    } catch {
      /* the next tick retries; nothing from the screen is logged */
    } finally {
      inFlight = false;
    }
  }

  const timer = setInterval(() => void tick(), d.intervalMs ?? LOOP_MS);
  return () => clearInterval(timer);
}
