import { BrowserWindow, ipcMain, shell } from 'electron';
import { devRendererUrl } from './dev-url';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IPC } from './ipc';
import { storeKey } from './key-check';
import { checkKey } from './pet-input';
import { getApiKey, setApiKey } from './secrets';
import type { Settings } from './settings';

const here = fileURLToPath(new URL('.', import.meta.url));

/** "Add Meta key for the full experience…": the key outside pet creation. Checked with one tiny call, stored only if Meta takes it. */
export function setupKeyWindow(o: { name: () => string; settings: () => Settings; getHideInShares: () => boolean; onSaved: () => void }): { open(): void; applyProtection(): void } {
  let win: BrowserWindow | null = null;
  const ours = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean => !!win && !win.isDestroyed() && e.sender === win.webContents;
  const hasKey = (): boolean => {
    try {
      return !!getApiKey();
    } catch {
      return false;
    }
  };

  ipcMain.handle(IPC.keyInfo, (e) => (ours(e) ? { name: o.name(), hasKey: hasKey() } : null));
  ipcMain.handle(IPC.keySave, async (e, key: unknown): Promise<'ok' | 'bad-key' | 'network' | 'unsafe'> => {
    if (!ours(e) || !checkKey(key)) return 'bad-key';
    const v = await storeKey(key, o.settings(), setApiKey);
    if (v !== 'ok') return v;
    o.onSaved();
    return 'ok';
  });
  ipcMain.on(IPC.keyOpenPage, (e) => { if (ours(e)) void shell.openExternal('https://dev.meta.ai/'); });
  ipcMain.on(IPC.keyClose, (e) => { if (ours(e)) win?.close(); });

  return {
    open() {
      if (win && !win.isDestroyed()) {
        win.show();
        win.focus();
        return;
      }
      const w = new BrowserWindow({
        width: 440,
        height: 560,
        frame: false,
        transparent: true,
        hasShadow: false,
        resizable: false,
        show: false,
        center: true,
        fullscreenable: false,
        webPreferences: { preload: join(here, '../preload/key-preload.mjs'), contextIsolation: true, nodeIntegration: false, sandbox: false },
      });
      win = w;
      w.webContents.on('render-process-gone', () => { if (!w.isDestroyed()) w.destroy(); }); // a crashed page is a blank dead window: drop it so open() recreates
      w.setAlwaysOnTop(true, 'floating');
      w.setContentProtection(o.getHideInShares());
      w.once('ready-to-show', () => { w.show(); w.focus(); });
      w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      w.webContents.on('will-navigate', (ev) => ev.preventDefault());
      w.on('closed', () => { if (win === w) win = null; });
      const devUrl = devRendererUrl();
      if (devUrl) void w.loadURL(`${devUrl}/onboarding/key.html`);
      else void w.loadFile(join(here, '../renderer/onboarding/key.html'));
    },
    applyProtection: () => { if (win && !win.isDestroyed()) win.setContentProtection(o.getHideInShares()); },
  };
}
