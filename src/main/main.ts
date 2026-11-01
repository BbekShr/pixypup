import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, powerMonitor, screen, Tray, type MenuItemConstructorOptions } from 'electron';
import { execFile } from 'node:child_process';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openClient } from '../api/gate';
import { openVoice, type Transcription } from '../api/voice';
import { sniffBubble } from '../api/sniff-bubble';
import { createDecider } from '../screen/decide';
import { makeRun } from '../screen/helper';
import { createScreenReader } from '../screen/reader';
import { fakeReader } from './fake-screen';
import { helperPath } from './helper-path';
import { fakeMicPcm, setupMic } from './mic';
import { createVoiceSession, type VoiceUi } from './voice-session';
import { shouldRegister, syncShortcut } from '../voice/listen';
import { IPC } from './ipc';
import { petMenuTemplate, trayMenuTemplate, type MenuItem } from './menu';
import { isPlainName, loadPack, pickPackDir } from './pack';
import { setupOnboarding } from './onboarding';
import { commandToPatch, isSnoozed, type Energy, type Prefs } from './prefs';
import { startScreenLoop } from './screen-loop';
import { setupScreenExplainer } from './screen-explainer';
import { getApiKey } from './secrets';
import { hideLockedByAdmin, loadSettings, saveSettings, voiceLockedByAdmin } from './settings';

const here = fileURLToPath(new URL('.', import.meta.url));
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let trayIcon: Electron.NativeImage | null = null;
let trayIconDim: Electron.NativeImage | null = null;
let debugOn = false; // "Show what <name> sees": not persisted, resets each launch
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
    const enabled = i.enabled === false ? { enabled: false } : {};
    if (i.radio) return { label: i.label, type: 'radio', checked: i.checked, click, ...enabled };
    return i.checked === undefined ? { label: i.label, click, ...enabled } : { label: i.label, type: 'checkbox', checked: i.checked, click, ...enabled };
  });
}

let settings = loadSettings(); // TODO(F1): feed settings to feature gates
let packEnergy: Energy | undefined; // the loaded pet's own personality.energy
let packPetName: string | undefined; // the loaded pet's display name, boosted as a speech keyword
/** What the user called their pet (manifest), not the folder slug in settings. */
const displayName = (): string => packPetName ?? settings.petName;
let wakeTimer: NodeJS.Timeout | undefined;
let onboarding: ReturnType<typeof setupOnboarding>;
let screenExplainer: ReturnType<typeof setupScreenExplainer>;
let voiceExplainer: ReturnType<typeof setupScreenExplainer>;
let voice: ReturnType<typeof createVoiceSession>;
let micWin: ReturnType<typeof setupMic>;
let fakeTranscript: string | undefined; // dev only: stands in for Meta's speech model when there is no key

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
  const listen = shouldRegister(settings, s);
  // Re-read the admin file on every press: an admin who turns voice off blocks the next one and the shortcut goes away.
  syncShortcut(globalShortcut, listen, () => { settings = loadSettings(); sync(); voice.press(); });
  if (listen) micWin.warm();
  else { voice.abort(); micWin.close(); }
  tray?.setImage((s ? trayIconDim : trayIcon) ?? nativeImage.createEmpty());
  tray?.setContextMenu(Menu.buildFromTemplate(toNative(trayMenuTemplate({ snoozed: s, name: displayName() }), run)));
}

/** Menu, tray and the dev hook all land here; only main writes settings. */
function run(cmd: string): void {
  if (cmd === 'stay' || cmd === 'wander') stay = cmd === 'stay';
  if (cmd === 'debug:on' || cmd === 'debug:off') {
    debugOn = cmd === 'debug:on';
    win?.webContents.send(IPC.debug, { on: debugOn, name: displayName() });
    return;
  }
  if (cmd === 'new-pet') {
    if (snoozed()) run('wake');
    onboarding.open(true);
    return;
  }
  if (cmd === 'screen:on') {
    // The explainer is the consent: nothing reads the screen (or asks macOS for Terminal access) before "Turn it on".
    if (!settings.adminDisableScreenAware) void screenExplainer.ask(displayName()).then((yes) => { if (yes) run('screen:yes'); });
    return;
  }
  if (cmd === 'voice:on') {
    // Same consent rule as the screen: nothing listens, and macOS is never asked for the mic, before "Turn it on".
    if (!voiceLockedByAdmin()) void voiceExplainer.ask(displayName()).then((yes) => { if (yes) run('voice:yes'); });
    return;
  }
  if (!app.isPackaged && cmd === 'voice:listen') return voice.press(); // dev hook: globalShortcut can't be pressed over CDP
  if (!app.isPackaged && cmd.startsWith('voice:fake:')) { fakeTranscript = cmd.slice(11); return; }
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

// Runs from launch but does nothing (no osascript, no helper, no network) until screen-aware is on and allowed.
function startScreenAwareLoop(): void {
  const osa = (args: string[], timeoutMs: number): Promise<string | null> =>
    new Promise((res) => execFile('osascript', args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, out) => res(err ? null : out)));
  const reader = !app.isPackaged && process.env['PIXY_FAKE_SCREEN'] === '1'
    ? fakeReader(screen.getPrimaryDisplay().workArea)
    : createScreenReader({ run: makeRun(helperPath()), osa });
  // Without a key, or when the gate says no, Spark is skipped and the decider falls back to its own bubbles.
  const spark = async (input: { failureLine: string }, signal?: AbortSignal): Promise<{ bubble: string } | null> => {
    try {
      const key = getApiKey();
      return key ? await sniffBubble(openClient('screen', loadSettings(), key), input.failureLine, signal) : null;
    } catch {
      return null;
    }
  };
  startScreenLoop({
    getSettings: () => settings,
    isSnoozed: snoozed,
    overlay: { bounds: () => win?.getBounds() ?? null, send: (b) => win?.webContents.send(IPC.behavior, b) },
    reader,
    decider: createDecider({ spark }),
    debug: { on: () => debugOn, send: (info) => win?.webContents.send(IPC.debug, { on: true, name: displayName(), info }) },
  });
}

