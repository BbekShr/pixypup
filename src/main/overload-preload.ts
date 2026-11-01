import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('pixyOverload', {
  onStart: (cb: (p: unknown) => void): void => { ipcRenderer.on('pixy:overload-start', (_e, p: unknown) => cb(p)); },
  onCursor: (cb: (c: { x: number; y: number }) => void): void => { ipcRenderer.on('pixy:overload-cursor', (_e, c: { x: number; y: number }) => cb(c)); },
  done: (): void => ipcRenderer.send('pixy:overload-done'),
});
