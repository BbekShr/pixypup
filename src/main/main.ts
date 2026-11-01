import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, powerMonitor, screen, Tray, type MenuItemConstructorOptions } from 'electron';
import { execFile } from 'node:child_process';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openClient } from '../api/gate';
import { openVoice, type Transcription } from '../api/voice';
import { sniffBubble } from '../api/sniff-bubble';
import { fixHint } from '../api/fix-hint';
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
import { addPet, MAX_PETS, petList, pickWindow, removePet, routeReaction } from './pets';
import { setupOnboarding } from './onboarding';
import { setupOverload } from './overload';
import { commandToPatch, isSnoozed, wakeOnOpen, type Energy, type Prefs } from './prefs';
import { startScreenLoop } from './screen-loop';
import { setupScreenExplainer } from './screen-explainer';
import { getApiKey } from './secrets';
import { hideLockedByAdmin, loadSettings, saveSettings, voiceLockedByAdmin } from './settings';

const here = fileURLToPath(new URL('.', import.meta.url));
const wins = new Map<string, BrowserWindow>(); // one transparent overlay window per pet, keyed by folder slug
const senderSlug = new WeakMap<Electron.WebContents, string>();
const petNames = new Map<string, string>(); // slug -> display name, learnt as each pack loads
const packEnergies = new Map<string, Energy>();
const primarySlug = (): string => petList(settings)[0]!;
/** The primary pet's window: screen reactions, voice and the debug panel go here. */
const primary = (): BrowserWindow | null => wins.get(primarySlug()) ?? null;
const allWins = (): BrowserWindow[] => [...wins.values()].filter((w) => !w.isDestroyed());
const winOf = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): BrowserWindow | undefined => pickWindow(wins, senderSlug.get(e.sender));
let tray: Tray | null = null;
let trayIcon: Electron.NativeImage | null = null;
let trayIconDim: Electron.NativeImage | null = null;
let lastFailure: { text: string; at: number } | null = null; // the sniffed failure, in memory only, for a hint the user asks for
let fakeScreen: ReturnType<typeof fakeReader> | undefined;
let debugOn = false; // "Show what <name> sees": not persisted, resets each launch
let stay = false; // mirrors the overlay's stay flag for the menu checkbox; not persisted

