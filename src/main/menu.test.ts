import { describe, expect, it } from 'vitest';
import { petMenuTemplate, trayMenuTemplate, type MenuItem, type MenuState } from './menu';

const base: MenuState = { stay: false, snoozed: false, size: 'medium', energy: 'normal', hideInShares: false, callMode: 'hide', screenAware: false, voice: false, openAtLogin: false, name: 'Pakkun' };
const labels = (t: MenuItem[]): string[] => t.map((i) => ('type' in i ? '-' : i.label));
const flat = (t: MenuItem[]): MenuItem[] => t.flatMap((i) => ('submenu' in i ? [i, ...flat(i.submenu)] : [i]));
const find = (t: MenuItem[], l: string): MenuItem | undefined => flat(t).find((i) => 'label' in i && i.label === l);
const sub = (t: MenuItem[], label: string): MenuItem[] => {
  const m = flat(t).find((i) => 'submenu' in i && i.label === label);
  return m && 'submenu' in m ? m.submenu : [];
};

describe('petMenuTemplate', () => {
  it('has the agreed top level, short, with Quit last', () => {
    const t = petMenuTemplate(base);
    expect(labels(t)).toEqual(['🎾 Tricks', '👋 Come here', '💬 Talk to Pakkun…', '🎉 PixyPup Overload!', '-', '💤 Snooze', '📌 Stay here', '🐾 Pets', '⚙️ Settings', '-', 'Quit PixyPup']);
    expect(t.length).toBeLessThanOrEqual(11);
    expect(t.at(-1)).toEqual({ label: 'Quit PixyPup', quit: true });
  });
  it('every command the long menu had is still reachable', () => {
    const t = petMenuTemplate({ ...base, library: [{ slug: 'Mochi', name: 'Mochi' }], pets: [{ slug: 'a', name: 'A' }, { slug: 'b', name: 'B' }] });
    const cmds = flat(t).flatMap((i) => ('command' in i ? [i.command] : []));
    for (const c of ['sit', 'bark', 'roll', 'bed', 'come', 'trick', 'zoomies', 'talk', 'snooze:1h', 'snooze:tomorrow', 'stay', 'size:small', 'size:medium', 'size:large', 'energy:sleepy', 'energy:normal', 'energy:playful', 'hide:on', 'screen:on', 'voice:on', 'debug:on', 'login:on', 'call:hide', 'call:corner', 'key', 'new-pet', 'library:Mochi', 'home:a', 'home:b', 'overload']) expect(cmds).toContain(c);
    expect(flat(petMenuTemplate({ ...base, snoozed: true })).some((i) => 'command' in i && i.command === 'wake')).toBe(true);
  });
  it('Rename names the pet whose menu it is, inside 🐾 Pets, and only when main says which pet', () => {
    const t = petMenuTemplate({ ...base, self: { slug: 'milo', name: 'Biscuit' } });
    expect(sub(t, '🐾 Pets')).toContainEqual({ label: 'Rename Biscuit…', command: 'rename:milo' });
    expect(flat(petMenuTemplate(base)).some((i) => 'command' in i && i.command.startsWith('rename:'))).toBe(false);
  });
  it('During calls radio follows callMode', () => {
    const radio = (m: 'hide' | 'corner') => sub(petMenuTemplate({ ...base, callMode: m }).flatMap((i) => ('submenu' in i && i.label === '⚙️ Settings' ? i.submenu : [])), 'During calls').flatMap((i) => ('checked' in i && i.checked ? [i.label] : []));
    expect(radio('hide')).toEqual(['Hide']);
    expect(radio('corner')).toEqual(['Stay in the corner']);
  });
  it('maps the tricks to overlay command strings', () => {
    expect(sub(petMenuTemplate(base), '🎾 Tricks').flatMap((i) => ('command' in i ? [[i.label, i.command]] : []))).toEqual([['Sit', 'sit'], ['Bark', 'bark'], ['Roll over', 'roll'], ['Nap', 'bed'], ['Do a trick', 'trick'], ['Zoomies!', 'zoomies']]);
    const tray = labels(trayMenuTemplate(base));
    expect(tray).not.toContain('Do a trick');
    expect(tray).not.toContain('Zoomies!');
  });
  it('the Meta key item invites a key until one is saved, then offers to change it, in both menus', () => {
    for (const make of [petMenuTemplate, trayMenuTemplate]) {
      expect(find(make(base), 'Add Meta key for the full experience…')).toEqual({ label: 'Add Meta key for the full experience…', command: 'key' });
      expect(find(make({ ...base, hasKey: true }), 'Change Meta key…')).toEqual({ label: 'Change Meta key…', command: 'key' });
    }
  });
  it('Talk to <name> sends the talk command from both menus', () => {
    expect(find(petMenuTemplate(base), '💬 Talk to Pakkun…')).toEqual({ label: '💬 Talk to Pakkun…', command: 'talk' });
    expect(find(trayMenuTemplate(base), '💬 Talk to Pakkun…')).toEqual({ label: '💬 Talk to Pakkun…', command: 'talk' });
  });
  it('the stay checkbox reflects state and toggles back to wander', () => {
    expect(find(petMenuTemplate({ ...base, stay: true }), '📌 Stay here')).toEqual({ label: '📌 Stay here', command: 'wander', checked: true });
    expect(find(petMenuTemplate(base), '📌 Stay here')).toMatchObject({ checked: false, command: 'stay' });
  });
  it('snooze submenu offers 1 hour and tomorrow', () => {
    expect(sub(petMenuTemplate(base), '💤 Snooze')).toEqual([{ label: 'For 1 hour', command: 'snooze:1h' }, { label: 'Until 8 am', command: 'snooze:tomorrow' }]);
  });
  it('size and energy are radios with exactly the current one checked', () => {
    const t = petMenuTemplate({ ...base, size: 'large', energy: 'sleepy' });
    expect(sub(t, 'Size').map((i) => 'label' in i && [i.label, 'checked' in i && i.checked, 'radio' in i && i.radio])).toEqual([['Small 110 px', false, true], ['Medium 140 px', false, true], ['Large 180 px', true, true]]);
    expect(sub(t, 'Energy').map((i) => 'command' in i && [i.command, i.checked])).toEqual([['energy:sleepy', true], ['energy:normal', false], ['energy:playful', false]]);
  });
  it('hide and login are checkboxes that toggle', () => {
    expect(find(petMenuTemplate(base), 'Hide during screen sharing')).toEqual({ label: 'Hide during screen sharing', command: 'hide:on', checked: false });
    expect(find(petMenuTemplate({ ...base, hideInShares: true, openAtLogin: true }), 'Hide during screen sharing')).toMatchObject({ command: 'hide:off', checked: true });
    expect(find(petMenuTemplate({ ...base, openAtLogin: true }), 'Open at login')).toMatchObject({ command: 'login:off', checked: true });
  });
  it('notice-my-screen is an off-by-default checkbox; turning it on goes through the explainer command', () => {
    expect(find(petMenuTemplate(base), 'Notice my screen')).toEqual({ label: 'Notice my screen', command: 'screen:on', checked: false });
    expect(find(petMenuTemplate({ ...base, screenAware: true }), 'Notice my screen')).toMatchObject({ command: 'screen:off', checked: true });
  });
  it('show-what-it-sees is an unchecked checkbox named after the pet', () => {
    expect(find(petMenuTemplate(base), 'Show what Pakkun sees')).toEqual({ label: 'Show what Pakkun sees', command: 'debug:on', checked: false });
    expect(find(petMenuTemplate({ ...base, debug: true }), 'Show what Pakkun sees')).toMatchObject({ command: 'debug:off', checked: true });
  });
  it('an admin-locked notice-my-screen item is unchecked, disabled and says why', () => {
    expect(find(petMenuTemplate({ ...base, screenAware: true, screenLocked: true }), 'Notice my screen (set by your organisation)')).toEqual({ label: 'Notice my screen (set by your organisation)', command: 'screen:off', checked: false, enabled: false });
  });
  it('listen-for-my-voice is an off-by-default checkbox whose on goes through the explainer; admin lock disables it', () => {
    expect(find(petMenuTemplate(base), 'Listen for my voice')).toEqual({ label: 'Listen for my voice', command: 'voice:on', checked: false });
    expect(find(petMenuTemplate({ ...base, voice: true }), 'Listen for my voice')).toMatchObject({ command: 'voice:off', checked: true });
    expect(find(petMenuTemplate({ ...base, voice: true, voiceLocked: true }), 'Listen for my voice (set by your organisation)')).toEqual({ label: 'Listen for my voice (set by your organisation)', command: 'voice:off', checked: false, enabled: false });
  });
  it('an admin-locked hide item is a checked, disabled entry that says why', () => {
    const t = petMenuTemplate({ ...base, hideInShares: true, hideLocked: true });
    expect(flat(t).find((i) => 'label' in i && i.label.startsWith('Hide during'))).toEqual({ label: 'Hide during screen sharing (set by your organisation)', command: 'hide:off', checked: true, enabled: false });
  });
  it('while snoozed the Snooze submenu is replaced by Wake up', () => {
    const t = petMenuTemplate({ ...base, snoozed: true });
    expect(labels(t)).not.toContain('💤 Snooze');
    expect(find(t, '☀️ Wake up')).toEqual({ label: '☀️ Wake up', command: 'wake' });
  });
});

