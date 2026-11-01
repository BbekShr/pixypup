import { contextBridge, ipcRenderer } from 'electron';

const CH = { setClickThrough: 'pixy:set-click-through', command: 'pixy:command', getPack: 'pixy:get-pack', showMenu: 'pixy:show-menu', getStay: 'pixy:get-stay', packChanged: 'pixy:pack-changed' } as const;

contextBridge.exposeInMainWorld('pixy', {
  setClickThrough: (on: boolean): void => ipcRenderer.send(CH.setClickThrough, on),
  showMenu: (): void => ipcRenderer.send(CH.showMenu),
  getStay: (): Promise<boolean> => ipcRenderer.invoke(CH.getStay),
  getPack: (): Promise<unknown> => ipcRenderer.invoke(CH.getPack),
  onPackChanged: (cb: (h: { x?: number }) => void): void => {
    ipcRenderer.on(CH.packChanged, (_e, h: { x?: number }) => cb(h ?? {}));
  },
  onCommand: (cb: (cmd: string) => void): void => {
    ipcRenderer.on(CH.command, (_e, cmd: string) => cb(cmd));
  },
});
