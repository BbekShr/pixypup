import type { Observation } from './decide';

// TODO(F8): capture terminal window crop in memory, OCR for errors.
export function readTerminalError(): Promise<Observation['terminalError']> {
  throw new Error('not implemented');
}
