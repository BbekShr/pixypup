import { describe, expect, it } from 'vitest';
import { matchCommand } from './commands';

describe('matchCommand', () => {
  it('requires the pet name', () => {
    expect(matchCommand('sit', 'Pakkun')).toBeNull();
  });
  it('matches commands case-insensitively', () => {
    expect(matchCommand('PAKKUN, sit!', 'Pakkun')).toBe('sit');
    expect(matchCommand('pakkun roll over', 'Pakkun')).toBe('roll');
    expect(matchCommand('Pakkun go to bed', 'Pakkun')).toBe('bed');
    expect(matchCommand('pakkun come here', 'Pakkun')).toBe('come');
  });
  it('returns null for unknown commands', () => {
    expect(matchCommand('pakkun dance', 'Pakkun')).toBeNull();
  });
});
