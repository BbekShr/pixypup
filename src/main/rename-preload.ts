import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('pixyRename', {
  info: (): Promise<unknown> => ipcRenderer.invoke('pixy:rename-info'),
  save: (name: string): Promise<unknown> => ipcRenderer.invoke('pixy:rename-save', String(name)),
  close: (): void => ipcRenderer.send('pixy:rename-close'),
});
