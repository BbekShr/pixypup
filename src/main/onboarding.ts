import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { dataUrl, generateSpritePack, type PipelineEvent } from '../api/pose-pipeline';
import { MetaClient } from '../api/meta-client';
import { fakeCreate } from './fake-pipeline';
import { IPC } from './ipc';
import { checkCreateArgs, checkKey, errorCode, loadPhoto, PHOTO_EXTS, pickSlug, slugify, type ErrorCode } from './pet-input';
import { loadPack } from './pack';
import { finishRun, noRuns, record, startRun, type Progress, type Runs } from './run-state';
import { getApiKey, setApiKey } from './secrets';
import { saveSettings } from './settings';

const here = fileURLToPath(new URL('.', import.meta.url));
// Dev rehearsal only; a packaged app can never take the fake path.
const fake = !app.isPackaged && process.env['PIXY_FAKE_PIPELINE'] === '1';
const fast = process.env['PIXY_FAKE_FAST'] === '1';

const thumb = async (png: Buffer, h: number): Promise<string> => dataUrl(await sharp(png).resize({ height: h, withoutEnlargement: true }).png().toBuffer());

export function setupOnboarding(o: { getOverlay: () => BrowserWindow | null; onSettingsChanged: () => void; getPetName: () => string }): { open(fromMenu: boolean): void } {
  let win: BrowserWindow | null = null;
  let photoBuf: Buffer | null = null; // read once at pick time; the page never names a path for create-pet
  let runs: Runs = noRuns;
  // A typed key lives in memory until the first Meta call succeeds; only then is it stored. A bad key is never stored.
  let pendingKey: string | undefined;

  const ours = (e: IpcMainEvent | IpcMainInvokeEvent): boolean => !!win && !win.isDestroyed() && e.sender === win.webContents;
  const toWin = (channel: string, payload: unknown): void => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };
  const apiKey = (): string | undefined => {
    if (pendingKey) return pendingKey;
    try {
      return getApiKey();
    } catch {
      return undefined;
    }
  };
  const photoResult = async (path: unknown) => {
    const l = await loadPhoto(path);
    if (!l.ok) return l;
    try {
      const small = await sharp(l.buf).rotate().flatten({ background: '#FFF6EC' }).resize(240, 240, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer();
      photoBuf = l.buf;
      return { ok: true as const, thumb: dataUrl(small, 'image/jpeg') };
    } catch {
      return { ok: false as const, code: 'unreadable' as const };
    }
  };

  ipcMain.handle(IPC.obState, (e) => ours(e) && { needsKey: apiKey() === undefined, running: runs.current });
  ipcMain.handle(IPC.obPickPhoto, async (e) => {
    if (!ours(e) || !win) return { ok: false, code: 'cancelled' };
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Photos', extensions: PHOTO_EXTS }] });
    return r.canceled || !r.filePaths[0] ? { ok: false, code: 'cancelled' } : photoResult(r.filePaths[0]);
  });
  ipcMain.handle(IPC.obDropPhoto, (e, path: unknown) => (ours(e) ? photoResult(path) : { ok: false, code: 'missing' }));
  if (!app.isPackaged) ipcMain.handle(IPC.obDevPhoto, (e) => (ours(e) ? photoResult(join(app.getAppPath(), 'assets/pets/Pakkun/sit.png')) : { ok: false, code: 'missing' }));
  ipcMain.handle(IPC.obSaveKey, (e, key: unknown) => {
    if (!ours(e) || !checkKey(key)) return false;
    pendingKey = key;
    return true;
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

  ipcMain.handle(IPC.createPet, async (e, args: unknown): Promise<{ ok: true; name: string } | { ok: false; code: ErrorCode | 'busy' }> => {
    const a = checkCreateArgs(args);
    if (!ours(e) || !a || !photoBuf) return { ok: false, code: 'generation-failed' };
    const key = apiKey();
    if (!key || (fake && key.startsWith('bad'))) {
      pendingKey = undefined;
      return { ok: false, code: 'bad-key' };
    }
    const started = startRun(runs, a.name, a.species);
    if (!started) return { ok: false, code: 'busy' };
    runs = started.runs;
    const id = started.id;
    const photo = photoBuf;
    const settled: Promise<void>[] = [];
    const emit = (ev: PipelineEvent): void => {
      if (ev.stage !== 'cutout' && ev.stage !== 'pose') return;
      if (ev.stage === 'cutout' && !fake && pendingKey === key) {
        // The first Meta call worked, so the key is real: now it may be stored.
        try {
          setApiKey(key);
          pendingKey = undefined;
        } catch {
          console.warn('PixyPup: could not store the API key');
        }
      }
      settled.push(thumb(ev.png, ev.stage === 'cutout' ? 220 : 112).then((url) => {
        const p: Progress = { kind: ev.stage as 'cutout' | 'pose', name: ev.stage === 'pose' ? ev.name : 'cutout', url };
        runs = record(runs, id, p);
        toWin(IPC.obProgress, p);
      }));
    };
    let result: { ok: true; name: string } | { ok: false; code: ErrorCode };
    try {
      const slug = await pickSlug(slugify(a.name), o.getPetName(), (s) => stat(join(app.getPath('userData'), 'pets', s)).then(() => true, () => false));
      const outDir = join(app.getPath('userData'), 'pets', slug);
      if (fake) await fakeCreate({ srcDir: join(app.getAppPath(), 'assets/pets/Pakkun'), outDir, name: a.name, species: a.species, fast, emit });
      else await generateSpritePack({ client: new MetaClient({ apiKey: key }), photo, petName: a.name, species: a.species, outDir, onProgress: emit });
      await Promise.all(settled);
      if (!(await loadPack(outDir))) throw new Error('written pack does not load');
      // The pack exists: from here the outcome is ok, whatever settings or the overlay do (a "failure" would invite a paid retry).
      try {
        saveSettings({ petName: slug, onboarded: true });
        o.onSettingsChanged();
      } catch {
        console.warn('PixyPup: pet created but settings could not be saved');
      }
      o.getOverlay()?.webContents.send(IPC.packChanged);
      result = { ok: true, name: a.name };
    } catch (err) {
      if (errorCode(err) === 'bad-key') pendingKey = undefined;
      result = { ok: false, code: errorCode(err) };
    } finally {
      runs = finishRun(runs, id);
    }
    toWin(IPC.obFinished, result);
    return result;
  });

  return {
    open(fromMenu) {
      if (win && !win.isDestroyed()) {
        win.show();
        return;
      }
      if (!runs.current) photoBuf = null;
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
      win.on('closed', () => {
        win = null;
      });
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
