import { SIZES, type Energy, type Size } from './prefs';

export type MenuItem =
  | { type: 'separator' }
  | { label: string; command: string; checked?: boolean; radio?: true; enabled?: false }
  | { label: string; quit: true }
  | { label: string; submenu: MenuItem[] };

export interface MenuState { stay: boolean; snoozed: boolean; size: Size; energy: Energy; hideInShares: boolean; hideLocked?: boolean; screenAware: boolean; screenLocked?: boolean; voice: boolean; voiceLocked?: boolean; openAtLogin: boolean; debug?: boolean; overload?: boolean; pets?: { slug: string; name: string }[]; name: string }

const SIZE_LABELS: Record<Size, string> = { small: 'Small', medium: 'Medium', large: 'Large' };
const ENERGY_LABELS: [Energy, string][] = [['sleepy', 'Sleepy'], ['normal', 'Normal'], ['playful', 'Playful']];
const SNOOZE: MenuItem = { label: 'Snooze', submenu: [{ label: 'For 1 hour', command: 'snooze:1h' }, { label: 'Until 8 am', command: 'snooze:tomorrow' }] };
const toggle = (label: string, key: string, on: boolean): MenuItem => ({ label, command: `${key}:${on ? 'off' : 'on'}`, checked: on });
const overloadItem = (running?: boolean): MenuItem => (running ? { label: 'End the overload', command: 'overload:end' } : { label: 'PixyPup Overload!', command: 'overload' });
/** One "Send X home" per pet, only while there is more than one: the last pet can't leave. */
const sendHome = (pets: MenuState['pets']): MenuItem[] => ((pets?.length ?? 0) > 1 ? pets!.map((p) => ({ label: `Send ${p.name} home`, command: `home:${p.slug}` })) : []);
const LOCKED = ' (set by your organisation)';

/** Plain descriptors so the menu is testable without Electron; main.ts maps them to native items. */
export function petMenuTemplate(o: MenuState): MenuItem[] {
  return [
    { label: 'Sit', command: 'sit' },
    { label: 'Bark', command: 'bark' },
    { label: 'Roll over', command: 'roll' },
    { label: 'Nap', command: 'bed' },
    { label: 'Come here', command: 'come' },
    { type: 'separator' },
    o.snoozed ? { label: 'Wake up', command: 'wake' } : SNOOZE,
    { label: 'Size', submenu: (Object.keys(SIZES) as Size[]).map((s) => ({ label: `${SIZE_LABELS[s]} ${SIZES[s]} px`, command: `size:${s}`, checked: o.size === s, radio: true })) },
    { label: 'Energy', submenu: ENERGY_LABELS.map(([e, label]) => ({ label, command: `energy:${e}`, checked: o.energy === e, radio: true })) },
    { type: 'separator' },
    { label: 'Stay here', command: o.stay ? 'wander' : 'stay', checked: o.stay },
    o.hideLocked ? { label: `Hide during screen sharing${LOCKED}`, command: 'hide:off', checked: true, enabled: false } : toggle('Hide during screen sharing', 'hide', o.hideInShares),
    o.screenLocked ? { label: `Notice my screen${LOCKED}`, command: 'screen:off', checked: false, enabled: false } : toggle('Notice my screen', 'screen', o.screenAware),
    o.voiceLocked ? { label: `Listen for my voice${LOCKED}`, command: 'voice:off', checked: false, enabled: false } : toggle('Listen for my voice', 'voice', o.voice),
    toggle(`Show what ${o.name} sees`, 'debug', o.debug ?? false),
    toggle('Open at login', 'login', o.openAtLogin),
    { label: 'Add another pet…', command: 'new-pet' },
    ...sendHome(o.pets),
    overloadItem(o.overload),
    { type: 'separator' },
    { label: 'Quit PixyPup', quit: true },
  ];
}

export const trayMenuTemplate = (o: Pick<MenuState, 'snoozed' | 'name' | 'overload' | 'pets'>): MenuItem[] => [
  o.snoozed ? { label: `Wake up ${o.name}`, command: 'wake' } : SNOOZE,
  overloadItem(o.overload),
  { label: 'Add another pet…', command: 'new-pet' },
  ...sendHome(o.pets),
  { type: 'separator' },
  { label: 'Quit PixyPup', quit: true },
];
