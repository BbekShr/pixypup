import { BrowserWindow, ipcMain, session } from 'electron';
import { devRendererUrl } from './dev-url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validChunk } from '../voice/listen';
import { IPC } from './ipc';

const here = fileURLToPath(new URL('.', import.meta.url));

/** Dev only: the 24 kHz 16-bit mono PCM of a WAV, streamed by the mic window instead of getUserMedia. */
export const fakeMicPcm = (path: string | undefined): ArrayBuffer | undefined => {
  if (!path) return undefined;
  try {
    const b = readFileSync(path);
    const at = b.indexOf('data'); // afconvert pads the header (FLLR), so the PCM is not at byte 44
    if (at < 12) return undefined;
    const start = at + 8;
    return b.buffer.slice(b.byteOffset + start, b.byteOffset + Math.min(b.length, start + b.readUInt32LE(at + 4))) as ArrayBuffer;
  } catch {
    return undefined; // dev only: a bad path just means no fake mic
  }
};

/** A hidden window that holds the microphone only between start() and stop(); it never shows UI. */
export function setupMic(o: { onChunk: (b: ArrayBuffer) => void; fake?: ArrayBuffer }): { warm(): void; start(): void; stop(): void; close(): void } {
  let win: BrowserWindow | null = null;
  let wanted = false;
  // Only the mic window may use the microphone; the overlay and the explainers get nothing.
  const ok = (wc: Electron.WebContents | null): boolean => !!win && !win.isDestroyed() && wc === win.webContents;
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'media' && ok(wc)));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => perm === 'media' && ok(wc));
  ipcMain.on(IPC.micChunk, (e, data: unknown) => {
    const b = validChunk(data);
    if (b && ok(e.sender)) o.onChunk(b);
  });
  const send = (): void => {
    if (win && !win.isDestroyed()) win.webContents.send(wanted ? IPC.micStart : IPC.micStop, wanted ? o.fake : undefined);
  };
  function create(): BrowserWindow {
    if (win && !win.isDestroyed()) return win;
    const w = new BrowserWindow({
      show: false,
      width: 100,
      height: 100,
      webPreferences: { preload: join(here, '../preload/mic-preload.mjs'), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false },
    });
    win = w;
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.webContents.on('will-navigate', (ev) => ev.preventDefault());
    w.webContents.once('did-finish-load', send);
    w.webContents.on('render-process-gone', () => { if (!w.isDestroyed()) w.destroy(); });
    w.on('closed', () => { if (win === w) win = null; });
    const devUrl = devRendererUrl();
    if (devUrl) void w.loadURL(`${devUrl}/voice/mic.html`);
    else void w.loadFile(join(here, '../renderer/voice/mic.html'));
    return w;
  }
  return {
    // Loading the page asks for nothing; warming it keeps the page load out of the first listen window.
    warm() {
      create();
    },
    start() {
      wanted = true;
      const fresh = !win || win.isDestroyed();
      create();
      if (!fresh) send();
    },
    stop() {
      wanted = false;
      send();
    },
    close() {
      wanted = false;
      if (win && !win.isDestroyed()) win.destroy();
      win = null;
    },
  };
}
