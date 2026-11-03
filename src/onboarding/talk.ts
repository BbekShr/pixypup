import '../ui/tokens.css';
import './onboarding.css';
import './talk.css';
import { CRISIS_TEXT, type TalkReply } from '../api/pet-talk';
import sitUrl from '../../assets/pets/Pakkun/sit.png';

declare global {
  interface Window {
    pixyTalk: { send(text: string): Promise<unknown>; info(): Promise<unknown>; openKey(): void; close(): void; onPrefill(cb: (text: unknown) => void): void };
  }
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const log = $('log');
const input = $<HTMLTextAreaElement>('text');
const send = $<HTMLButtonElement>('send');
let name = 'your pet';

// Everything typed or returned goes in through textContent: it is user or model text, never markup.
function add(cls: string, ...kids: (string | HTMLElement)[]): HTMLElement {
  const d = document.createElement('div');
  d.className = cls;
  d.append(...kids);
  log.querySelector('.hello')?.remove();
  log.append(d);
  log.scrollTop = log.scrollHeight;
  return d;
}
const tag = (t: string, cls: string, text: string): HTMLElement => Object.assign(document.createElement(t), { className: cls, textContent: text });

function showReply(r: TalkReply): void {
  if (r.crisis) {
    add('msg pup', tag('em', '', '*sits quietly beside you*'));
    add('help', CRISIS_TEXT);
  } else add('msg pup', tag('span', 'woof', r.woof), tag('em', '', `*${r.caption}*`));
}
function parse(m: unknown): TalkReply | null {
  const r = (m ?? {}) as Partial<TalkReply>;
  return typeof r.woof === 'string' && typeof r.caption === 'string' ? { action: r.action ?? 'comfort', woof: r.woof, caption: r.caption, crisis: r.crisis === true } : null;
}

function fit(): void {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight + 4, 106)}px`; // +4: the 2px borders
  input.classList.toggle('multi', input.scrollHeight > 42);
  input.scrollTop = input.scrollHeight;
}
input.addEventListener('input', fit);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $<HTMLFormElement>('form').requestSubmit(); }
});

function setBusy(on: boolean): void {
  input.disabled = on;
  send.disabled = on;
  if (!on) input.focus();
}

$('form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const text = input.value.trim();
  if (!text || input.disabled) return;
  input.value = '';
  fit();
  add('msg me', text);
  const dots = add('msg pup', Object.assign(document.createElement('span'), { className: 'dots' }));
  dots.firstElementChild!.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
  setBusy(true);
  void window.pixyTalk.send(text).then(parse, () => null).then((r) => {
    dots.remove();
    if (r) showReply(r);
    setBusy(false);
  });
});

window.pixyTalk.onPrefill((text) => {
  if (typeof text !== 'string' || input.disabled) return;
  input.value = text;
  input.focus();
  input.setSelectionRange(text.length, text.length);
  fit();
});
$('close').addEventListener('click', () => window.pixyTalk.close());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.pixyTalk.close(); });

const banner = $('banner');
const basic = $('basic');
let keyless = false;
// A hidden note stays hidden for next time; the small chip in the header brings it back.
let dismissed = false; // in-memory twin, so dismiss still holds across refresh() when storage throws
const showBanner = (on: boolean): void => {
  dismissed = !on;
  banner.hidden = !on;
  basic.hidden = !keyless || on;
  try { localStorage.setItem('talkBannerHidden', on ? '' : '1'); } catch { /* storage blocked: the choice lasts until the window closes */ }
};
const bannerHidden = (): boolean => {
  try { return dismissed || localStorage.getItem('talkBannerHidden') === '1'; } catch { return dismissed; }
};
function refresh(): void {
  void window.pixyTalk.info().then((m) => {
    const o = (m ?? {}) as { name?: unknown; avatar?: unknown; hasKey?: unknown; voice?: unknown };
    if (typeof o.name === 'string' && o.name) name = o.name;
    if (typeof o.avatar === 'string' && o.avatar.startsWith('data:image/')) $('face').setAttribute('src', o.avatar);
    $('title').textContent = `Talk to ${name}`;
    input.placeholder = name.length > 8 ? "How's your day going?" : `Tell ${name} about your day…`; // a long name would wrap the one-line box
    if (!log.childElementCount) log.append(tag('p', 'hello', `${name} is here. Say anything.`));
    $('how').textContent = o.voice === 'usable'
      ? "Type and press Enter, or press ⌥ Space and say it; it's typed here for you to send."
      : o.voice === 'can-enable'
        ? `Type and press Enter. Turn on “Listen for my voice” in ${name}'s menu to talk out loud${o.hasKey === false ? ' (needs a Meta key)' : ''}.`
        : o.voice === 'needs-key'
          ? 'Type and press Enter. Add a Meta key to talk out loud with ⌥ Space.'
          : 'Type and press Enter.';
    keyless = o.hasKey === false;
    $('banner-t').textContent = `${name} is using basic woofs. Add a Meta key and they'll really understand you.`;
    if (keyless) showBanner(!bannerHidden());
    else { banner.hidden = true; basic.hidden = true; }
  }).catch(() => undefined);
}
$('addkey').addEventListener('click', () => window.pixyTalk.openKey());
$('dismiss').addEventListener('click', () => showBanner(false));
basic.addEventListener('click', () => showBanner(true));
window.addEventListener('focus', refresh); // a key saved in the other window clears the note
$('face').setAttribute('src', sitUrl);
refresh();
input.focus();
