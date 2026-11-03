import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('pixyTalk', {
  send: (text: string): Promise<unknown> => ipcRenderer.invoke('pixy:talk-send', String(text)),
  info: (): Promise<unknown> => ipcRenderer.invoke('pixy:talk-info'),
  openKey: (): void => ipcRenderer.send('pixy:talk-open-key'),
  close: (): void => ipcRenderer.send('pixy:talk-close'),
  onPrefill: (cb: (text: unknown) => void): void => { ipcRenderer.on('pixy:talk-prefill', (_e, text: unknown) => cb(text)); },
});
