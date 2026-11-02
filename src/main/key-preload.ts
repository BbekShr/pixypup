import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('pixyKey', {
  info: (): Promise<unknown> => ipcRenderer.invoke('pixy:key-info'),
  save: (key: string): Promise<unknown> => ipcRenderer.invoke('pixy:key-save', String(key)),
  openKeyPage: (): void => ipcRenderer.send('pixy:key-open-page'),
  close: (): void => ipcRenderer.send('pixy:key-close'),
});
