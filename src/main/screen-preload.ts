import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('pixyScreen', {
  answer: (yes: boolean): void => ipcRenderer.send('pixy:screen-answer', yes === true),
});
