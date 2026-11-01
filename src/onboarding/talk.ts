import '../ui/tokens.css';
import './onboarding.css';
import './talk.css';
import { CRISIS_TEXT, type TalkReply } from '../api/pet-talk';
import sitUrl from '../../assets/pets/Pakkun/sit.png';

declare global {
  interface Window {
    pixyTalk: { send(text: string): Promise<unknown>; info(): Promise<unknown>; close(): void; onShow(cb: (m: unknown) => void): void };
  }
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const log = $('log');
const input = $<HTMLInputElement>('text');
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
  add('msg pup', tag('span', 'woof', r.woof), tag('em', '', `*${r.caption}*`));
  if (r.crisis) add('help', CRISIS_TEXT);
}
function parse(m: unknown): TalkReply | null {
  const r = (m ?? {}) as Partial<TalkReply>;
  return typeof r.woof === 'string' && typeof r.caption === 'string' ? { action: r.action ?? 'comfort', woof: r.woof, caption: r.caption, crisis: r.crisis === true } : null;
}

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

window.pixyTalk.onShow((m) => {
  const o = (m ?? {}) as { heard?: unknown; reply?: unknown };
  if (typeof o.heard === 'string' && o.heard) add('msg me', o.heard);
  const r = parse(o.reply);
  if (r) showReply(r);
});
$('close').addEventListener('click', () => window.pixyTalk.close());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.pixyTalk.close(); });

$('face').setAttribute('src', sitUrl);
void window.pixyTalk.info().then((m) => {
  const o = (m ?? {}) as { name?: unknown; avatar?: unknown };
  if (typeof o.name === 'string' && o.name) name = o.name;
  if (typeof o.avatar === 'string' && o.avatar.startsWith('data:image/')) $('face').setAttribute('src', o.avatar);
  $('title').textContent = `Talk to ${name}`;
  input.placeholder = `Tell ${name} about your day…`;
  log.append(tag('p', 'hello', `${name} is here. Say anything.`));
}).catch(() => undefined);
input.focus();
