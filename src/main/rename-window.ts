import { BrowserWindow, ipcMain } from 'electron';
import { devRendererUrl } from './dev-url';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IPC } from './ipc';
import { checkPetName } from './pets';

const here = fileURLToPath(new URL('.', import.meta.url));

export interface RenameTarget { slug: string; name: string; original: string; avatar?: string }

/** "Rename X…": one small card per pet. The page only ever names its own pet; main re-checks the name and owns the slug. */
export function setupRenameWindow(o: { getHideInShares: () => boolean; save: (slug: string, name: string) => boolean }): { open(t: RenameTarget): void; applyProtection(): void } {
  let win: BrowserWindow | null = null;
  let target: RenameTarget | null = null;
  const ours = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean => !!win && !win.isDestroyed() && e.sender === win.webContents;

  ipcMain.handle(IPC.renameInfo, (e) => (ours(e) && target ? { name: target.name, original: target.original, avatar: target.avatar ?? null } : null));
  ipcMain.handle(IPC.renameSave, (e, name: unknown): 'ok' | 'bad' => {
    const n = checkPetName(name);
    if (!ours(e) || !target || n === null) return 'bad';
    return o.save(target.slug, n) ? 'ok' : 'bad';
  });
  ipcMain.on(IPC.renameClose, (e) => { if (ours(e)) win?.close(); });

  return {
    open(t) {
      target = t;
      if (win && !win.isDestroyed()) {
        win.webContents.reload(); // a different pet's rename reuses the card
        win.show();
        win.focus();
        return;
      }
      const w = new BrowserWindow({
        width: 380,
        height: 420,
        frame: false,
        transparent: true,
        hasShadow: false,
        resizable: false,
        show: false,
        center: true,
        fullscreenable: false,
        webPreferences: { preload: join(here, '../preload/rename-preload.mjs'), contextIsolation: true, nodeIntegration: false, sandbox: false },
      });
      win = w;
      w.webContents.on('render-process-gone', () => { if (!w.isDestroyed()) w.destroy(); });
      w.setAlwaysOnTop(true, 'floating');
      w.setContentProtection(o.getHideInShares());
      w.once('ready-to-show', () => { w.show(); w.focus(); });
      w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      w.webContents.on('will-navigate', (ev) => ev.preventDefault());
      w.on('closed', () => { if (win === w) { win = null; target = null; } });
      const devUrl = devRendererUrl();
      if (devUrl) void w.loadURL(`${devUrl}/onboarding/rename.html`);
      else void w.loadFile(join(here, '../renderer/onboarding/rename.html'));
    },
    applyProtection: () => { if (win && !win.isDestroyed()) win.setContentProtection(o.getHideInShares()); },
  };
}
