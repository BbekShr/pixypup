import { contextBridge, ipcRenderer } from 'electron';

const CH = { setClickThrough: 'pixy:set-click-through', command: 'pixy:command', getPack: 'pixy:get-pack', showMenu: 'pixy:show-menu', getStay: 'pixy:get-stay', packChanged: 'pixy:pack-changed', getPrefs: 'pixy:get-prefs', prefs: 'pixy:prefs', devCmd: 'pixy:dev-cmd', behavior: 'pixy:behavior' } as const;

contextBridge.exposeInMainWorld('pixy', {
  setClickThrough: (on: boolean): void => ipcRenderer.send(CH.setClickThrough, on),
  showMenu: (): void => ipcRenderer.send(CH.showMenu),
  getStay: (): Promise<boolean> => ipcRenderer.invoke(CH.getStay),
  getPrefs: (): Promise<unknown> => ipcRenderer.invoke(CH.getPrefs),
  onPrefs: (cb: (p: unknown) => void): void => {
    ipcRenderer.on(CH.prefs, (_e, p: unknown) => cb(p));
  },
  devCommand: (cmd: string): void => ipcRenderer.send(CH.devCmd, cmd), // main ignores it in a packaged app
  getPack: (): Promise<unknown> => ipcRenderer.invoke(CH.getPack),
  onPackChanged: (cb: (h: { x?: number }) => void): void => {
    ipcRenderer.on(CH.packChanged, (_e, h: { x?: number }) => cb(h ?? {}));
  },
  onBehavior: (cb: (b: unknown) => void): void => {
    ipcRenderer.on(CH.behavior, (_e, b: unknown) => cb(b));
  },
  onCommand: (cb: (cmd: string) => void): void => {
    ipcRenderer.on(CH.command, (_e, cmd: string) => cb(cmd));
  },
});
