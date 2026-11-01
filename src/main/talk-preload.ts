import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('pixyTalk', {
  send: (text: string): Promise<unknown> => ipcRenderer.invoke('pixy:talk-send', String(text)),
  info: (): Promise<unknown> => ipcRenderer.invoke('pixy:talk-info'),
  close: (): void => ipcRenderer.send('pixy:talk-close'),
  onShow: (cb: (m: unknown) => void): void => { ipcRenderer.on('pixy:talk-show', (_e, m: unknown) => cb(m)); },
});
