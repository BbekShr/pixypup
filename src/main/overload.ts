import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { devRendererUrl } from './dev-url';
import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_CAST, SHOW_MS } from '../overlay/overload-choreo';
import { IPC } from './ipc';
import { isPlainName, listLibrary, loadPack, type Pack } from './pack';
import { nameFor, renamed, type PetNames } from './pets';

const here = fileURLToPath(new URL('.', import.meta.url));
const CURSOR_HZ_MS = 33;
const START_CAP_MS = 15_000;

/** Every saved pet plus the bundled ones, one per name. */
async function gatherPacks(renames: PetNames | undefined): Promise<Pack[]> {
  const root = join(app.getPath('userData'), 'pets');
  const names = (await readdir(root).catch(() => [] as string[])).filter(isPlainName);
  const lib = join(app.getAppPath(), 'assets/pets');
  // User dirs first: the dedupe below keeps the first pack per name, so a user pet beats a bundled one.
  const dirs = [...names.map((n) => join(root, n)), ...(await listLibrary(lib)).map((l) => join(lib, l.slug))];
  const seen = new Set<string>();
  const out: Pack[] = [];
  for (const [i, p] of (await Promise.all(dirs.map(loadPack))).entries()) {
    const key = p?.manifest.pet.toLowerCase();
    if (!p || !key || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...p, manifest: renamed(p.manifest, nameFor(renames, basename(dirs[i]!))) });
  }
  return out.slice(0, MAX_CAST);
}

/** The overload window: click-through for its whole life. Main owns every timer, so a closed window can't leave work behind. */
export function setupOverload(o: { hideInShares: () => boolean; names: () => PetNames | undefined; onChange: () => void }): { start(): Promise<void>; stop(): void; active(): boolean } {
  let on = false;
  let gen = 0;
  let win: BrowserWindow | null = null;
  let cursorTimer: NodeJS.Timeout | undefined;
  let endTimer: NodeJS.Timeout | undefined;

  function stop(): void {
    if (!on) return;
    on = false;
    gen++;
    clearInterval(cursorTimer);
    clearTimeout(endTimer);
    if (win && !win.isDestroyed()) win.destroy();
    win = null;
    o.onChange();
  }

  ipcMain.on(IPC.overloadDone, (e) => { if (win && e.sender === win.webContents) stop(); });
  // The show's clock starts when the first frame draws, not when the window opens (decoding 24 sprites takes a moment); START_CAP_MS bounds a page that never starts.
  ipcMain.on(IPC.overloadStarted, (e) => {
    if (!win || e.sender !== win.webContents) return;
    clearTimeout(endTimer);
    endTimer = setTimeout(stop, SHOW_MS + 1500);
  });

  async function start(): Promise<void> {
    if (on) return;
    on = true;
    const mine = ++gen;
    o.onChange();
    try {
      await open(mine);
    } catch {
      if (gen === mine) stop(); // a pack or window that throws must not leave the overload "running"
    }
  }

  async function open(mine: number): Promise<void> {
    const packs = await gatherPacks(o.names());
    if (gen !== mine || packs.length === 0) { if (gen === mine) stop(); return; }
    const b = screen.getPrimaryDisplay().workArea;
    const w = new BrowserWindow({
      x: b.x, y: b.y, width: b.width, height: b.height,
      transparent: true, frame: false, hasShadow: false, alwaysOnTop: true, skipTaskbar: true, resizable: false, focusable: false,
      webPreferences: { preload: join(here, '../preload/overload-preload.mjs'), contextIsolation: true, nodeIntegration: false, sandbox: false },
    });
    win = w;
    for (const ev of ['render-process-gone', 'unresponsive'] as const) w.webContents.on(ev as 'render-process-gone', () => { if (!w.isDestroyed()) w.setIgnoreMouseEvents(true, { forward: true }); });
    w.setAlwaysOnTop(true, 'screen-saver');
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    w.setIgnoreMouseEvents(true); // never takes input, on any path
    w.setContentProtection(o.hideInShares());
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.webContents.on('will-navigate', (ev) => ev.preventDefault());
    w.webContents.once('did-finish-load', () => {
      if (gen !== mine || w.isDestroyed()) return;
      w.webContents.send(IPC.overloadStart, { packs, seed: (Date.now() ^ (Math.random() * 2 ** 31)) >>> 0 });
      cursorTimer = setInterval(() => {
        if (w.isDestroyed()) return;
        const c = screen.getCursorScreenPoint();
        w.webContents.send(IPC.overloadCursor, { x: c.x - b.x, y: c.y - b.y });
      }, CURSOR_HZ_MS);
    });
    endTimer = setTimeout(stop, SHOW_MS + START_CAP_MS);
    const devUrl = devRendererUrl();
    if (devUrl) void w.loadURL(`${devUrl}/overlay/overload.html`);
    else void w.loadFile(join(here, '../renderer/overlay/overload.html'));
  }

  return { start, stop, active: () => on };
}
