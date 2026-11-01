import type { BehaviorDecision } from '../../contracts/types';

export type Box = { x: number; y: number; w: number; h: number };

export type Observation = {
  windows: { owner: string; title: string; bounds: Box }[];
  slackBadge: string | null;
  terminalError: { text: string; box?: Box } | null;
};

const TERMINALS = ['terminal', 'iterm', 'iterm2', 'warp', 'ghostty', 'alacritty', 'kitty'];

export function ruleDecide(obs: Observation): BehaviorDecision | null {
  const call = obs.windows.some(
    (w) =>
      /zoom\.us|^zoom$/i.test(w.owner) || /^meet - |meet\.google\.com|zoom meeting/i.test(w.title),
  );
  if (call) return { action: 'hide', durationMs: 30000, reason: 'video call in progress' };

  if (obs.terminalError) {
    const box = obs.terminalError.box;
    let target: { x: number; y: number };
    if (box) {
      target = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    } else {
      const term = obs.windows.find((w) => TERMINALS.includes(w.owner.toLowerCase()));
      target = term
        ? { x: term.bounds.x, y: term.bounds.y + term.bounds.h }
        : { x: 0, y: 0 };
    }
    return { action: 'sniff', target, durationMs: 4000, reason: 'terminal error spotted' };
  }

  if (obs.slackBadge) return { action: 'idle', durationMs: 3000, reason: 'perk up' };
  return null;
}
