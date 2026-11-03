import { MAX_PETS, takenSlug } from './pets';
import { SIZES, type CallMode, type Energy, type Size } from './prefs';

export type MenuItem =
  | { type: 'separator' }
  | { label: string; command: string; checked?: boolean; radio?: true; enabled?: false }
  | { label: string; quit: true }
  | { label: string; submenu: MenuItem[] };

export interface MenuState { stay: boolean; snoozed: boolean; size: Size; energy: Energy; hideInShares: boolean; hideLocked?: boolean; callMode: CallMode; screenAware: boolean; screenLocked?: boolean; voice: boolean; voiceLocked?: boolean; openAtLogin: boolean; debug?: boolean; overload?: boolean; pets?: { slug: string; name: string }[]; library?: { slug: string; name: string }[]; name: string; hasKey?: boolean; self?: { slug: string; name: string } }

const SIZE_LABELS: Record<Size, string> = { small: 'Small', medium: 'Medium', large: 'Large' };
const ENERGY_LABELS: [Energy, string][] = [['sleepy', 'Sleepy'], ['normal', 'Normal'], ['playful', 'Playful']];
const SNOOZE: MenuItem = { label: '💤 Snooze', submenu: [{ label: 'For 1 hour', command: 'snooze:1h' }, { label: 'Until 8 am', command: 'snooze:tomorrow' }] };
const toggle = (label: string, key: string, on: boolean): MenuItem => ({ label, command: `${key}:${on ? 'off' : 'on'}`, checked: on });
const overloadItem = (running?: boolean): MenuItem => (running ? { label: '🎉 End the overload', command: 'overload:end' } : { label: '🎉 PixyPup Overload!', command: 'overload' });
/** One "Send X home" per pet, only while there is more than one: the last pet can't leave. */
const sendHome = (pets: MenuState['pets']): MenuItem[] => ((pets?.length ?? 0) > 1 ? pets!.map((p) => ({ label: `Send ${p.name} home`, command: `home:${p.slug}` })) : []);
/** Bundled pets not already on screen; disabled at the cap. Omitted when main passed no library. */
const libraryMenu = (o: Pick<MenuState, 'pets' | 'library'>): MenuItem[] => {
  if (!o.library) return [];
  const on = (o.pets ?? []).map((p) => p.slug);
  const full = on.length >= MAX_PETS;
  const items: MenuItem[] = o.library.filter((l) => !takenSlug(on, l.slug)).map((l) => ({ label: l.name, command: `library:${l.slug}`, ...(full && { enabled: false as const }) }));
  return [{ label: 'Pet library', submenu: items.length ? items : [{ label: "Everyone's here", command: 'library:none', enabled: false }] }];
};
const talkItem = (name: string): MenuItem => ({ label: `💬 Talk to ${name}…`, command: 'talk' });
/** Tucked near the bottom: the key is optional, but it unlocks talk, hints, voice and new pets. */
const keyItem = (has?: boolean): MenuItem => ({ label: has ? 'Change Meta key…' : 'Add Meta key for the full experience…', command: 'key' });
const LOCKED = ' (set by your organisation)';

/** Plain descriptors so the menu is testable without Electron; main.ts maps them to native items. */
export function petMenuTemplate(o: MenuState): MenuItem[] {
  const lock = (label: string, command: string, checked: boolean): MenuItem => ({ label: `${label}${LOCKED}`, command, checked, enabled: false });
  return [
    { label: '🎾 Tricks', submenu: [
      { label: 'Sit', command: 'sit' },
      { label: 'Bark', command: 'bark' },
      { label: 'Roll over', command: 'roll' },
      { label: 'Nap', command: 'bed' },
      { type: 'separator' },
      { label: 'Do a trick', command: 'trick' },
      { label: 'Zoomies!', command: 'zoomies' },
    ] },
    { label: '👋 Come here', command: 'come' },
    talkItem(o.name),
    overloadItem(o.overload),
    { type: 'separator' },
    o.snoozed ? { label: '☀️ Wake up', command: 'wake' } : SNOOZE,
    { label: '📌 Stay here', command: o.stay ? 'wander' : 'stay', checked: o.stay },
    { label: '🐾 Pets', submenu: [
      { label: 'Add another pet…', command: 'new-pet' },
      ...(o.self ? [{ label: `Rename ${o.self.name}…`, command: `rename:${o.self.slug}` }] : []),
      ...libraryMenu(o),
      ...sendHome(o.pets),
    ] },
    { label: '⚙️ Settings', submenu: [
      { label: 'Size', submenu: (Object.keys(SIZES) as Size[]).map((s) => ({ label: `${SIZE_LABELS[s]} ${SIZES[s]} px`, command: `size:${s}`, checked: o.size === s, radio: true })) },
      { label: 'Energy', submenu: ENERGY_LABELS.map(([e, label]) => ({ label, command: `energy:${e}`, checked: o.energy === e, radio: true })) },
      { type: 'separator' },
      o.screenLocked ? lock('Notice my screen', 'screen:off', false) : toggle('Notice my screen', 'screen', o.screenAware),
      { label: 'During calls', submenu: [{ label: 'Hide', command: 'call:hide', checked: o.callMode === 'hide', radio: true }, { label: 'Stay in the corner', command: 'call:corner', checked: o.callMode === 'corner', radio: true }] },
      o.voiceLocked ? lock('Listen for my voice', 'voice:off', false) : toggle('Listen for my voice', 'voice', o.voice),
      o.hideLocked ? lock('Hide during screen sharing', 'hide:off', true) : toggle('Hide during screen sharing', 'hide', o.hideInShares),
      toggle(`Show what ${o.name} sees`, 'debug', o.debug ?? false),
      toggle('Open at login', 'login', o.openAtLogin),
      { type: 'separator' },
      keyItem(o.hasKey),
    ] },
    { type: 'separator' },
    { label: 'Quit PixyPup', quit: true },
  ];
}

export const trayMenuTemplate = (o: Pick<MenuState, 'snoozed' | 'name' | 'overload' | 'pets' | 'library' | 'hasKey'>): MenuItem[] => [
  talkItem(o.name),
  o.snoozed ? { label: `☀️ Wake up ${o.name}`, command: 'wake' } : SNOOZE,
  overloadItem(o.overload),
  { label: 'Add another pet…', command: 'new-pet' },
  ...libraryMenu(o),
  ...sendHome(o.pets),
  keyItem(o.hasKey),
  { type: 'separator' },
  { label: 'Quit PixyPup', quit: true },
];