describe('trayMenuTemplate', () => {
  it('is Talk, Snooze, new pet, Quit; snoozed it says Wake up <name>', () => {
    expect(labels(trayMenuTemplate(base))).toEqual(['💬 Talk to Pakkun…', '💤 Snooze', '🎉 PixyPup Overload!', 'Add another pet…', 'Add Meta key for the full experience…', '-', 'Quit PixyPup']);
    expect(trayMenuTemplate({ snoozed: true, name: 'Rex' })[1]).toEqual({ label: '☀️ Wake up Rex', command: 'wake' });
  });
  it('both menus offer the overload, and the tray swaps it for End while it runs', () => {
    expect(find(petMenuTemplate(base), '🎉 PixyPup Overload!')).toEqual({ label: '🎉 PixyPup Overload!', command: 'overload' });
    expect(find(trayMenuTemplate(base), '🎉 PixyPup Overload!')).toEqual({ label: '🎉 PixyPup Overload!', command: 'overload' });
    const running = trayMenuTemplate({ ...base, overload: true });
    expect(find(running, '🎉 End the overload')).toEqual({ label: '🎉 End the overload', command: 'overload:end' });
    expect(find(running, '🎉 PixyPup Overload!')).toBeUndefined();
  });
  it('offers "Send <name> home" per pet only when there is more than one', () => {
    const pets = [{ slug: 'pakkun', name: 'Pakkun' }, { slug: 'milo', name: 'Milo' }];
    expect(find(petMenuTemplate({ ...base, pets }), 'Send Milo home')).toEqual({ label: 'Send Milo home', command: 'home:milo' });
    expect(find(trayMenuTemplate({ ...base, pets }), 'Send Pakkun home')).toEqual({ label: 'Send Pakkun home', command: 'home:pakkun' });
    expect(labels(flat(petMenuTemplate({ ...base, pets: pets.slice(0, 1) }))).some((l) => l.startsWith('Send'))).toBe(false);
    expect(labels(flat(petMenuTemplate(base))).some((l) => l.startsWith('Send'))).toBe(false);
  });
});

