import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IPC } from './ipc';
import { loadSettings } from './settings';

const here = fileURLToPath(new URL('.', import.meta.url));
let win: BrowserWindow | null = null;
let tray: Tray | null = null;

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
  if (devUrl) void win.loadURL(`${devUrl}/overlay/index.html`);
  else void win.loadFile(join(here, '../renderer/overlay/index.html'));
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

void app.whenReady().then(() => {
  loadSettings(); // TODO(F1): feed settings to feature gates
  ipcMain.on(IPC.setClickThrough, (_e, on: boolean) => {
    win?.setIgnoreMouseEvents(on, { forward: true });
  });
  createWindow();
  createTray();
});

app.on('window-all-closed', () => app.quit());