function createWindow(slug: string, enterDrop = false): void {
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
  const win = new BrowserWindow({
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
  win.setIgnoreMouseEvents(true, { forward: true }); // every pet window starts, and after any menu returns to, click-through
  win.setContentProtection(settings.hideInShares);
  wins.set(slug, win);
  senderSlug.set(win.webContents, slug);
  win.on('closed', () => { if (wins.get(slug) === win) wins.delete(slug); });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  // Dev rehearsal only: PIXY_CHATTY=1 makes the pet speak every ~5 s.
  const q = new URLSearchParams({ pet: slug });
  if (!app.isPackaged && process.env['PIXY_CHATTY'] === '1') q.set('chatty', '1');
  if (enterDrop) q.set('enter', 'drop');
  const search = `?${q.toString()}`;
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
let packSpecies: string | undefined; // the loaded pet's species, so Spark's lines suit it
let packPetName: string | undefined; // the loaded pet's display name, boosted as a speech keyword
/** What the user called their pet (manifest), not the folder slug in settings. */
const displayName = (): string => packPetName ?? settings.petName;
const nameOf = (slug: string): string => petNames.get(slug) ?? slug;
let wakeTimer: NodeJS.Timeout | undefined;
let onboarding: ReturnType<typeof setupOnboarding>;
let overload: ReturnType<typeof setupOverload> | undefined;
let screenExplainer: ReturnType<typeof setupScreenExplainer>;
let voiceExplainer: ReturnType<typeof setupScreenExplainer>;
let voice: ReturnType<typeof createVoiceSession>;
let micWin: ReturnType<typeof setupMic>;
let fakeTranscript: string | undefined; // dev only: stands in for Meta's speech model when there is no key

const snoozed = (): boolean => isSnoozed(settings.snoozeUntil, Date.now());
const prefs = (s = snoozed(), slug = primarySlug()): Prefs => ({ size: settings.size, energy: settings.energy ?? packEnergies.get(slug) ?? 'normal', snoozed: s });
const menuPets = (): { slug: string; name: string }[] => petList(settings).map((slug) => ({ slug, name: nameOf(slug) }));
const ACTIVATE_GRACE_MS = 2000;
const MAX_TIMER = 2 ** 31 - 1; // setTimeout wraps to 1 ms above this
// The checkbox shows what macOS says (the user can change it in System Settings); dev has no real login item.
const loginOn = (): boolean => (app.isPackaged ? app.getLoginItemSettings().openAtLogin : settings.openAtLogin);

/** Apply every effect of the current settings; the one place main reacts to a change. */
function sync(): void {
  const s = snoozed();
  for (const [slug, w] of wins) if (!w.isDestroyed()) { w.webContents.send(IPC.prefs, prefs(s, slug)); w.setContentProtection(settings.hideInShares); }
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
  tray?.setContextMenu(Menu.buildFromTemplate(toNative(trayMenuTemplate({ snoozed: s, name: displayName(), overload: overload?.active(), pets: menuPets() }), run)));
}

/** Menu, tray and the dev hook all land here; only main writes settings. */
function run(cmd: string, from?: BrowserWindow): void {
  if (cmd === 'overload') { void overload?.start(); return; }
  if (cmd === 'overload:end') { overload?.stop(); return; }
  if (cmd === 'stay' || cmd === 'wander') stay = cmd === 'stay';
  if (cmd === 'debug:on' || cmd === 'debug:off') {
    debugOn = cmd === 'debug:on';
    primary()?.webContents.send(IPC.debug, { on: debugOn, name: displayName() });
    return;
  }
  if (cmd === 'new-pet') {
    if (petList(settings).length >= MAX_PETS) {
      void dialog.showMessageBox({ type: 'info', message: 'Four pets is a full house!', detail: 'Send one home first (right-click a pet, "Send … home"), then add another.' });
      return;
    }
    if (snoozed()) run('wake');
    onboarding.open(true, true);
    return;
  }
  if (cmd.startsWith('home:')) return sendHome(cmd.slice(5));
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
  if (!app.isPackaged && cmd.startsWith('screen:fake:')) { fakeScreen?.set(cmd === 'screen:fake:pass'); return; } // dev: flip the scripted terminal
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
  } else if (cmd === 'stay' || cmd === 'wander') for (const w of allWins()) w.webContents.send(IPC.command, cmd);
  else (from && !from.isDestroyed() ? from : primary())?.webContents.send(IPC.command, cmd);
}

/** A pet made in add mode: it joins the list and drops in. */
function joinPet(slug: string): void {
  const next = addPet(petList(settings), slug);
  if (!next) return;
  try {
    saveSettings({ pets: next });
  } catch {
    console.warn('PixyPup: could not save the pet list');
  }
  settings = loadSettings();
  createWindow(slug, true);
  sync();
}

function sendHome(slug: string): void {
  const next = removePet(petList(settings), slug);
  if (!next) return;
  try {
    saveSettings({ pets: next, petName: next[0] });
  } catch {
    console.warn('PixyPup: could not save the pet list');
  }
  settings = loadSettings();
  const w = wins.get(slug);
  wins.delete(slug);
  w?.destroy();
  sync();
}

// Runs from launch but does nothing (no osascript, no helper, no network) until screen-aware is on and allowed.
function startScreenAwareLoop(): void {
  const osa = (args: string[], timeoutMs: number): Promise<string | null> =>
    new Promise((res) => execFile('osascript', args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, out) => res(err ? null : out)));
  const fake = !app.isPackaged && process.env['PIXY_FAKE_SCREEN'] === '1';
  if (fake) fakeScreen = fakeReader(screen.getPrimaryDisplay().workArea);
  const reader = fakeScreen ?? createScreenReader({ run: makeRun(helperPath()), osa });
  // Without a key, or when the gate says no, Spark is skipped and the decider falls back to its own bubbles.
  const spark = async (input: { failureLine: string }, signal?: AbortSignal): Promise<{ bubble: string } | null> => {
    try {
      const key = getApiKey();
      return key ? await sniffBubble(openClient('screen', loadSettings(), key), input.failureLine, signal, packSpecies) : null;
    } catch {
      return null;
    }
  };
  startScreenLoop({
    getSettings: () => settings,
    isSnoozed: snoozed,
    overlay: { bounds: () => primary()?.getBounds() ?? null, send: (b) => { for (const [slug, m] of routeReaction(petList(settings), b)) wins.get(slug)?.webContents.send(IPC.behavior, m); } },
    reader,
    decider: createDecider({ spark }),
    onFailure: (text) => { lastFailure = text ? { text, at: Date.now() } : null; },
    canHint: () => fake || !!getApiKey(),
    debug: { on: () => debugOn, send: (info) => primary()?.webContents.send(IPC.debug, { on: true, name: displayName(), info }) },
  });
}

const HINT_TTL_MS = 5 * 60_000;
let hintCall: Promise<string | null> | null = null;
// Only on a click after a sniff, only while "Notice my screen" is allowed (the gate throws otherwise).
function askHint(): Promise<string | null> {
  hintCall ??= (async () => {
    const f = lastFailure && Date.now() - lastFailure.at < HINT_TTL_MS ? lastFailure.text : null;
    if (!f) return null;
    const key = getApiKey();
    if (!key) return fakeScreen ? 'Rehearsal hint: add(2, 2) returns 4, but the test in demo/math.test.ts expects 5.' : null;
    try {
      return (await fixHint(openClient('screen', loadSettings(), key), f, AbortSignal.timeout(15_000), packSpecies))?.hint ?? null;
    } catch {
      return null;
    }
  })().finally(() => { hintCall = null; });
  return hintCall;
}

function startVoice(): void {
  const tell = (m: VoiceUi): void => { primary()?.webContents.send(IPC.voice, m); };
  micWin = setupMic({ onChunk: (b) => voice.chunk(b), fake: app.isPackaged ? undefined : fakeMicPcm(process.env['PIXY_FAKE_MIC']) });
  voice = createVoiceSession({
    allowed: () => shouldRegister(loadSettings(), snoozed()),
    key: () => (fakeTranscript !== undefined ? 'fake' : getApiKey()),
    petName: () => displayName(),
    open: (key, opts) => (fakeTranscript !== undefined ? fakeVoice(fakeTranscript, opts.onTranscript) : openVoice(loadSettings(), key, { ...opts, keywords: [displayName()] })),
    mic: micWin,
    ui: tell,
    command: (c) => primary()?.webContents.send(IPC.command, c),
    heard: (text) => { if (debugOn) primary()?.webContents.send(IPC.debug, { on: true, name: displayName(), heard: text }); },
  });
}

/** Dev only: answers with a fixed transcript once the audio ends, like a real PUSH_TO_TALK session. */
async function fakeVoice(text: string, onTranscript: (t: { text: string; final: boolean }) => void): Promise<Transcription> {
  return { push: () => undefined, close: () => undefined, end: async () => { onTranscript({ text, final: true }); } };
}

app.dock?.hide();

void app.whenReady().then(async () => {
  onboarding = setupOnboarding({ getOverlay: primary, addPet: joinPet, onSettingsChanged: () => { settings = loadSettings(); sync(); }, getPetName: () => settings.petName, getHideInShares: () => settings.hideInShares, beforeReveal: () => { if (snoozed()) run('wake'); } });
  overload = setupOverload({ hideInShares: () => settings.hideInShares, onChange: sync });
  screenExplainer = setupScreenExplainer({ getHideInShares: () => settings.hideInShares });
  voiceExplainer = setupScreenExplainer({ getHideInShares: () => settings.hideInShares, kind: 'voice' });
  startVoice();
  ipcMain.handle(IPC.getPack, async (ev) => {
    const slug = senderSlug.get(ev.sender) ?? primarySlug();
    const dev = app.isPackaged ? undefined : process.env['PIXY_PACK_DIR'];
    if (dev) return loadPack(isAbsolute(dev) ? dev : resolve(dev));
    const candidates = [join(app.getAppPath(), 'assets/pets/Pakkun')];
    if (isPlainName(slug)) candidates.unshift(join(app.getPath('userData'), 'pets', slug));
    const dir = await pickPackDir(candidates, async (d) => (await loadPack(d)) !== null);
    const pack = dir && (await loadPack(dir));
    if (pack) petNames.set(slug, pack.manifest.pet);
    if (slug === primarySlug()) {
      packPetName = pack ? pack.manifest.pet : undefined;
      packSpecies = pack ? pack.manifest.species : undefined;
    }
    const e = pack ? pack.manifest.personality?.energy : undefined;
    if (e !== packEnergies.get(slug)) {
      if (e) packEnergies.set(slug, e);
      else packEnergies.delete(slug);
      wins.get(slug)?.webContents.send(IPC.prefs, prefs(snoozed(), slug));
    }
    if (pack) sync(); // the menus name the pets
    return pack;
  });
  ipcMain.handle(IPC.getPrefs, (ev) => prefs(snoozed(), senderSlug.get(ev.sender)));
  ipcMain.handle(IPC.askHint, () => (snoozed() ? null : askHint()));
  if (!app.isPackaged) ipcMain.on(IPC.devCmd, (_e, cmd: unknown) => { if (typeof cmd === 'string') run(cmd); }); // CDP can't click native menus
  ipcMain.handle(IPC.getStay, () => stay);
  ipcMain.on(IPC.setClickThrough, (e, on: boolean) => {
    winOf(e)?.setIgnoreMouseEvents(on, { forward: true });
  });
  ipcMain.on(IPC.showMenu, (e) => {
    const win = winOf(e);
    if (!win) return;
    const items = toNative(petMenuTemplate({ stay, snoozed: snoozed(), size: settings.size, energy: prefs().energy, hideInShares: settings.hideInShares, hideLocked: hideLockedByAdmin(), screenAware: settings.screenAware, screenLocked: settings.adminDisableScreenAware, voice: settings.voice, voiceLocked: voiceLockedByAdmin(), openAtLogin: loginOn(), debug: debugOn, overload: overload?.active(), pets: menuPets(), name: displayName() }), (c) => run(c, win));
    if (process.env['ELECTRON_RENDERER_URL']) console.log('[menu] popup');
    // Whatever the menu did to hover state, the next mouseenter on the pet turns click-through off again.
    Menu.buildFromTemplate(items).popup({ window: win, callback: () => { if (!win.isDestroyed()) win.setIgnoreMouseEvents(true, { forward: true }); } });
  });
  for (const slug of petList(settings)) createWindow(slug);
  createTray();
  const atLogin = app.isPackaged && app.getLoginItemSettings().wasOpenedAtLogin === true;
  if (wakeOnOpen(snoozed(), atLogin)) run('wake'); // run syncs
  else sync();
  // Opening the app again while it runs (Finder, Spotlight, Launchpad) arrives as 'activate'; the launch's own
  // 'activate' falls inside the grace and was handled just above.
  const openedAt = Date.now();
  app.on('activate', () => { if (Date.now() - openedAt > ACTIVATE_GRACE_MS && wakeOnOpen(snoozed(), false)) run('wake'); });
  startScreenAwareLoop();
  powerMonitor.on('resume', sync); // timers pause while the Mac sleeps
  // First launch only: Pakkun gets a moment to drop in before the welcome appears.
  const userPet = isPlainName(settings.petName) && (await loadPack(join(app.getPath('userData'), 'pets', settings.petName))) !== null;
  if (!app.isPackaged) process.on('SIGUSR2', () => onboarding.open(true)); // dev hook: the native menu can't be driven over CDP
  if (!settings.onboarded && !userPet) setTimeout(() => onboarding.open(false), 1500);
});

app.on('will-quit', () => { voice?.abort(); globalShortcut.unregisterAll(); });
app.on('window-all-closed', () => app.quit());
