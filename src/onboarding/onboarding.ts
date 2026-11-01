import '../ui/tokens.css';
import './onboarding.css';
import sitUrl from '../../assets/pets/Pakkun/sit.png';
import type { CreateResult, PhotoResult, Progress } from '../main/onboarding-preload';
import { advance, initialFlow, type Code, type Flow, type FlowEvent } from './flow';

declare global {
  interface Window {
    pixyOb: {
      state(): Promise<{ needsKey: boolean }>;
      pickPhoto(): Promise<PhotoResult>;
      dropPhoto(file: File): Promise<PhotoResult>;
      devPhoto(): Promise<PhotoResult>;
      saveKey(key: string): Promise<boolean>;
      openKeyPage(): void;
      createPet(name: string, species: 'dog' | 'cat'): Promise<CreateResult>;
      onProgress(cb: (p: Progress) => void): void;
      keep(): void;
      close(): void;
    };
  }
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const TILES: [string, string][] = [['idle', 'standing'], ['walk', 'stepping'], ['sit', 'sitting'], ['sleep', 'napping'], ['bark', 'barking'], ['roll', 'rolling'], ['blink', 'blinking']];
const tileOf = (pose: string): string => (pose.startsWith('walk') ? 'walk' : pose.replace(/^idle_0$/, 'idle').replace(/^idle_/, ''));

const SAY: Record<Code | 'type' | 'size' | 'missing' | 'unreadable', string> = {
  'bad-key': "Hmm, that key didn't work. Want to try another?",
  'no-pet-found': "I couldn't spot them in that photo. Try one where they're in full view?",
  network: "I couldn't reach the internet. Check your connection and we'll try again.",
  'generation-failed': 'Something went sideways while drawing. Want to try again?',
  type: "That isn't a photo I can read. JPG, PNG, HEIC or WebP, please.",
  size: 'That photo is a bit big for me. 25 MB or less, please.',
  missing: "I can't find that file. Want to pick it again?",
  unreadable: "I couldn't open that one. Try another?",
};

let flow: Flow = initialFlow(false, new URLSearchParams(location.search).get('from') === 'menu');
let species: 'dog' | 'cat' = 'dog';
let petName = '';
let cutoutUrl = '';
let photoMsg = '';
let copyTimer = 0;

const nameEl = $<HTMLInputElement>('name');
const keyEl = $<HTMLInputElement>('key');

function go(ev: FlowEvent): void {
  const prev = flow.step;
  flow = advance(flow, ev);
  if (flow.step === prev) return;
  render();
  if (flow.step === 'making') void make();
}

function render(): void {
  document.body.dataset['step'] = flow.step;
  if (flow.step === 'photo') $('photo-msg').textContent = flow.error ? SAY[flow.error] : photoMsg;
  if (flow.step === 'key') $('key-msg').textContent = flow.error ? SAY[flow.error] : '';
  if (flow.step === 'failed') $('fail-msg').textContent = SAY[flow.error ?? 'generation-failed'];
  if (flow.step === 'done') {
    $('done-title').textContent = `Say hi to ${petName}!`;
    ($('done-img') as HTMLImageElement).src = cutoutUrl || sitUrl;
    setTimeout(() => window.pixyOb.close(), 2600);
  }
  // wait for the settle transition before moving focus so the browser doesn't scroll the stage
  setTimeout(() => document.querySelector<HTMLElement>(`[data-step="${flow.step}"] input, [data-step="${flow.step}"] .btn.primary`)?.focus({ preventScroll: true }), 60);
}

function usePhoto(r: PhotoResult): void {
  if (!r.ok) {
    if (r.code === 'cancelled') return;
    photoMsg = SAY[r.code];
    $('photo-msg').textContent = photoMsg;
    return;
  }
  photoMsg = '';
  ($('thumb') as HTMLImageElement).src = r.thumb;
  go({ t: 'photo' });
}

async function make(): Promise<void> {
  cutoutUrl = '';
  $('cutout').innerHTML = '<svg class="ico big"><use href="#paw" /></svg>';
  $('tiles').innerHTML = TILES.map(([k, label]) => `<div class="tile" data-tile="${k}"><div class="box"><svg class="ico"><use href="#paw" /></svg></div>${label}</div>`).join('');
  $('making-title').textContent = `Meeting ${petName}…`;
  const lines = ['Learning {n}\'s ears…', 'Teaching {n} to sit…', 'Fluffing the fur…', 'Practising the tail wag…', 'Nearly ready to say hi…'].map((l) => l.replace('{n}', petName));
  let i = 0;
  const copy = $('copy');
  copy.textContent = lines[0]!;
  copyTimer = window.setInterval(() => {
    copy.classList.add('swap');
    setTimeout(() => { copy.textContent = lines[++i % lines.length]!; copy.classList.remove('swap'); }, 180);
  }, 4200);
  try {
    const r = await window.pixyOb.createPet(petName, species);
    go(r.ok ? { t: 'success' } : { t: 'fail', code: r.code });
  } catch {
    go({ t: 'fail', code: 'generation-failed' });
  } finally {
    clearInterval(copyTimer);
  }
}

window.pixyOb.onProgress((p) => {
  if (p.kind === 'cutout') {
    cutoutUrl = p.url;
    $('cutout').innerHTML = `<img alt="" src="${p.url}" />`;
    return;
  }
  const tile = document.querySelector(`[data-tile="${tileOf(p.name)}"]`);
  if (!tile || tile.classList.contains('full')) return;
  tile.classList.add('full');
  const box = tile.querySelector('.box')!;
  box.innerHTML = '';
  const img = document.createElement('img');
  img.alt = '';
  img.src = p.url;
  box.append(img);
});

$('hero').setAttribute('src', sitUrl);
$('close').addEventListener('click', () => window.pixyOb.close());
$('start').addEventListener('click', () => go({ t: 'start' }));
$('keep').addEventListener('click', () => window.pixyOb.keep());
$('choose').addEventListener('click', () => void window.pixyOb.pickPhoto().then(usePhoto));
document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => go({ t: 'back' })));

