import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { dataUrl, generateSpritePack, readPhoto, type PipelineEvent } from '../api/pose-pipeline';
import { MetaClient } from '../api/meta-client';
import { fakeCreate } from './fake-pipeline';
import { IPC } from './ipc';
import { checkCreateArgs, checkKey, checkPhoto, errorCode, PHOTO_EXTS, slugify, type ErrorCode } from './pet-input';
import { getApiKey, setApiKey } from './secrets';
import { saveSettings } from './settings';

const here = fileURLToPath(new URL('.', import.meta.url));
// Dev rehearsal only; a packaged app can never take the fake path.
const fake = !app.isPackaged && process.env['PIXY_FAKE_PIPELINE'] === '1';
const fast = process.env['PIXY_FAKE_FAST'] === '1';

const thumb = async (png: Buffer, h: number): Promise<string> => dataUrl(await sharp(png).resize({ height: h, withoutEnlargement: true }).png().toBuffer());

export function setupOnboarding(o: { getOverlay: () => BrowserWindow | null; onSettingsChanged: () => void }): { open(fromMenu: boolean): void } {
  let win: BrowserWindow | null = null;
  let photo: string | null = null; // validated path; the page never names a path for create-pet
  let creating = false;
  let fakeKey: string | undefined;

  const ours = (e: IpcMainEvent | IpcMainInvokeEvent): boolean => !!win && !win.isDestroyed() && e.sender === win.webContents;
  const apiKey = (): string | undefined => {
    if (fake && fakeKey) return fakeKey;
    try {
      return getApiKey();
    } catch {
      return undefined;
    }
  };
  const photoResult = async (path: unknown) => {
    const c = await checkPhoto(path);
    if (!c.ok) return c;
    try {
      const small = await sharp(await readPhoto(c.path)).rotate().flatten({ background: '#FFF6EC' }).resize(240, 240, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer();
      photo = c.path;
      return { ok: true as const, thumb: dataUrl(small, 'image/jpeg') };
    } catch {
      return { ok: false as const, code: 'unreadable' as const };
    }
  };

  ipcMain.handle(IPC.obState, (e) => ours(e) && { needsKey: apiKey() === undefined });
  ipcMain.handle(IPC.obPickPhoto, async (e) => {
    if (!ours(e) || !win) return { ok: false, code: 'cancelled' };
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Photos', extensions: PHOTO_EXTS }] });
    return r.canceled || !r.filePaths[0] ? { ok: false, code: 'cancelled' } : photoResult(r.filePaths[0]);
  });
  ipcMain.handle(IPC.obDropPhoto, (e, path: unknown) => (ours(e) ? photoResult(path) : { ok: false, code: 'missing' }));
  if (fake) ipcMain.handle(IPC.obDevPhoto, (e) => (ours(e) ? photoResult(join(app.getAppPath(), 'assets/pets/Pakkun/sit.png')) : { ok: false, code: 'missing' }));
  ipcMain.handle(IPC.obSaveKey, (e, key: unknown) => {
    if (!ours(e) || !checkKey(key)) return false;
    if (fake) {
      fakeKey = key; // never persisted in rehearsal mode
      return true;
    }
    try {
      setApiKey(key);
      return true;
    } catch {
      return false;
    }
  });
  ipcMain.on(IPC.obOpenKeyPage, (e) => {
    if (ours(e)) void shell.openExternal('https://dev.meta.ai/');
  });
  ipcMain.on(IPC.obKeep, (e) => {
    if (!ours(e)) return;
    try {
      saveSettings({ onboarded: true });
      o.onSettingsChanged();
    } catch {
      /* the welcome simply shows again next launch */
    }
    win?.close();
  });
  ipcMain.on(IPC.obClose, (e) => {
    if (ours(e)) win?.close();
  });

  ipcMain.handle(IPC.createPet, async (e, args: unknown): Promise<{ ok: true; name: string } | { ok: false; code: ErrorCode }> => {
    const a = checkCreateArgs(args);
    if (!ours(e) || !a || !photo || creating) return { ok: false, code: 'generation-failed' };
    const key = apiKey();
    if (!key || (fake && key.startsWith('bad'))) return { ok: false, code: 'bad-key' };
    creating = true;
    const slug = slugify(a.name);
    const outDir = join(app.getPath('userData'), 'pets', slug);
    const emit = (ev: PipelineEvent): void => {
      if (ev.stage !== 'cutout' && ev.stage !== 'pose') return;
      void thumb(ev.png, ev.stage === 'cutout' ? 220 : 112).then((url) => {
        if (win && !win.isDestroyed()) win.webContents.send(IPC.obProgress, { kind: ev.stage, name: ev.stage === 'pose' ? ev.name : 'cutout', url });
      });
    };
    try {
      if (fake) await fakeCreate({ srcDir: join(app.getAppPath(), 'assets/pets/Pakkun'), outDir, name: a.name, species: a.species, fast, emit });
      else await generateSpritePack({ client: new MetaClient({ apiKey: key }), photo: await readPhoto(photo), petName: a.name, species: a.species, outDir, onProgress: emit });
      saveSettings({ petName: slug, onboarded: true });
      o.onSettingsChanged();
      o.getOverlay()?.webContents.send(IPC.packChanged);
      return { ok: true, name: a.name };
    } catch (err) {
      return { ok: false, code: errorCode(err) };
    } finally {
      creating = false;
    }
  });

  return {
    open(fromMenu) {
      if (win && !win.isDestroyed()) {
        win.show();
        return;
      }
      photo = null;
      win = new BrowserWindow({
        width: 480,
        height: 560,
        frame: false,
        transparent: true,
        hasShadow: false,
        resizable: false,
        show: false,
        center: true,
        fullscreenable: false,
        webPreferences: { preload: join(here, '../preload/onboarding-preload.mjs'), contextIsolation: true, nodeIntegration: false, sandbox: false },
      });
      win.setAlwaysOnTop(true, 'floating');
      win.on('closed', () => { win = null; });
      win.once('ready-to-show', () => win?.show());
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', (ev) => ev.preventDefault());
      const q = fromMenu ? '?from=menu' : '';
      const devUrl = process.env['ELECTRON_RENDERER_URL'];
      if (devUrl) void win.loadURL(`${devUrl}/onboarding/index.html${q}`);
      else void win.loadFile(join(here, '../renderer/onboarding/index.html'), { search: q });
    },
  };
}