function startVoice(): void {
  const tell = (m: VoiceUi): void => { win?.webContents.send(IPC.voice, m); };
  micWin = setupMic({ onChunk: (b) => voice.chunk(b), fake: app.isPackaged ? undefined : fakeMicPcm(process.env['PIXY_FAKE_MIC']) });
  voice = createVoiceSession({
    allowed: () => shouldRegister(loadSettings(), snoozed()),
    key: () => (fakeTranscript !== undefined ? 'fake' : getApiKey()),
    petName: () => displayName(),
    open: (key, opts) => (fakeTranscript !== undefined ? fakeVoice(fakeTranscript, opts.onTranscript) : openVoice(loadSettings(), key, { ...opts, keywords: [displayName()] })),
    mic: micWin,
    ui: tell,
    command: (c) => win?.webContents.send(IPC.command, c),
    heard: (text) => { if (debugOn) win?.webContents.send(IPC.debug, { on: true, name: displayName(), heard: text }); },
  });
}

/** Dev only: answers with a fixed transcript once the audio ends, like a real PUSH_TO_TALK session. */
async function fakeVoice(text: string, onTranscript: (t: { text: string; final: boolean }) => void): Promise<Transcription> {
  return { push: () => undefined, close: () => undefined, end: async () => { onTranscript({ text, final: true }); } };
}

app.dock?.hide();

void app.whenReady().then(async () => {
  onboarding = setupOnboarding({ getOverlay: () => win, onSettingsChanged: () => { settings = loadSettings(); sync(); }, getPetName: () => settings.petName, getHideInShares: () => settings.hideInShares, beforeReveal: () => { if (snoozed()) run('wake'); } });
  screenExplainer = setupScreenExplainer({ getHideInShares: () => settings.hideInShares });
  voiceExplainer = setupScreenExplainer({ getHideInShares: () => settings.hideInShares, kind: 'voice' });
  startVoice();
  ipcMain.handle(IPC.getPack, async () => {
    const dev = app.isPackaged ? undefined : process.env['PIXY_PACK_DIR'];
    if (dev) return loadPack(isAbsolute(dev) ? dev : resolve(dev));
    const candidates = [join(app.getAppPath(), 'assets/pets/Pakkun')];
    if (isPlainName(settings.petName)) candidates.unshift(join(app.getPath('userData'), 'pets', settings.petName));
    const dir = await pickPackDir(candidates, async (d) => (await loadPack(d)) !== null);
    const pack = dir && (await loadPack(dir));
    packPetName = pack ? pack.manifest.pet : undefined;
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
    const items = toNative(petMenuTemplate({ stay, snoozed: snoozed(), size: settings.size, energy: prefs().energy, hideInShares: settings.hideInShares, hideLocked: hideLockedByAdmin(), screenAware: settings.screenAware, screenLocked: settings.adminDisableScreenAware, voice: settings.voice, voiceLocked: voiceLockedByAdmin(), openAtLogin: loginOn(), debug: debugOn, name: displayName() }), run);
    if (process.env['ELECTRON_RENDERER_URL']) console.log('[menu] popup');
    // Whatever the menu did to hover state, the next mouseenter on the pet turns click-through off again.
    Menu.buildFromTemplate(items).popup({ window: win, callback: () => win?.setIgnoreMouseEvents(true, { forward: true }) });
  });
  createWindow();
  createTray();
  sync();
  startScreenAwareLoop();
  powerMonitor.on('resume', sync); // timers pause while the Mac sleeps
  // First launch only: Pakkun gets a moment to drop in before the welcome appears.
  const userPet = isPlainName(settings.petName) && (await loadPack(join(app.getPath('userData'), 'pets', settings.petName))) !== null;
  if (!app.isPackaged) process.on('SIGUSR2', () => onboarding.open(true)); // dev hook: the native menu can't be driven over CDP
  if (!settings.onboarded && !userPet) setTimeout(() => onboarding.open(false), 1500);
});

app.on('will-quit', () => { voice?.abort(); globalShortcut.unregisterAll(); });
app.on('window-all-closed', () => app.quit());
