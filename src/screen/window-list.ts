import type { Observation } from './decide';

// TODO(F7): shell out to native/bin/pixyhelper windows.
export function listWindows(): Promise<Observation['windows']> {
  throw new Error('not implemented');
}
