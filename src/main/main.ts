import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, powerMonitor, screen, Tray, type MenuItemConstructorOptions } from 'electron';
import { devRendererUrl } from './dev-url';
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
import { isPlainName, listLibrary, loadPack, packCandidates, pickPackDir } from './pack';
import { comeCommand } from '../overlay/call';
import { headCrop } from './head-crop';
import { addPet, MAX_PETS, petList, pickWindow, removePet, rekeyWins, routeReaction } from './pets';
import { setupOnboarding } from './onboarding';
import { setupOverload } from './overload';
import { commandToPatch, isSnoozed, wakeOnOpen, type Energy, type Prefs } from './prefs';
import { startScreenLoop } from './screen-loop';
import { setupScreenExplainer } from './screen-explainer';
import { setupKeyWindow } from './key-window';
import { setupTalkWindow } from './talk-window';
import { toOverlayPoint } from '../overlay/behavior';
import { getApiKey } from './secrets';
import { hideLockedByAdmin, loadSettings, saveSettings, voiceLockedByAdmin } from './settings';

const here = fileURLToPath(new URL('.', import.meta.url));
const wins = new Map<string, BrowserWindow>(); // one transparent overlay window per pet, keyed by folder slug
const senderSlug = new WeakMap<Electron.WebContents, string>();
const petSpecies = new Map<string, string>();
const petNames = new Map<string, string>(); // slug -> display name, learnt as each pack loads
const packEnergies = new Map<string, Energy>();
const primarySlug = (): string => petList(settings)[0]!;
/** The primary pet's window: screen reactions, voice and the debug panel go here. */
const primary = (): BrowserWindow | null => wins.get(primarySlug()) ?? null;
const allWins = (): BrowserWindow[] => [...wins.values()].filter((w) => !w.isDestroyed());
const winOf = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): BrowserWindow | undefined => pickWindow(wins, senderSlug.get(e.sender));
let tray: Tray | null = null;
let trayIcon: Electron.NativeImage | null = null; // the placeholder, used only while no pet's pack has loaded
let trayIconDim: Electron.NativeImage | null = null;
const petIcons = new Map<string, { icon: Electron.NativeImage; dim: Electron.NativeImage; avatar: string }>(); // slug -> its face for the menu bar and the chat
let lastFailure: { text: string; at: number } | null = null; // the sniffed failure, in memory only, for a hint the user asks for
let fakeScreen: ReturnType<typeof fakeReader> | undefined;
let debugOn = false; // "Show what <name> sees": not persisted, resets each launch
let talkSeq = 1_000_000; // above the screen loop's seq so the overlay never drops a reply as already seen
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
  // A crashed or hung page can't toggle click-through itself: until it recovers, nothing on screen may swallow clicks.
  for (const ev of ['render-process-gone', 'unresponsive'] as const) win.webContents.on(ev as 'render-process-gone', () => { if (!win.isDestroyed()) win.setIgnoreMouseEvents(true, { forward: true }); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (ev) => ev.preventDefault());
  senderSlug.set(win.webContents, slug);
  win.on('closed', () => { if (wins.get(slug) === win) wins.delete(slug); });

  const devUrl = devRendererUrl();
  // Dev rehearsal only: PIXY_CHATTY=1 makes the pet speak every ~5 s.
  const q = new URLSearchParams({ pet: slug });
  if (!app.isPackaged && process.env['PIXY_CHATTY'] === '1') q.set('chatty', '1');
  if (enterDrop) q.set('enter', 'drop');
  const search = `?${q.toString()}`;
  if (devUrl) void win.loadURL(`${devUrl}/overlay/index.html${search}`);
  else void win.loadFile(join(here, '../renderer/overlay/index.html'), { search });
}

const TRAY_H = 18;
// Snoozed = a faded icon. The bitmap is premultiplied BGRA, so every byte scales, not just alpha.
const fade = (px: Buffer, k: number): Buffer => Buffer.from(px.map((v) => Math.round(v * k)));

