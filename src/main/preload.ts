import { contextBridge, ipcRenderer } from 'electron';

const CH = { setClickThrough: 'pixy:set-click-through', command: 'pixy:command', getPack: 'pixy:get-pack', showMenu: 'pixy:show-menu' } as const;

contextBridge.exposeInMainWorld('pixy', {
  setClickThrough: (on: boolean): void => ipcRenderer.send(CH.setClickThrough, on),
  showMenu: (): void => ipcRenderer.send(CH.showMenu),
  getPack: (): Promise<unknown> => ipcRenderer.invoke(CH.getPack),
  onCommand: (cb: (cmd: string) => void): void => {
    ipcRenderer.on(CH.command, (_e, cmd: string) => cb(cmd));
  },
});
