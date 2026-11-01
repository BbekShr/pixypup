import { describe, expect, it } from 'vitest';
import { petMenuTemplate, trayMenuTemplate, type MenuItem, type MenuState } from './menu';

const base: MenuState = { stay: false, snoozed: false, size: 'medium', energy: 'normal', hideInShares: false, openAtLogin: false, name: 'Pakkun' };
const labels = (t: MenuItem[]): string[] => t.map((i) => ('type' in i ? '-' : i.label));
const sub = (t: MenuItem[], label: string): MenuItem[] => {
  const m = t.find((i) => 'submenu' in i && i.label === label);
  return m && 'submenu' in m ? m.submenu : [];
};

describe('petMenuTemplate', () => {
  it('has the agreed order, tricks first and Quit last', () => {
    expect(labels(petMenuTemplate(base))).toEqual(['Sit', 'Bark', 'Roll over', 'Nap', 'Come here', '-', 'Snooze', 'Size', 'Energy', '-', 'Stay here', 'Hide during screen sharing', 'Open at login', 'Make a new pet…', '-', 'Quit PixyPup']);
    expect(petMenuTemplate(base).at(-1)).toEqual({ label: 'Quit PixyPup', quit: true });
  });
  it('maps the tricks to overlay command strings', () => {
    const cmds = petMenuTemplate(base).flatMap((i) => ('command' in i ? [[i.label, i.command]] : []));
    expect(cmds.slice(0, 5)).toEqual([['Sit', 'sit'], ['Bark', 'bark'], ['Roll over', 'roll'], ['Nap', 'bed'], ['Come here', 'come']]);
  });
  it('the stay checkbox reflects state and toggles back to wander', () => {
    expect(petMenuTemplate({ ...base, stay: true }).find((i) => 'label' in i && i.label === 'Stay here')).toEqual({ label: 'Stay here', command: 'wander', checked: true });
    expect(petMenuTemplate(base).find((i) => 'label' in i && i.label === 'Stay here')).toMatchObject({ checked: false, command: 'stay' });
  });
  it('snooze submenu offers 1 hour and tomorrow', () => {
    expect(sub(petMenuTemplate(base), 'Snooze')).toEqual([{ label: 'For 1 hour', command: 'snooze:1h' }, { label: 'Until 8 am', command: 'snooze:tomorrow' }]);
  });
  it('size and energy are radios with exactly the current one checked', () => {
    const t = petMenuTemplate({ ...base, size: 'large', energy: 'sleepy' });
    expect(sub(t, 'Size').map((i) => 'label' in i && [i.label, 'checked' in i && i.checked, 'radio' in i && i.radio])).toEqual([['Small 110 px', false, true], ['Medium 140 px', false, true], ['Large 180 px', true, true]]);
    expect(sub(t, 'Energy').map((i) => 'command' in i && [i.command, i.checked])).toEqual([['energy:sleepy', true], ['energy:normal', false], ['energy:playful', false]]);
  });
  it('hide and login are checkboxes that toggle', () => {
    const find = (t: MenuItem[], l: string): MenuItem | undefined => t.find((i) => 'label' in i && i.label === l);
    expect(find(petMenuTemplate(base), 'Hide during screen sharing')).toEqual({ label: 'Hide during screen sharing', command: 'hide:on', checked: false });
    expect(find(petMenuTemplate({ ...base, hideInShares: true, openAtLogin: true }), 'Hide during screen sharing')).toMatchObject({ command: 'hide:off', checked: true });
    expect(find(petMenuTemplate({ ...base, openAtLogin: true }), 'Open at login')).toMatchObject({ command: 'login:off', checked: true });
  });
  it('an admin-locked hide item is a checked, disabled entry that says why', () => {
    const t = petMenuTemplate({ ...base, hideInShares: true, hideLocked: true });
    expect(t.find((i) => 'label' in i && i.label.startsWith('Hide'))).toEqual({ label: 'Hide during screen sharing (set by your organisation)', command: 'hide:off', checked: true, enabled: false });
  });
  it('while snoozed the Snooze submenu is replaced by Wake up', () => {
    const t = petMenuTemplate({ ...base, snoozed: true });
    expect(labels(t)).toContain('Wake up');
    expect(labels(t)).not.toContain('Snooze');
    expect(t.find((i) => 'label' in i && i.label === 'Wake up')).toEqual({ label: 'Wake up', command: 'wake' });
  });
});

describe('trayMenuTemplate', () => {
  it('is Snooze, new pet, Quit; snoozed it says Wake up <name>', () => {
    expect(labels(trayMenuTemplate(base))).toEqual(['Snooze', 'Make a new pet…', '-', 'Quit PixyPup']);
    expect(trayMenuTemplate({ snoozed: true, name: 'Rex' })[0]).toEqual({ label: 'Wake up Rex', command: 'wake' });
  });
});
