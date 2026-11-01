import { app, BrowserWindow, dialog, ipcMain, screen, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { dataUrl, generateSpritePack, type PipelineEvent } from '../api/pose-pipeline';
import { openClient } from '../api/gate';
import { fakeCreate } from './fake-pipeline';
import { IPC } from './ipc';
import { checkCreateArgs, checkKey, errorCode, loadPhoto, PHOTO_EXTS, pickSlug, slugify, type ErrorCode } from './pet-input';
import { loadPack } from './pack';
import { factViews, finishRun, noRuns, record, recordFailed, recordInfo, sourceFor, startRun, walkFailed, type Progress, type Runs } from './run-state';
import { getApiKey, setApiKey } from './secrets';
import { loadSettings, saveSettings } from './settings';

const here = fileURLToPath(new URL('.', import.meta.url));
// Dev rehearsal only; a packaged app can never take the fake path.
const fake = !app.isPackaged && process.env['PIXY_FAKE_PIPELINE'] === '1';
const fast = process.env['PIXY_FAKE_FAST'] === '1';

const thumb = async (png: Buffer, h: number): Promise<string> => dataUrl(await sharp(png).resize({ height: h, withoutEnlargement: true }).png().toBuffer());

export function setupOnboarding(o: { getOverlay: () => BrowserWindow | null; addPet: (slug: string) => void; onSettingsChanged: () => void; getPetName: () => string; getHideInShares: () => boolean; beforeReveal: () => void }): { open(fromMenu: boolean, add?: boolean): void; applyProtection(): void } {
  let win: BrowserWindow | null = null;
  let photoBuf: Buffer | null = null; // read once at pick time; the page never names a path for create-pet
  let runs: Runs = noRuns;
  // A typed key lives in memory until the first Meta call succeeds; only then is it stored. A bad key is never stored.
  let pendingKey: string | undefined;
  // Set when a pet was just made: the overlay hand-off waits until the window has shrunk away, so the old pet leaves as this one lands.
  let handoff: { x?: number } | null = null;
  let handoffTimer: NodeJS.Timeout | undefined;
  let adding = false; // opened to add a pet next to the others, not to replace the first
  let pendingAdd: string | null = null;
  const centreX = (): number | undefined => {
    if (!win || win.isDestroyed()) return undefined;
    const b = win.getBounds();
    return b.x + b.width / 2 - (o.getOverlay()?.getBounds().x ?? 0);
  };
  const sendHandoff = (): void => {
    clearTimeout(handoffTimer);
    if (!handoff) return;
    o.beforeReveal(); // a snoozed pet would hide the new one
    if (pendingAdd) {
      o.addPet(pendingAdd);
      pendingAdd = null;
    } else o.getOverlay()?.webContents.send(IPC.packChanged, handoff);
    handoff = null;
  };

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

  ipcMain.handle(IPC.obState, (e) => {
    if (!ours(e)) return false;
    const c = runs.current;
    return { needsKey: apiKey() === undefined, running: c && { ...c, facts: c.facts && factViews(c.facts), walkFailed: walkFailed(c) } };
  });
  ipcMain.on(IPC.obOpenSource, (e, index: unknown) => {
    const url = ours(e) ? sourceFor(runs, index) : null;
    if (url) void shell.openExternal(url);
  });
  ipcMain.handle(IPC.obPickPhoto, async (e) => {
    if (!ours(e) || !win) return { ok: false, code: 'cancelled' };
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Photos', extensions: PHOTO_EXTS }] });
    return r.canceled || !r.filePaths[0] ? { ok: false, code: 'cancelled' } : photoResult(r.filePaths[0]);
  });
  ipcMain.handle(IPC.obDropPhoto, (e, path: unknown) => (ours(e) ? photoResult(path) : { ok: false, code: 'missing' }));
  if (!app.isPackaged) ipcMain.handle(IPC.obDevPhoto, (e) => (ours(e) ? photoResult(process.env['PIXY_DEV_PHOTO'] ?? join(app.getAppPath(), 'assets/pets/Pakkun/sit.png')) : { ok: false, code: 'missing' }));
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
  // The reveal's exit: the window slides to the floor while the page scales and fades the card, then closes.
  ipcMain.on(IPC.obShrink, (e, calm: unknown) => {
    if (!ours(e) || !win) return;
    const w = win;
    const b = w.getBounds();
    const floor = screen.getDisplayMatching(b).workArea;
    const dy = floor.y + floor.height - (b.y + b.height);
    const ms = calm === true ? 0 : 600;
    const t0 = Date.now();
    const tick = setInterval(() => {
      const u = ms === 0 ? 1 : Math.min(1, (Date.now() - t0) / ms);
      if (w.isDestroyed()) return clearInterval(tick);
      w.setBounds({ ...b, y: Math.round(b.y + dy * u * u) });
      if (u >= 1) {
        clearInterval(tick);
        w.close();
      }
    }, 16);
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
    let idle: string | undefined; // the generated 3D idle frame, for the reveal
    const emit = (ev: PipelineEvent): void => {
      if (ev.stage === 'personality') {
        runs = recordInfo(runs, id, { personality: ev.personality });
        if (runs.current?.id === id) toWin(IPC.obPersonality, ev.personality);
      } else if (ev.stage === 'facts') {
        runs = recordInfo(runs, id, { facts: ev.facts });
        if (runs.current?.id === id) toWin(IPC.obFacts, factViews(runs.current.facts ?? []));
      }
      if (ev.stage === 'pose-failed') {
        const had = walkFailed(runs.current);
        runs = recordFailed(runs, id, ev.name);
        if (!had && walkFailed(runs.current) && runs.current?.id === id) toWin(IPC.obStepsFailed, null);
      }
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
      if (ev.stage === 'pose' && ev.name === 'idle_0') settled.push(thumb(ev.png, 260).then((u) => { idle = u; }));
      settled.push(thumb(ev.png, ev.stage === 'cutout' ? 220 : 112).then((url) => {
        const p: Progress = { kind: ev.stage as 'cutout' | 'pose', name: ev.stage === 'pose' ? ev.name : 'cutout', url };
        runs = record(runs, id, p);
        toWin(IPC.obProgress, p);
      }));
    };
    let result: { ok: true; name: string; idle?: string } | { ok: false; code: ErrorCode };
    try {
      const slug = await pickSlug(slugify(a.name), adding ? '' : o.getPetName(), // adding never overwrites a pet that is already here
         (s) => stat(join(app.getPath('userData'), 'pets', s)).then(() => true, () => false));
      const outDir = join(app.getPath('userData'), 'pets', slug);
      if (fake) await fakeCreate({ srcDir: join(app.getAppPath(), 'assets/pets/Pakkun'), outDir, name: a.name, species: a.species, fast, emit });
      else await generateSpritePack({ client: openClient('create-pet', loadSettings(), key), photo, petName: a.name, species: a.species, outDir, onProgress: emit });
      await Promise.all(settled);
      if (!(await loadPack(outDir))) throw new Error('written pack does not load');
      // The pack exists: from here the outcome is ok, whatever settings or the overlay do (a "failure" would invite a paid retry).
      try {
        if (adding) pendingAdd = slug;
        saveSettings(adding ? { onboarded: true } : { petName: slug, onboarded: true });
        o.onSettingsChanged();
      } catch {
        console.warn('PixyPup: pet created but settings could not be saved');
      }
      handoff = {};
      // A reopened window may never reach the reveal; the new pet must not stay hidden behind that.
      handoffTimer = setTimeout(() => {
        const x = centreX();
        if (handoff && x !== undefined) handoff.x = x;
        sendHandoff();
      }, 8000);
      if (!win || win.isDestroyed()) sendHandoff();
      result = { ok: true, name: a.name, ...(idle ? { idle } : {}) };
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
    open(fromMenu, add = false) {
      if (win && !win.isDestroyed()) {
        win.show();
        return;
      }
      if (!runs.current) photoBuf = null;
      adding = add;
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
      win.setContentProtection(o.getHideInShares());
      win.on('close', () => {
        const x = centreX();
        if (handoff && x !== undefined) handoff.x = x;
      });
      win.on('closed', () => {
        win = null;
        sendHandoff();
      });
      win.once('ready-to-show', () => win?.show());
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', (ev) => ev.preventDefault());
      const q = fromMenu ? `?from=menu${add ? '&mode=add' : ''}` : '';
      const devUrl = process.env['ELECTRON_RENDERER_URL'];
      if (devUrl) void win.loadURL(`${devUrl}/onboarding/index.html${q}`);
      else void win.loadFile(join(here, '../renderer/onboarding/index.html'), { search: q });
    },
    applyProtection() {
      win?.setContentProtection(o.getHideInShares());
    },
  };
}