describe('Pet library submenu', () => {
  const library = [{ slug: 'Mochi', name: 'Mochi' }, { slug: 'Kuma', name: 'Kuma' }, { slug: 'Pakkun', name: 'Pakkun' }];
  const pets = [{ slug: 'pakkun', name: 'Pakkun' }];
  it('follows Add another pet… in both menus and lists pets not on screen, skipping taken slugs case-insensitively', () => {
    const want = [{ label: 'Mochi', command: 'library:Mochi' }, { label: 'Kuma', command: 'library:Kuma' }];
    for (const t of [petMenuTemplate({ ...base, pets, library }), trayMenuTemplate({ ...base, pets, library })]) {
      const i = labels(flat(t)).indexOf('Add another pet…');
      expect(labels(flat(t))[i + 1]).toBe('Pet library');
      expect(sub(t, 'Pet library')).toEqual(want);
    }
  });
  it('disables every item at MAX_PETS', () => {
    const four = ['a', 'b', 'c', 'd'].map((s) => ({ slug: s, name: s }));
    for (const t of [petMenuTemplate({ ...base, pets: four, library }), trayMenuTemplate({ ...base, pets: four, library })]) {
      const items = sub(t, 'Pet library');
      expect(items).toHaveLength(3);
      expect(items.every((i) => 'enabled' in i && i.enabled === false)).toBe(true);
    }
  });
  it('says Everyone\'s here (disabled) when all are on screen', () => {
    const all = library.map((l) => ({ slug: l.slug.toLowerCase(), name: l.name }));
    expect(sub(petMenuTemplate({ ...base, pets: all, library }), 'Pet library')).toEqual([{ label: "Everyone's here", command: 'library:none', enabled: false }]);
  });
});
