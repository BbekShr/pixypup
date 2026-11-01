import { app, BrowserWindow, ipcMain, Menu, nativeImage, powerMonitor, screen, Tray, type MenuItemConstructorOptions } from 'electron';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IPC } from './ipc';
import { petMenuTemplate, trayMenuTemplate, type MenuItem } from './menu';
import { isPlainName, loadPack, pickPackDir } from './pack';
import { setupOnboarding } from './onboarding';
import { commandToPatch, isSnoozed, type Energy, type Prefs } from './prefs';
import { hideLockedByAdmin, loadSettings, saveSettings } from './settings';

const here = fileURLToPath(new URL('.', import.meta.url));
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let trayIcon: Electron.NativeImage | null = null;
let trayIconDim: Electron.NativeImage | null = null;
let stay = false; // mirrors the overlay's stay flag for the menu checkbox; not persisted

function createWindow(): void {
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({
    x,
    y,
    width,
    height,
    transparent: true,
    frame: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    webPreferences: {
      preload: join(here, '../preload/preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.setContentProtection(settings.hideInShares);

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  // Dev rehearsal only: PIXY_CHATTY=1 makes the pet speak every ~5 s.
  const search = !app.isPackaged && process.env['PIXY_CHATTY'] === '1' ? '?chatty=1' : '';
  if (devUrl) void win.loadURL(`${devUrl}/overlay/index.html${search}`);
  else void win.loadFile(join(here, '../renderer/overlay/index.html'), { search });
}

function createTray(): void {
  trayIcon = nativeImage
    .createFromPath(join(app.getAppPath(), 'assets/placeholder/pup.png'))
    .resize({ height: 18 });
  trayIconDim = trayIcon;
  if (!trayIcon.isEmpty()) {
    // Snoozed = a faded icon. The bitmap is premultiplied BGRA, so every byte scales, not just alpha.
    const { width, height } = trayIcon.getSize();
    const px = trayIcon.toBitmap();
    for (let i = 0; i < px.length; i++) px[i] = Math.round(px[i]! * 0.35);
    trayIconDim = nativeImage.createFromBitmap(px, { width, height });
  }
  tray = new Tray(trayIcon);
  tray.setToolTip('PixyPup');
}

/** Descriptors -> native items; `run` receives the command of whatever was clicked. */
function toNative(items: MenuItem[], run: (cmd: string) => void): MenuItemConstructorOptions[] {
  return items.map((i): MenuItemConstructorOptions => {
    if ('type' in i) return { type: 'separator' };
    if ('quit' in i) return { label: i.label, click: () => app.quit() };
    if ('submenu' in i) return { label: i.label, submenu: toNative(i.submenu, run) };
    const click = (): void => run(i.command);
    if (i.radio) return { label: i.label, type: 'radio', checked: i.checked, click };
    return i.checked === undefined ? { label: i.label, click } : { label: i.label, type: 'checkbox', checked: i.checked, click };
  });
}

let settings = loadSettings(); // TODO(F1): feed settings to feature gates
let packEnergy: Energy | undefined; // the loaded pet's own personality.energy
let wakeTimer: NodeJS.Timeout | undefined;
let onboarding: ReturnType<typeof setupOnboarding>;

const snoozed = (): boolean => isSnoozed(settings.snoozeUntil, Date.now());
const prefs = (s = snoozed()): Prefs => ({ size: settings.size, energy: settings.energy ?? packEnergy ?? 'normal', snoozed: s });
const MAX_TIMER = 2 ** 31 - 1; // setTimeout wraps to 1 ms above this
// The checkbox shows what macOS says (the user can change it in System Settings); dev has no real login item.
const loginOn = (): boolean => (app.isPackaged ? app.getLoginItemSettings().openAtLogin : settings.openAtLogin);

/** Apply every effect of the current settings; the one place main reacts to a change. */
function sync(): void {
  const s = snoozed();
  win?.webContents.send(IPC.prefs, prefs(s));
  win?.setContentProtection(settings.hideInShares);
  onboarding.applyProtection();
  clearTimeout(wakeTimer);
  // Expiry is computed (snoozed() turns false by itself), so the timer only re-syncs; nothing to write.
  if (s) wakeTimer = setTimeout(sync, Math.min(MAX_TIMER, Math.max(0, (settings.snoozeUntil ?? 0) - Date.now()) + 50));
  tray?.setImage((s ? trayIconDim : trayIcon) ?? nativeImage.createEmpty());
  tray?.setContextMenu(Menu.buildFromTemplate(toNative(trayMenuTemplate({ snoozed: s, name: settings.petName }), run)));
}

/** Menu, tray and the dev hook all land here; only main writes settings. */
function run(cmd: string): void {
  if (cmd === 'stay' || cmd === 'wander') stay = cmd === 'stay';
  if (cmd === 'new-pet') {
    if (snoozed()) run('wake');
    onboarding.open(true);
    return;
  }
  const patch = commandToPatch(cmd, new Date());
  if (patch) {
    try {
      saveSettings(patch);
    } catch (e) {
      console.warn('PixyPup: could not save settings', e instanceof Error ? e.message : '');
    }
    settings = loadSettings(); // the admin file still wins over what was just saved
    // Only an explicit click touches the login item; syncing it would fight the user's System Settings.
    if (cmd.startsWith('login:')) {
      if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: patch['openAtLogin'] === true });
      else console.log(`[prefs] openAtLogin=${String(patch['openAtLogin'])} stored; only applied in a packaged app`);
    }
    sync();
  } else win?.webContents.send(IPC.command, cmd);
}

app.dock?.hide();

void app.whenReady().then(async () => {
  onboarding = setupOnboarding({ getOverlay: () => win, onSettingsChanged: () => { settings = loadSettings(); sync(); }, getPetName: () => settings.petName, getHideInShares: () => settings.hideInShares, beforeReveal: () => { if (snoozed()) run('wake'); } });
  ipcMain.handle(IPC.getPack, async () => {
    const dev = app.isPackaged ? undefined : process.env['PIXY_PACK_DIR'];
    if (dev) return loadPack(isAbsolute(dev) ? dev : resolve(dev));
    const candidates = [join(app.getAppPath(), 'assets/pets/Pakkun')];
    if (isPlainName(settings.petName)) candidates.unshift(join(app.getPath('userData'), 'pets', settings.petName));
    const dir = await pickPackDir(candidates, async (d) => (await loadPack(d)) !== null);
    const pack = dir && (await loadPack(dir));
    const e = pack ? pack.manifest.personality?.energy : undefined;
    if (e !== packEnergy) {
      packEnergy = e;
      win?.webContents.send(IPC.prefs, prefs());
    }
    return pack;
  });
  ipcMain.handle(IPC.getPrefs, () => prefs());
  if (!app.isPackaged) ipcMain.on(IPC.devCmd, (_e, cmd: unknown) => { if (typeof cmd === 'string') run(cmd); }); // CDP can't click native menus
  ipcMain.handle(IPC.getStay, () => stay);
  ipcMain.on(IPC.setClickThrough, (_e, on: boolean) => {
    win?.setIgnoreMouseEvents(on, { forward: true });
  });
  ipcMain.on(IPC.showMenu, () => {
    if (!win) return;
    const items = toNative(petMenuTemplate({ stay, snoozed: snoozed(), size: settings.size, energy: prefs().energy, hideInShares: settings.hideInShares, hideLocked: hideLockedByAdmin(), openAtLogin: loginOn(), name: settings.petName }), run);
    if (process.env['ELECTRON_RENDERER_URL']) console.log('[menu] popup');
    // Whatever the menu did to hover state, the next mouseenter on the pet turns click-through off again.
    Menu.buildFromTemplate(items).popup({ window: win, callback: () => win?.setIgnoreMouseEvents(true, { forward: true }) });
  });
  createWindow();
  createTray();
  sync();
  powerMonitor.on('resume', sync); // timers pause while the Mac sleeps
  // First launch only: Pakkun gets a moment to drop in before the welcome appears.
  const userPet = isPlainName(settings.petName) && (await loadPack(join(app.getPath('userData'), 'pets', settings.petName))) !== null;
  if (!app.isPackaged) process.on('SIGUSR2', () => onboarding.open(true)); // dev hook: the native menu can't be driven over CDP
  if (!settings.onboarded && !userPet) setTimeout(() => onboarding.open(false), 1500);
});

app.on('window-all-closed', () => app.quit());
