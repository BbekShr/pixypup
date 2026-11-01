export type MenuItem =
  | { type: 'separator' }
  | { label: string; command: string; checked?: boolean }
  | { label: string; quit: true };

/** Plain descriptors so the menu is testable without Electron; main.ts maps them to native items. */
export function petMenuTemplate(o: { stay: boolean }): MenuItem[] {
  return [
    { label: 'Sit', command: 'sit' },
    { label: 'Bark', command: 'bark' },
    { label: 'Roll over', command: 'roll' },
    { label: 'Nap', command: 'bed' },
    { label: 'Come here', command: 'come' },
    { type: 'separator' },
    { label: 'Stay here', command: o.stay ? 'wander' : 'stay', checked: o.stay },
    { label: 'Make a new pet…', command: 'new-pet' },
    { type: 'separator' },
    { label: 'Quit PixyPup', quit: true },
  ];
}
