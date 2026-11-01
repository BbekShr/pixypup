import { describe, expect, it } from 'vitest';
import { petMenuTemplate } from './menu';

describe('petMenuTemplate', () => {
  it('maps the tricks to the overlay command strings and ends with Quit', () => {
    const t = petMenuTemplate({ stay: false });
    const cmds = t.flatMap((i) => ('command' in i ? [[i.label, i.command]] : []));
    expect(cmds).toEqual([['Sit', 'sit'], ['Bark', 'bark'], ['Roll over', 'roll'], ['Nap', 'bed'], ['Come here', 'come'], ['Stay here', 'stay'], ['Make a new pet…', 'new-pet']]);
    expect(t.at(-1)).toEqual({ label: 'Quit PixyPup', quit: true });
    expect(t.filter((i) => 'type' in i)).toHaveLength(2);
  });
  it('the stay checkbox reflects state and toggles back to wander', () => {
    const stay = petMenuTemplate({ stay: true }).find((i) => 'checked' in i);
    expect(stay).toEqual({ label: 'Stay here', command: 'wander', checked: true });
    expect(petMenuTemplate({ stay: false }).find((i) => 'checked' in i)).toMatchObject({ checked: false, command: 'stay' });
  });
});
