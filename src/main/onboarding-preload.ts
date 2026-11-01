import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC } from './ipc';

export type Progress = { kind: 'cutout' | 'pose'; name: string; url: string };
export type PhotoResult = { ok: true; thumb: string } | { ok: false; code: 'missing' | 'type' | 'size' | 'unreadable' | 'cancelled' };
export type CreateResult = { ok: true; name: string } | { ok: false; code: 'bad-key' | 'no-pet-found' | 'network' | 'generation-failed' };

// Narrow on purpose: no paths from the page except a dropped File (main re-validates), no raw errors back.
contextBridge.exposeInMainWorld('pixyOb', {
  state: (): Promise<{ needsKey: boolean }> => ipcRenderer.invoke(IPC.obState),
  pickPhoto: (): Promise<PhotoResult> => ipcRenderer.invoke(IPC.obPickPhoto),
  dropPhoto: (file: File): Promise<PhotoResult> => ipcRenderer.invoke(IPC.obDropPhoto, webUtils.getPathForFile(file)),
  devPhoto: (): Promise<PhotoResult> => ipcRenderer.invoke(IPC.obDevPhoto),
  saveKey: (key: string): Promise<boolean> => ipcRenderer.invoke(IPC.obSaveKey, key),
  openKeyPage: (): void => ipcRenderer.send(IPC.obOpenKeyPage),
  createPet: (name: string, species: 'dog' | 'cat'): Promise<CreateResult> => ipcRenderer.invoke(IPC.createPet, { name, species }),
  onProgress: (cb: (p: Progress) => void): void => {
    ipcRenderer.on(IPC.obProgress, (_e, p: Progress) => cb(p));
  },
  keep: (): void => ipcRenderer.send(IPC.obKeep),
  close: (): void => ipcRenderer.send(IPC.obClose),
});
