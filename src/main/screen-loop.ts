// The screen-aware loop: read -> decide -> tell the overlay. Pure of Electron so tests drive it with fakes.
// Screen text passes through here but is never logged or stored.
import type { BehaviorDecision } from '../../contracts/types';
import type { Behavior } from '../overlay/behavior';
import { toOverlayPoint } from '../overlay/behavior';
import type { Observation } from '../screen/decide';
import type { Settings } from './settings';

export const LOOP_MS = 5000;
const CLEAR_TICKS = 2; // consecutive call-free reads before the pet comes out

export type LoopDeps = {
  getSettings: () => Pick<Settings, 'screenAware' | 'adminDisableScreenAware' | 'offline'>;
  isSnoozed: () => boolean;
  overlay: { bounds: () => { x: number; y: number; width: number; height: number } | null; send: (b: Behavior) => void };
  reader: { tick: () => Promise<{ observation: Observation; debug: { terminalKey: string; windowCount?: number } }> };
  decider: { decide: (o: Observation, key: string) => Promise<{ decision: BehaviorDecision | null }> };
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
  let lastBadge: string | null = null;
  const allowed = (): boolean => {
    const s = d.getSettings();
    return s.screenAware && !s.adminDisableScreenAware && !s.offline && !d.isSnoozed();
  };
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
      if (!allowed()) return setHide(false, 'paused');
      const { observation, debug } = await d.reader.tick();
      const { decision } = await d.decider.decide(observation, debug.terminalKey);
      if (!allowed()) return setHide(false, 'paused');
      if (decision?.action === 'hide') {
        hideOn = true;
        clear = 0;
        send({ action: 'hide', on: true, reason: decision.reason }); // every tick: a reloaded overlay or swapped pet must not stay visible during a call
      } else if (hideOn && debug.windowCount !== 0 && ++clear >= CLEAR_TICKS) {
        setHide(false, 'call ended'); // an empty window list is a failed read (unknown), not "the call ended"
      }
      if (debug.terminalKey === '') lastKey = '';
      const badge = observation.slackBadge;
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
    } catch {
      /* the next tick retries; nothing from the screen is logged */
    } finally {
      inFlight = false;
    }
  }

  const timer = setInterval(() => void tick(), d.intervalMs ?? LOOP_MS);
  return () => clearInterval(timer);
}
