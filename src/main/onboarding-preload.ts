import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC } from './ipc';
import type { Personality } from '../../contracts/types';
import type { FactView, Progress, Run } from './run-state';

export type { FactView, Personality, Progress };
export type PhotoResult = { ok: true; thumb: string } | { ok: false; code: 'missing' | 'type' | 'size' | 'unreadable' | 'cancelled' };
export type CreateResult = { ok: true; name: string; idle?: string } | { ok: false; code: 'bad-key' | 'no-pet-found' | 'network' | 'limit' | 'generation-failed' | 'busy'; detail?: string };

// Narrow on purpose: no paths from the page except a dropped File (main re-validates), no raw errors back.
contextBridge.exposeInMainWorld('pixyOb', {
  state: (): Promise<{ needsKey: boolean; offline: boolean; running: (Omit<Run, 'facts'> & { facts?: FactView[]; walkFailed: boolean }) | null }> => ipcRenderer.invoke(IPC.obState),
  pickPhoto: (): Promise<PhotoResult> => ipcRenderer.invoke(IPC.obPickPhoto),
  dropPhoto: (file: File): Promise<PhotoResult> => ipcRenderer.invoke(IPC.obDropPhoto, webUtils.getPathForFile(file)),
  devPhoto: (): Promise<PhotoResult> => ipcRenderer.invoke(IPC.obDevPhoto),
  saveKey: (key: string): Promise<boolean> => ipcRenderer.invoke(IPC.obSaveKey, key),
  checkKey: (key: string): Promise<'ok' | 'bad-key' | 'network' | 'unsafe'> => ipcRenderer.invoke(IPC.obCheckKey, key),
  openKeyPage: (): void => ipcRenderer.send(IPC.obOpenKeyPage),
  createPet: (name: string, species: string): Promise<CreateResult> => ipcRenderer.invoke(IPC.createPet, { name, species }),
  onProgress: (cb: (p: Progress) => void): void => {
    ipcRenderer.on(IPC.obProgress, (_e, p: Progress) => cb(p));
  },
  onFinished: (cb: (r: CreateResult) => void): void => {
    ipcRenderer.on(IPC.obFinished, (_e, r: CreateResult) => cb(r));
  },
  onPersonality: (cb: (p: Personality) => void): void => {
    ipcRenderer.on(IPC.obPersonality, (_e, p: Personality) => cb(p));
  },
  onFacts: (cb: (f: FactView[]) => void): void => {
    ipcRenderer.on(IPC.obFacts, (_e, f: FactView[]) => cb(f));
  },
  onStepsFailed: (cb: () => void): void => {
    ipcRenderer.on(IPC.obStepsFailed, () => cb());
  },
  openSource: (index: number): void => ipcRenderer.send(IPC.obOpenSource, index),
  keep: (): void => ipcRenderer.send(IPC.obKeep),
  close: (): void => ipcRenderer.send(IPC.obClose),
  shrink: (calm: boolean): void => ipcRenderer.send(IPC.obShrink, calm),
});
