import { BrowserWindow, ipcMain, screen } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openClient } from '../api/gate';
import { isCrisis, localReply, MAX_TURNS, MAX_USER, petTalk, type TalkReply, type Turn } from '../api/pet-talk';
import type { Settings } from './settings';
import { IPC } from './ipc';

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
}

/**
 * The chat window. Nothing is sent anywhere until the human presses Send (or says a sentence by voice); what is
 * said lives in this closure until the window closes and is never logged or written.
 */
export function setupTalkWindow(d: TalkDeps): { open(): void; ask(text: string): Promise<TalkReply>; applyProtection(): void } {
  let win: BrowserWindow | null = null;
  let history: Turn[] = [];
  const mine = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean => !!win && !win.isDestroyed() && e.sender === win.webContents;

  async function reply(raw: string): Promise<TalkReply> {
    const text = raw.slice(0, MAX_USER);
    let r: TalkReply | null = null;
    if (isCrisis(text)) r = { ...localReply(text, d.species()), action: 'listen', crisis: true }; // never leaves the machine
    else {
      try {
        const key = d.key();
        if (key) r = await petTalk(openClient('talk', d.settings(), key), { name: d.name(), species: d.species(), history, text, signal: AbortSignal.timeout(15_000) });
      } catch {
        r = null; // blocked by the gate or the call failed: the local line keeps the chat alive
      }
      r ??= localReply(text, d.species());
    }
    history = [...history, { role: 'user' as const, text }, { role: 'pet' as const, text: `${r.woof} (${r.caption})` }].slice(-MAX_TURNS);
    if (win && !win.isDestroyed()) d.act(r, win.getBounds());
    return r;
  }

  ipcMain.handle(IPC.talkSend, (e, raw: unknown) => (mine(e) && typeof raw === 'string' && raw.trim() ? reply(raw) : null));
  ipcMain.handle(IPC.talkInfo, (e) => (mine(e) ? { name: d.name(), avatar: d.avatar() ?? null } : null));
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
    w.setAlwaysOnTop(true, 'floating');
    w.setContentProtection(d.getHideInShares());
    w.once('ready-to-show', () => { w.show(); w.focus(); });
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.webContents.on('will-navigate', (ev) => ev.preventDefault());
    w.on('closed', () => { if (win === w) { win = null; history = []; } });
    const devUrl = process.env['ELECTRON_RENDERER_URL'];
    if (devUrl) void w.loadURL(`${devUrl}/onboarding/talk.html`);
    else void w.loadFile(join(here, '../renderer/onboarding/talk.html'));
  }

  return {
    open,
    applyProtection: () => { if (win && !win.isDestroyed()) win.setContentProtection(d.getHideInShares()); },
    /** Voice: a sentence that was not a command. Opens the chat, answers, and shows both sides there. */
    async ask(text) {
      open();
      const w = win!;
      const r = await reply(text);
      if (!w.isDestroyed()) {
        const show = (): void => w.webContents.send(IPC.talkShow, { heard: text.slice(0, MAX_USER), reply: r });
        if (w.webContents.isLoading()) w.webContents.once('did-finish-load', show);
        else show();
      }
      return r;
    },
  };
}