const drop = $('drop');
for (const t of ['dragenter', 'dragover']) drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); });
for (const t of ['dragleave', 'drop']) drop.addEventListener(t, () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = (e as DragEvent).dataTransfer?.files[0];
  if (f) void window.pixyOb.dropPhoto(f).then(usePhoto);
});
// A drop that misses the zone must not navigate the window to the file.
for (const t of ['dragover', 'drop']) window.addEventListener(t, (e) => e.preventDefault());

nameEl.addEventListener('input', () => { ($('named') as HTMLButtonElement).disabled = nameEl.value.trim() === ''; });
nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('named').click(); });
document.querySelectorAll<HTMLElement>('.pill').forEach((p) => p.addEventListener('click', () => {
  species = p.dataset['species'] === 'cat' ? 'cat' : 'dog';
  document.querySelectorAll('.pill').forEach((q) => { q.classList.toggle('on', q === p); q.setAttribute('aria-checked', String(q === p)); });
}));
$('named').addEventListener('click', () => {
  petName = nameEl.value.trim();
  if (petName) go({ t: 'named' });
});

keyEl.addEventListener('input', () => { ($('savekey') as HTMLButtonElement).disabled = !/^\S{8,512}$/.test(keyEl.value.trim()); });
keyEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('savekey').click(); });
$('getkey').addEventListener('click', () => window.pixyOb.openKeyPage());
$('savekey').addEventListener('click', () => {
  // The field keeps its text on a bad key so a typo is one edit away.
  void window.pixyOb.saveKey(keyEl.value.trim()).then((ok) => {
    if (ok) go({ t: 'key-saved' });
    else $('key-msg').textContent = "I couldn't store that safely. Try again?";
  });
});
$('retry').addEventListener('click', () => go({ t: 'retry' }));
$('otherphoto').addEventListener('click', () => { flow = { ...flow, step: 'name' }; go({ t: 'back' }); });

void window.pixyOb.state().then((s) => {
  flow = { ...flow, needsKey: s.needsKey };
  render();
});

if (import.meta.env.DEV) {
  Object.defineProperty(window, '__ob', { configurable: true, get: () => ({ flow, devPhoto: async () => usePhoto(await window.pixyOb.devPhoto()) }) });
}
