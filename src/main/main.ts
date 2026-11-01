import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray, type MenuItemConstructorOptions } from 'electron';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IPC } from './ipc';
import { petMenuTemplate } from './menu';
import { isPlainName, loadPack, pickPackDir } from './pack';
import { setupOnboarding } from './onboarding';
import { loadSettings } from './settings';

const here = fileURLToPath(new URL('.', import.meta.url));
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
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

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  // Dev rehearsal only: PIXY_CHATTY=1 makes the pet speak every ~5 s.
  const search = !app.isPackaged && process.env['PIXY_CHATTY'] === '1' ? '?chatty=1' : '';
  if (devUrl) void win.loadURL(`${devUrl}/overlay/index.html${search}`);
  else void win.loadFile(join(here, '../renderer/overlay/index.html'), { search });
}

function createTray(): void {
  const icon = nativeImage
    .createFromPath(join(app.getAppPath(), 'assets/placeholder/pup.png'))
    .resize({ height: 18 });
  tray = new Tray(icon);
  tray.setToolTip('PixyPup');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Quit PixyPup', click: () => app.quit() }]));
}

app.dock?.hide();

void app.whenReady().then(async () => {
  let settings = loadSettings(); // TODO(F1): feed settings to feature gates
  const onboarding = setupOnboarding({ getOverlay: () => win, onSettingsChanged: () => { settings = loadSettings(); }, getPetName: () => settings.petName });
  ipcMain.handle(IPC.getPack, async () => {
    const dev = app.isPackaged ? undefined : process.env['PIXY_PACK_DIR'];
    if (dev) return loadPack(isAbsolute(dev) ? dev : resolve(dev));
    const candidates = [join(app.getAppPath(), 'assets/pets/Pakkun')];
    if (isPlainName(settings.petName)) candidates.unshift(join(app.getPath('userData'), 'pets', settings.petName));
    const dir = await pickPackDir(candidates, async (d) => (await loadPack(d)) !== null);
    return dir && loadPack(dir);
  });
  ipcMain.handle(IPC.getStay, () => stay);
  ipcMain.on(IPC.setClickThrough, (_e, on: boolean) => {
    win?.setIgnoreMouseEvents(on, { forward: true });
  });
  ipcMain.on(IPC.showMenu, () => {
    if (!win) return;
    const send = (cmd: string): void => {
      if (cmd === 'stay' || cmd === 'wander') stay = cmd === 'stay';
      if (cmd === 'new-pet') onboarding.open(true);
      else win?.webContents.send(IPC.command, cmd);
    };
    const items = petMenuTemplate({ stay }).map((i): MenuItemConstructorOptions => {
      if ('type' in i) return { type: 'separator' };
      if ('quit' in i) return { label: i.label, click: () => app.quit() };
      return i.checked === undefined
        ? { label: i.label, click: () => send(i.command) }
        : { label: i.label, type: 'checkbox', checked: i.checked, click: () => send(i.command) };
    });
    if (process.env['ELECTRON_RENDERER_URL']) console.log('[menu] popup');
    // Whatever the menu did to hover state, the next mouseenter on the pet turns click-through off again.
    Menu.buildFromTemplate(items).popup({ window: win, callback: () => win?.setIgnoreMouseEvents(true, { forward: true }) });
  });
  createWindow();
  createTray();
  // First launch only: Pakkun gets a moment to drop in before the welcome appears.
  const userPet = isPlainName(settings.petName) && (await loadPack(join(app.getPath('userData'), 'pets', settings.petName))) !== null;
  if (!app.isPackaged) process.on('SIGUSR2', () => onboarding.open(true)); // dev hook: the native menu can't be driven over CDP
  if (!settings.onboarded && !userPet) setTimeout(() => onboarding.open(false), 1500);
});

app.on('window-all-closed', () => app.quit());
