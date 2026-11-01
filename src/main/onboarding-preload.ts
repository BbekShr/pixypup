import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC } from './ipc';
import type { Progress, Run } from './run-state';

export type { Progress };
export type PhotoResult = { ok: true; thumb: string } | { ok: false; code: 'missing' | 'type' | 'size' | 'unreadable' | 'cancelled' };
export type CreateResult = { ok: true; name: string } | { ok: false; code: 'bad-key' | 'no-pet-found' | 'network' | 'generation-failed' | 'busy' };

// Narrow on purpose: no paths from the page except a dropped File (main re-validates), no raw errors back.
contextBridge.exposeInMainWorld('pixyOb', {
  state: (): Promise<{ needsKey: boolean; running: Run | null }> => ipcRenderer.invoke(IPC.obState),
  pickPhoto: (): Promise<PhotoResult> => ipcRenderer.invoke(IPC.obPickPhoto),
  dropPhoto: (file: File): Promise<PhotoResult> => ipcRenderer.invoke(IPC.obDropPhoto, webUtils.getPathForFile(file)),
  devPhoto: (): Promise<PhotoResult> => ipcRenderer.invoke(IPC.obDevPhoto),
  saveKey: (key: string): Promise<boolean> => ipcRenderer.invoke(IPC.obSaveKey, key),
  openKeyPage: (): void => ipcRenderer.send(IPC.obOpenKeyPage),
  createPet: (name: string, species: 'dog' | 'cat'): Promise<CreateResult> => ipcRenderer.invoke(IPC.createPet, { name, species }),
  onProgress: (cb: (p: Progress) => void): void => {
    ipcRenderer.on(IPC.obProgress, (_e, p: Progress) => cb(p));
  },
  onFinished: (cb: (r: CreateResult) => void): void => {
    ipcRenderer.on(IPC.obFinished, (_e, r: CreateResult) => cb(r));
  },
  keep: (): void => ipcRenderer.send(IPC.obKeep),
  close: (): void => ipcRenderer.send(IPC.obClose),
});