/** Colour icon with a 2x representation so it is crisp on Retina. */
function trayImage(src: Electron.NativeImage, k: number): Electron.NativeImage {
  const one = src.resize({ height: TRAY_H });
  const two = src.resize({ height: TRAY_H * 2 });
  const [a, b] = [one.getSize(), two.getSize()];
  const out = nativeImage.createFromBitmap(fade(one.toBitmap(), k), { width: a.width, height: a.height });
  out.addRepresentation({ scaleFactor: 2, width: b.width, height: b.height, buffer: fade(two.toBitmap(), k) });
  return out;
}

const AVATAR_PX = 128; // the chat shows the face at ~44 pt; 128 px stays sharp at 2x

/** A pet's face, cropped from the idle frame: menu-bar icons plus a larger copy for the chat. null when the frame can't be read. */
function petTrayIcons(dataUrl: string): { icon: Electron.NativeImage; dim: Electron.NativeImage; avatar: string } | null {
  const img = nativeImage.createFromDataURL(dataUrl);
  if (img.isEmpty()) return null;
  const { width, height } = img.getSize();
  const px = img.toBitmap();
  const r = headCrop(px.subarray(3), width, height, 4);
  if (!r) return null;
  const head = img.crop(r);
  return { icon: trayImage(head, 1), dim: trayImage(head, 0.35), avatar: head.resize({ width: AVATAR_PX, height: AVATAR_PX, quality: 'best' }).toDataURL() };
}

