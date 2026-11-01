import { SIZES, type Energy, type Size } from './prefs';

export type MenuItem =
  | { type: 'separator' }
  | { label: string; command: string; checked?: boolean; radio?: true; enabled?: false }
  | { label: string; quit: true }
  | { label: string; submenu: MenuItem[] };

export interface MenuState { stay: boolean; snoozed: boolean; size: Size; energy: Energy; hideInShares: boolean; hideLocked?: boolean; openAtLogin: boolean; name: string }

const SIZE_LABELS: Record<Size, string> = { small: 'Small', medium: 'Medium', large: 'Large' };
const ENERGY_LABELS: [Energy, string][] = [['sleepy', 'Sleepy'], ['normal', 'Normal'], ['playful', 'Playful']];
const SNOOZE: MenuItem = { label: 'Snooze', submenu: [{ label: 'For 1 hour', command: 'snooze:1h' }, { label: 'Until 8 am', command: 'snooze:tomorrow' }] };
const toggle = (label: string, key: string, on: boolean): MenuItem => ({ label, command: `${key}:${on ? 'off' : 'on'}`, checked: on });
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
    toggle('Open at login', 'login', o.openAtLogin),
    { label: 'Make a new pet…', command: 'new-pet' },
    { type: 'separator' },
    { label: 'Quit PixyPup', quit: true },
  ];
}

export const trayMenuTemplate = (o: Pick<MenuState, 'snoozed' | 'name'>): MenuItem[] => [
  o.snoozed ? { label: `Wake up ${o.name}`, command: 'wake' } : SNOOZE,
  { label: 'Make a new pet…', command: 'new-pet' },
  { type: 'separator' },
  { label: 'Quit PixyPup', quit: true },
];
