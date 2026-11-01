import type { Observation } from './decide';
import { getSlackBadge } from './dock-badge';
import type { Run } from './helper';
import { createTerminalReader, type Decoded, type Osa } from './terminal';
import { listWindows } from './window-list';

export type ScreenReaderDeps = {
  run: Run;
  osa: Osa;
  decodePng?: (png: Buffer) => Promise<Decoded | null>;
};

export function createScreenReader(deps: ScreenReaderDeps) {
  const readTerminal = createTerminalReader();
  let prev = '';
  return {
    async tick(): Promise<{
      observation: Observation;
      changed: boolean;
      debug: { titlesRedacted: boolean; windowCount: number; terminalKey: string };
    }> {
      const { windows, titlesRedacted } = await listWindows(deps.run);
      const [slackBadge, term] = await Promise.all([
        getSlackBadge(deps.run),
        readTerminal({ ...deps, windows }),
      ]);
      const observation: Observation = {
        windows: windows.map(({ owner, title, bounds }) => ({ owner, title, bounds })),
        slackBadge,
        terminalError: term.terminalError,
      };
      const sig = JSON.stringify([observation.windows, slackBadge, term.key]);
      const changed = term.changed || sig !== prev;
      prev = sig;
      return {
        observation,
        changed,
        debug: { titlesRedacted, windowCount: windows.length, terminalKey: term.key },
      };
    },
  };
}