function createTray(): void {
  trayIcon = nativeImage
    .createFromPath(join(app.getAppPath(), 'assets/placeholder/pup.png'))
    .resize({ height: TRAY_H });
  trayIconDim = trayIcon;
  if (!trayIcon.isEmpty()) {
    const { width, height } = trayIcon.getSize();
    trayIconDim = nativeImage.createFromBitmap(fade(trayIcon.toBitmap(), 0.35), { width, height });
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
/** What the user called their pet (manifest), not the folder slug in settings. */
const hasKey = (): boolean => { try { return !!getApiKey(); } catch { return false; } };
const displayName = (): string => petNames.get(primarySlug()) ?? settings.petName; // the primary's own name, boosted as a speech keyword
const speciesOf = (): string | undefined => petSpecies.get(primarySlug()); // so Spark's lines suit the pet
const nameOf = (slug: string): string => petNames.get(slug) ?? slug;
let wakeTimer: NodeJS.Timeout | undefined;
let onboarding: ReturnType<typeof setupOnboarding>;
let overload: ReturnType<typeof setupOverload> | undefined;
let screenExplainer: ReturnType<typeof setupScreenExplainer>;
let voiceExplainer: ReturnType<typeof setupScreenExplainer>;
let keyWin: ReturnType<typeof setupKeyWindow> | undefined;
let voice: ReturnType<typeof createVoiceSession>;
let talk: ReturnType<typeof setupTalkWindow>;
let micWin: ReturnType<typeof setupMic>;
let fakeTranscript: string | undefined; // dev only: stands in for Meta's speech model when there is no key

const snoozed = (): boolean => isSnoozed(settings.snoozeUntil, Date.now());
const prefs = (s = snoozed(), slug = primarySlug()): Prefs => ({ size: settings.size, energy: settings.energy ?? packEnergies.get(slug) ?? 'normal', snoozed: s });
let library: { slug: string; name: string }[] = [];
const menuPets = (): { slug: string; name: string }[] => petList(settings).map((slug) => ({ slug, name: nameOf(slug) }));
const ACTIVATE_GRACE_MS = 2000;
const MAX_TIMER = 2 ** 31 - 1; // setTimeout wraps to 1 ms above this
// The checkbox shows what macOS says (the user can change it in System Settings); dev has no real login item.
const loginOn = (): boolean => (app.isPackaged ? app.getLoginItemSettings().openAtLogin : settings.openAtLogin);

/** Apply every effect of the current settings; the one place main reacts to a change. */
/** Replace-mode onboarding changes the primary's slug: its window moves to the new key instead of being orphaned. */
function rekeyPrimary(): void {
  for (const [from, to] of rekeyWins(wins, petList(settings))) {
    const w = wins.get(from)!;
    wins.delete(from);
    wins.set(to, w);
    senderSlug.set(w.webContents, to);
    for (const m of [petNames, petSpecies, petIcons, packEnergies] as Map<string, unknown>[]) m.delete(from);
  }
}

function sync(): void {
  rekeyPrimary();
  const s = snoozed();
  for (const [slug, w] of wins) if (!w.isDestroyed()) { w.webContents.send(IPC.prefs, prefs(s, slug)); w.setContentProtection(settings.hideInShares); }
  onboarding.applyProtection();
  talk?.applyProtection();
  keyWin?.applyProtection();
  clearTimeout(wakeTimer);
  // Expiry is computed (snoozed() turns false by itself), so the timer only re-syncs; nothing to write.
  if (s) wakeTimer = setTimeout(sync, Math.min(MAX_TIMER, Math.max(0, (settings.snoozeUntil ?? 0) - Date.now()) + 50));
  const listen = shouldRegister(settings, s);
  // Re-read the admin file on every press: an admin who turns voice off blocks the next one and the shortcut goes away.
  syncShortcut(globalShortcut, listen, () => { settings = loadSettings(); sync(); voice.press(); });
  if (listen) micWin.warm();
  else { voice.abort(); micWin.close(); }
  const mine = petIcons.get(primarySlug());
  tray?.setImage((s ? (mine?.dim ?? trayIconDim) : (mine?.icon ?? trayIcon)) ?? nativeImage.createEmpty());
  tray?.setToolTip(`PixyPup \u00b7 ${nameOf(primarySlug())}`);
  tray?.setContextMenu(Menu.buildFromTemplate(toNative(trayMenuTemplate({ snoozed: s, name: displayName(), overload: overload?.active(), pets: menuPets(), library, hasKey: hasKey() }), run)));
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
  if (cmd === 'key') { keyWin?.open(); return; }
  if (cmd === 'talk') {
    if (snoozed()) run('wake');
    talk.open();
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
  if (cmd.startsWith('library:')) {
    const slug = cmd.slice(8);
    if (library.some((l) => l.slug === slug)) { if (snoozed()) run('wake'); joinPet(slug); }
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
  else {
    const dest = from && !from.isDestroyed() ? from : primary();
    // "Come here" goes to the pointer, in the coordinates of the window that owns the pet.
    dest?.webContents.send(IPC.command, cmd === 'come' && dest ? comeCommand(screen.getCursorScreenPoint().x, dest.getBounds().x) : cmd);
  }
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
  petIcons.delete(slug);
  petNames.delete(slug);
  petSpecies.delete(slug);
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
      return key ? await sniffBubble(openClient('screen', loadSettings(), key), input.failureLine, signal, speciesOf()) : null;
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
      return (await fixHint(openClient('screen', loadSettings(), key), f, AbortSignal.timeout(15_000), speciesOf()))?.hint ?? null;
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
    command: (c) => run(c),
    prefill: (text) => talk.prefill(text),
    heard: (text) => { if (debugOn) primary()?.webContents.send(IPC.debug, { on: true, name: displayName(), heard: text }); },
  });
}

/** Dev only: answers with a fixed transcript once the audio ends, like a real PUSH_TO_TALK session. */
async function fakeVoice(text: string, onTranscript: (t: { text: string; final: boolean }) => void): Promise<Transcription> {
  return { push: () => undefined, close: () => undefined, end: async () => { onTranscript({ text, final: true }); } };
}

app.dock?.hide();

void app.whenReady().then(async () => {
  onboarding = setupOnboarding({ getOverlay: primary, addPet: joinPet, getPets: () => petList(settings), onSettingsChanged: () => { settings = loadSettings(); sync(); }, getPetName: () => settings.petName, getHideInShares: () => settings.hideInShares, beforeReveal: () => { if (snoozed()) run('wake'); } });
  overload = setupOverload({ hideInShares: () => settings.hideInShares, onChange: sync });
  screenExplainer = setupScreenExplainer({ getHideInShares: () => settings.hideInShares });
  voiceExplainer = setupScreenExplainer({ getHideInShares: () => settings.hideInShares, kind: 'voice' });
  keyWin = setupKeyWindow({ name: displayName, settings: loadSettings, getHideInShares: () => settings.hideInShares, onSaved: sync });
  talk = setupTalkWindow({
    name: displayName,
    species: speciesOf,
    key: getApiKey,
    settings: loadSettings,
    getHideInShares: () => settings.hideInShares,
    avatar: () => petIcons.get(primarySlug())?.avatar,
    // The reply moves the pet beside the chat window; a snoozed pet stays asleep.
    act: (r, b) => {
      const w = primary();
      if (!w || snoozed()) return;
      const wb = w.getBounds();
      w.webContents.send(IPC.behavior, { seq: ++talkSeq, action: 'talk', mood: r.action, crisis: r.crisis, bubble: r.crisis ? undefined : r.woof, target: toOverlayPoint({ x: b.x, y: b.y + b.height }, wb), reason: 'talk' });
    },
  });
  startVoice();
  ipcMain.handle(IPC.getPack, async (ev) => {
    const slug = senderSlug.get(ev.sender) ?? primarySlug();
    const dev = app.isPackaged ? undefined : process.env['PIXY_PACK_DIR'];
    if (dev) return loadPack(isAbsolute(dev) ? dev : resolve(dev));
    const candidates = packCandidates(slug, join(app.getPath('userData'), 'pets'), join(app.getAppPath(), 'assets/pets'));
    const dir = await pickPackDir(candidates, async (d) => (await loadPack(d)) !== null);
    const pack = dir && (await loadPack(dir));
    if (!pack) { // a reload that finds nothing must not leave the old name, species or face behind
      petNames.delete(slug);
      petSpecies.delete(slug);
      petIcons.delete(slug);
    } else {
      petNames.set(slug, pack.manifest.pet);
      petSpecies.set(slug, pack.manifest.species);
      const idle = pack.frames[pack.manifest.poses['idle']?.frames[0] ?? ''];
      const icons = idle ? petTrayIcons(idle) : null;
      if (icons) petIcons.set(slug, icons);
      else petIcons.delete(slug);
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
    const items = toNative(petMenuTemplate({ stay, snoozed: snoozed(), size: settings.size, energy: prefs().energy, hideInShares: settings.hideInShares, hideLocked: hideLockedByAdmin(), screenAware: settings.screenAware, screenLocked: settings.adminDisableScreenAware, voice: settings.voice, voiceLocked: voiceLockedByAdmin(), openAtLogin: loginOn(), debug: debugOn, overload: overload?.active(), pets: menuPets(), library, name: displayName(), hasKey: hasKey() }), (c) => run(c, win));
    if (devRendererUrl()) console.log('[menu] popup');
    // Whatever the menu did to hover state, the next mouseenter on the pet turns click-through off again.
    Menu.buildFromTemplate(items).popup({ window: win, callback: () => { if (!win.isDestroyed()) win.setIgnoreMouseEvents(true, { forward: true }); } });
  });
  library = await listLibrary(join(app.getAppPath(), 'assets/pets'));
  for (const slug of petList(settings)) createWindow(slug);
  // A window keeps the work area it was born with; the Dock showing, moving or resizing (or a display change) must move every pet's floor too.
  // macOS doesn't always report a Dock change, so a cheap 2 s check backs up the display events.
  const refit = (): void => {
    const b = screen.getPrimaryDisplay().workArea;
    for (const w of wins.values()) {
      const c = w.isDestroyed() ? b : w.getBounds();
      if (c.x !== b.x || c.y !== b.y || c.width !== b.width || c.height !== b.height) w.setBounds(b);
    }
  };
  for (const ev of ['display-metrics-changed', 'display-added', 'display-removed'] as const) screen.on(ev as 'display-added', refit);
  setInterval(refit, 2000).unref();
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
  // First launch only: Kuma gets a moment to drop in before the welcome appears.
  const userPet = isPlainName(settings.petName) && (await loadPack(join(app.getPath('userData'), 'pets', settings.petName))) !== null;
  if (!app.isPackaged) process.on('SIGUSR2', () => onboarding.open(true)); // dev hook: the native menu can't be driven over CDP
  if (!settings.onboarded && !userPet) setTimeout(() => onboarding.open(false), 1500);
});

app.on('will-quit', () => { voice?.abort(); globalShortcut.unregisterAll(); });
app.on('window-all-closed', () => app.quit());
