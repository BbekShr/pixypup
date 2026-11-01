import { ruleDecide, type Observation } from './decide';
import { badgeBump, getBadges } from './dock-badge';
import type { Run } from './helper';
import { createTerminalReader, pickTerminal, type Decoded, type Osa } from './terminal';
import { listWindows } from './window-list';

export type ScreenReaderDeps = {
  run: Run;
  osa: Osa;
  decodePng?: (png: Buffer) => Promise<Decoded | null>;
};

export function createScreenReader(deps: ScreenReaderDeps) {
  const readTerminal = createTerminalReader();
  let prev = '';
  let prevBadges: Record<string, string> | null = null;
  return {
    async tick(): Promise<{
      observation: Observation;
      changed: boolean;
      debug: { titlesRedacted: boolean; windowCount: number; terminalKey: string };
    }> {
      const { windows, titlesRedacted } = await listWindows(deps.run);
      const [badges, termRead] = await Promise.all([
        getBadges(deps.run),
        readTerminal({ ...deps, windows }),
      ]);
      // The first read only seeds; a failed read keeps the last good one.
      const badge = badges && prevBadges ? badgeBump(prevBadges, badges) : null;
      if (badges) prevBadges = badges;
      // Titles/bounds of unrelated windows (a browser tab) stay out of the observation.
      const call = windows.filter(
        (w) => ruleDecide({ windows: [w], badge: null, terminalError: null })?.action === 'hide',
      );
      const term = pickTerminal(windows);
      const observation: Observation = {
        windows: [...call, ...(term ? [term] : [])].map(({ owner, title, bounds }) => ({ owner, title, bounds })),
        badge,
        terminalError: termRead.terminalError,
      };
      const sig = JSON.stringify([call.length > 0, badge, termRead.key]);
      const changed = termRead.changed || sig !== prev;
      prev = sig;
      return {
        observation,
        changed,
        debug: { titlesRedacted, windowCount: windows.length, terminalKey: termRead.key },
      };
    },
  };
}
