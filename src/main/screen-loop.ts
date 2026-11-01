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

export type LoopDeps = {
  getSettings: () => Pick<Settings, 'screenAware' | 'adminDisableScreenAware' | 'offline'>;
  isSnoozed: () => boolean;
  overlay: { bounds: () => { x: number; y: number; width: number; height: number } | null; send: (b: Behavior) => void };
  reader: { tick: () => Promise<{ observation: Observation; debug: { terminalKey: string; windowCount?: number } }> };
  decider: { decide: (o: Observation, key: string) => Promise<{ decision: BehaviorDecision | null; source?: Decided['source'] }> };
  debug?: { on: () => boolean; send: (i: DebugInfo) => void }; // the local "what Pakkun sees" panel; screen text goes nowhere else
  intervalMs?: number;
};

const inside = (p: { x: number; y: number }, b: { x: number; y: number; width: number; height: number }): boolean =>
  p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;

export function startScreenLoop(d: LoopDeps): () => void {
  let inFlight = false;
  let seq = 0;
  let hideOn = false;
  let clear = 0;
  let lastKey = '';
  let lastBadge: Observation['badge'] = null;
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
        send({ action: 'hide', on: true, reason: decision.reason }); // every tick: a reloaded overlay or swapped pet must not stay visible during a call
      } else if (hideOn && debug.windowCount !== 0 && ++clear >= CLEAR_TICKS) {
        setHide(false, 'call ended'); // an empty window list is a failed read (unknown), not "the call ended"
      }
      if (debug.terminalKey === '') lastKey = '';
      const badge = observation.badge;
      if (hideOn) {
        /* still hidden: the overlay would drop it, so keep it pending */
      } else if (decision?.action === 'sniff' && decision.target && debug.terminalKey !== lastKey) {
        const bounds = d.overlay.bounds();
        // A target on another display is skipped, not clamped to this display's edge.
        if (bounds && inside(decision.target, bounds)) {
          lastKey = debug.terminalKey;
          send({ action: 'sniff', target: toOverlayPoint(decision.target, bounds), bubble: decision.bubble, reason: decision.reason });
        }
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
          decision: decision ? { action: decision.action, reason: decision.reason, ...(bubble ? { bubble } : {}), source: keep?.source ?? source } : null,
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
