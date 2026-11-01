import type { BehaviorDecision } from '../../contracts/types';

export type Box = { x: number; y: number; w: number; h: number };

export type Observation = {
  windows: { owner: string; title: string; bounds: Box }[];
  badge: { app: string; label: string } | null;
  terminalError: { text: string; box?: Box; context?: string } | null;
  /** The newest test result in the front terminal is all green. */
  terminalPass?: boolean;
};

const TERMINALS = ['terminal', 'iterm', 'iterm2', 'warp', 'ghostty', 'alacritty', 'kitty'];

export function ruleDecide(obs: Observation): BehaviorDecision | null {
  const call = obs.windows.some(
    (w) =>
      /zoom\.us|^zoom$/i.test(w.owner) || /^Meet - [a-z]{3}-[a-z]{4}-[a-z]{3}\b|meet\.google\.com|^Zoom Meeting( - Zoom)?$/i.test(w.title),
  );
  if (call) return { action: 'hide', durationMs: 30000, reason: 'video call in progress' };

  if (obs.terminalError) {
    const box = obs.terminalError.box;
    let target: { x: number; y: number };
    if (box) {
      target = { x: box.x - 16, y: box.y + box.h / 2 };
    } else {
      const term = obs.windows.find((w) => TERMINALS.includes(w.owner.toLowerCase()));
      target = term
        ? { x: term.bounds.x, y: term.bounds.y + term.bounds.h }
        : { x: 0, y: 0 };
    }
    return { action: 'sniff', target, durationMs: 4000, reason: 'terminal error spotted' };
  }

  if (obs.badge) return { action: 'perk_up', durationMs: 3000, reason: `new badge in ${obs.badge.app.slice(0, 30)}` };
  return null;
}

export type SparkInput = { failureLine: string };
export type DeciderDeps = {
  spark?: (input: SparkInput, signal?: AbortSignal) => Promise<{ bubble: string } | null>;
  now?: () => number;
  minIntervalMs?: number;
};
export type Decided = { decision: BehaviorDecision | null; source: 'rule' | 'spark+rule' | 'none' };

const FALLBACKS = ['Found a bug!', 'Sniff sniff… a red line!'];
const SPARK_TIMEOUT_MS = 6000;

export function shouldCallSpark(key: string, lastKey: string | null, lastAt: number, now: number, minIntervalMs: number): boolean {
  return key !== lastKey && now - lastAt >= minIntervalMs;
}

export function createDecider(deps: DeciderDeps = {}) {
  const now = deps.now ?? Date.now;
  const minIntervalMs = deps.minIntervalMs ?? 30000;
  let lastKey: string | null = null;
  let lastAt = -Infinity;
  let n = 0;
  return {
    // The rules choose the action and target; Spark only words the bubble for a new failure.
    async decide(obs: Observation, key: string): Promise<Decided> {
      const decision = ruleDecide(obs);
      if (!key) lastKey = null;
      if (!decision) return { decision, source: 'none' };
      if (decision.action !== 'sniff' || key === lastKey) return { decision, source: 'rule' };
      const t = now();
      let bubble: string | undefined;
      if (deps.spark && obs.terminalError && shouldCallSpark(key, lastKey, lastAt, t, minIntervalMs)) {
        lastAt = t;
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), SPARK_TIMEOUT_MS);
        try {
          const call = deps.spark({ failureLine: obs.terminalError.text }, ac.signal);
          const timeout = new Promise<null>((r) => ac.signal.addEventListener('abort', () => r(null)));
          bubble = (await Promise.race([call, timeout]))?.bubble;
        } catch {
          /* fall back */
        } finally {
          clearTimeout(timer);
        }
      }
      lastKey = key;
      return { decision: { ...decision, bubble: bubble ?? FALLBACKS[n++ % FALLBACKS.length] }, source: bubble ? 'spark+rule' : 'rule' };
    },
  };
}
