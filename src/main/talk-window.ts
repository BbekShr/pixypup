import { BrowserWindow, ipcMain, screen } from 'electron';
import { devRendererUrl } from './dev-url';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openClient } from '../api/gate';
import { isCrisis, localReply, MAX_USER, petTalk, type TalkReply, type Turn } from '../api/pet-talk';
import type { Settings } from './settings';
import { IPC } from './ipc';
import { settleReply } from './talk-history';
import { voiceLockedByAdmin } from './settings';

const here = fileURLToPath(new URL('.', import.meta.url));
const W = 380;
const H = 460;

export interface TalkDeps {
  name(): string;
  species(): string | undefined;
  key(): string | undefined;
  settings(): Settings;
  getHideInShares(): boolean;
  avatar(): string | undefined;
  act(reply: TalkReply, bounds: Electron.Rectangle): void;
  openKey(): void;
}

/**
 * The chat window. Nothing is sent anywhere until the human presses Send (a voice sentence is only typed in for you); what is
 * said lives in this closure until the window closes and is never logged or written.
 */
export function setupTalkWindow(d: TalkDeps): { open(): void; prefill(text: string): void; applyProtection(): void } {
  let win: BrowserWindow | null = null;
  let history: Turn[] = [];
  let localTurns = 0; // keyless replies given in this chat: they cycle instead of repeating
  let ctl = new AbortController(); // per window: closing the chat cancels what is still in flight
  const mine = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean => !!win && !win.isDestroyed() && e.sender === win.webContents;

  async function reply(raw: string): Promise<TalkReply> {
    const text = raw.slice(0, MAX_USER);
    const session = win;
    const signal = AbortSignal.any([ctl.signal, AbortSignal.timeout(15_000)]);
    let r: TalkReply | null = null;
    if (isCrisis(text)) r = { ...localReply(text, d.species()), action: 'listen', crisis: true }; // never leaves the machine
    else {
      try {
        const key = d.key();
        if (key) r = await petTalk(openClient('talk', d.settings(), key), { name: d.name(), species: d.species(), history, text, signal });
      } catch {
        r = null; // blocked by the gate or the call failed: the local line keeps the chat alive
      }
      r ??= localReply(text, d.species(), localTurns++);
    }
    const s = settleReply(session, win, history, text, r);
    history = s.history;
    if (s.live && win && !win.isDestroyed()) d.act(r, win.getBounds());
    return r;
  }

  ipcMain.handle(IPC.talkSend, (e, raw: unknown) => (mine(e) && typeof raw === 'string' && raw.trim() ? reply(raw) : null));
  const hasKey = (): boolean => {
    try {
      return !!d.key();
    } catch {
      return false;
    }
  };
  // 'usable' = ⌥ Space works now; 'can-enable' = the menu can turn it on; 'needs-key' = voice is on but there is no key; 'none' = admin-locked or offline.
  const voiceState = (keyed: boolean): 'usable' | 'can-enable' | 'needs-key' | 'none' => {
    const s = d.settings();
    if (s.voice && !s.offline && keyed) return 'usable';
    if (s.offline || voiceLockedByAdmin()) return 'none';
    return s.voice ? 'needs-key' : 'can-enable';
  };
  ipcMain.handle(IPC.talkInfo, (e) => (mine(e) ? { name: d.name(), avatar: d.avatar() ?? null, hasKey: hasKey(), voice: voiceState(hasKey()) } : null));
  ipcMain.on(IPC.talkOpenKey, (e) => { if (mine(e)) d.openKey(); });
  ipcMain.on(IPC.talkClose, (e) => { if (mine(e)) win?.close(); });

  function open(): void {
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
      return;
    }
    const wa = screen.getPrimaryDisplay().workArea;
    const w = new BrowserWindow({
      width: W,
      height: H,
      x: wa.x + wa.width - W - 16,
      y: wa.y + wa.height - H - 16,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      show: false,
      fullscreenable: false,
      webPreferences: { preload: join(here, '../preload/talk-preload.mjs'), contextIsolation: true, nodeIntegration: false, sandbox: false },
    });
    win = w;
    history = [];
    localTurns = 0;
    ctl = new AbortController();
    w.setAlwaysOnTop(true, 'floating');
    w.setContentProtection(d.getHideInShares());
    w.once('ready-to-show', () => { w.show(); w.focus(); });
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.webContents.on('will-navigate', (ev) => ev.preventDefault());
    w.on('closed', () => { if (win === w) { win = null; history = []; localTurns = 0; ctl.abort(); } });
    const devUrl = devRendererUrl();
    if (devUrl) void w.loadURL(`${devUrl}/onboarding/talk.html`);
    else void w.loadFile(join(here, '../renderer/onboarding/talk.html'));
  }

  return {
    open,
    applyProtection: () => { if (win && !win.isDestroyed()) win.setContentProtection(d.getHideInShares()); },
    /** Voice: a sentence that was not a command is typed into the chat for the human to send; nothing leaves the Mac. */
    prefill(text) {
      open();
      const w = win!;
      const put = (): void => w.webContents.send(IPC.talkPrefill, text.slice(0, MAX_USER));
      if (w.webContents.isLoading()) w.webContents.once('did-finish-load', put);
      else put();
    },
  };
}
