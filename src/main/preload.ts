import { contextBridge, ipcRenderer } from 'electron';

const CH = { setClickThrough: 'pixy:set-click-through', command: 'pixy:command' } as const;

contextBridge.exposeInMainWorld('pixy', {
  setClickThrough: (on: boolean): void => ipcRenderer.send(CH.setClickThrough, on),
  onCommand: (cb: (cmd: string) => void): void => {
    ipcRenderer.on(CH.command, (_e, cmd: string) => cb(cmd));
  },
});
