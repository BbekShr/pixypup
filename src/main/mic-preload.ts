import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('pixyMic', {
  onStart: (cb: (fake?: ArrayBuffer) => void): void => { ipcRenderer.on('pixy:mic-start', (_e, fake?: ArrayBuffer) => cb(fake)); },
  onStop: (cb: () => void): void => { ipcRenderer.on('pixy:mic-stop', () => cb()); },
  chunk: (b: ArrayBuffer): void => ipcRenderer.send('pixy:mic-chunk', b),
});
