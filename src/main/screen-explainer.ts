import { BrowserWindow, ipcMain } from 'electron';
import { devRendererUrl } from './dev-url.js';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IPC } from './ipc';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The consent step for screen-aware mode: nothing reads the screen until the user presses "Turn it on" here. */
export function setupScreenExplainer(o: { getHideInShares: () => boolean; kind?: 'screen' | 'voice' }): { ask(name: string): Promise<boolean> } {
  let win: BrowserWindow | null = null;
  let settle: ((yes: boolean) => void) | null = null;
  ipcMain.on(IPC.screenAnswer, (e, yes: unknown) => {
    if (win && !win.isDestroyed() && e.sender === win.webContents) settle?.(yes === true);
  });
  return {
    ask(name) {
      if (win && !win.isDestroyed()) {
        win.show();
        return new Promise((r) => { const prev = settle; settle = (y) => { prev?.(y); r(y); }; });
      }
      const w = new BrowserWindow({
        width: 440,
        height: 540,
        frame: false,
        transparent: true,
        hasShadow: false,
        resizable: false,
        show: false,
        center: true,
        fullscreenable: false,
        webPreferences: { preload: join(here, '../preload/screen-preload.mjs'), contextIsolation: true, nodeIntegration: false, sandbox: false },
      });
      win = w;
      w.setAlwaysOnTop(true, 'floating');
      w.setContentProtection(o.getHideInShares());
      w.once('ready-to-show', () => w.show());
      w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      w.webContents.on('will-navigate', (ev) => ev.preventDefault());
      const q = `?name=${encodeURIComponent(name)}&kind=${o.kind ?? 'screen'}`;
      const devUrl = devRendererUrl();
      if (devUrl) void w.loadURL(`${devUrl}/onboarding/screen.html${q}`);
      else void w.loadFile(join(here, '../renderer/onboarding/screen.html'), { search: q });
      return new Promise((resolve) => {
        settle = (yes) => {
          settle = null;
          resolve(yes);
          if (!w.isDestroyed()) w.close();
        };
        w.on('closed', () => { win = null; settle?.(false); });
      });
    },
  };
}
