import '../ui/tokens.css';
import './onboarding.css';
import { copyLines, nextCopy, ribbonFraction } from './birth';
import sitUrl from '../../assets/pets/Pakkun/sit.png';
import type { CreateResult, FactView, Personality, PhotoResult, Progress } from '../main/onboarding-preload';
import type { Run } from '../main/run-state';
import { advance, initialFlow, speciesIssue, type Code, type Flow, type FlowEvent } from './flow';

declare global {
  interface Window {
    pixyOb: {
      state(): Promise<{ needsKey: boolean; offline: boolean; running: (Omit<Run, 'facts'> & { facts?: FactView[]; walkFailed: boolean }) | null }>;
      onStepsFailed(cb: () => void): void;
      onFinished(cb: (r: CreateResult) => void): void;
      pickPhoto(): Promise<PhotoResult>;
      dropPhoto(file: File): Promise<PhotoResult>;
      devPhoto(): Promise<PhotoResult>;
      saveKey(key: string): Promise<boolean>;
      checkKey(key: string): Promise<'ok' | 'bad-key' | 'network' | 'unsafe'>;
      openKeyPage(): void;
      createPet(name: string, species: string): Promise<CreateResult>;
      onProgress(cb: (p: Progress) => void): void;
      onPersonality(cb: (p: Personality) => void): void;
      onFacts(cb: (f: FactView[]) => void): void;
      openSource(index: number): void;
      keep(): void;
      close(): void;
      shrink(calm: boolean): void;
    };
  }
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const TILES: [string, string][] = [['idle', 'standing'], ['walk', 'stepping'], ['sit', 'sitting'], ['sleep', 'napping'], ['bark', 'barking'], ['roll', 'rolling'], ['blink', 'blinking']];
const tileOf = (pose: string): string => (/^(walk|side)_/.test(pose) ? 'walk' : pose.replace(/^idle_0$/, 'idle').replace(/^idle_/, ''));

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

const fromMenu = new URLSearchParams(location.search).get('from') === 'menu';
let flow: Flow = initialFlow(false, fromMenu);
let species = 'dog';
let petName = '';
let idleUrl = '';
let hasCutout = false;
let stepsLost = false; // the walk cycle could not be drawn: say so once, at the reveal
let walkTimer = 0;
const walk = new Map<string, string>(); // the stepping tile cycles whatever walk frames have arrived
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
let photoMsg = '';
let copyTimer = 0;
let swapTimer = 0; // a queued swap must not overwrite the reveal subtitle
let personality: Personality | null = null;
let facts: FactView[] = [];
let tick = 0;
let typedKey = ''; // renderer-side only until a bad key needs it back in the field

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
    reveal();
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

const birth = (): HTMLElement => $('birth');
const poseTiles = (): number => document.querySelectorAll('.tile.full').length;
function fill(): void {
  $('ribbon-fill').style.width = `${ribbonFraction(hasCutout, poseTiles()) * 100}%`;
}

function setupMaking(): void {
  hasCutout = false;
  stepsLost = false;
  idleUrl = '';
  clearInterval(walkTimer);
  walkTimer = 0;
  walk.clear();
  document.body.classList.remove('leaving');
  birth().className = 'birth';
  for (const id of ['b-photo', 'b-cut', 'b-gen']) $(id).removeAttribute('src');
  const photo = $('thumb').getAttribute('src'); // absent when the window was reopened mid-run
  if (photo) { $('b-photo').setAttribute('src', photo); birth().classList.add('has'); }
  $('tiles').innerHTML = TILES.map(([k, label]) => `<div class="tile" data-tile="${k}"><div class="box"><svg class="ico"><use href="#paw" /></svg></div><span class="lbl">${label}</span></div>`).join('');
  $('making-title').textContent = `Meeting ${petName}…`;
  fill();
  personality = null;
  facts = [];
  tick = 0;
  $('meet').classList.remove('on');
  showCopy({ text: copyLines(petName)[0]! });
  clearInterval(copyTimer);
  copyTimer = window.setInterval(() => {
    const c = nextCopy(copyLines(petName), personality?.lines ?? [], facts, ++tick, ribbonFraction(hasCutout, poseTiles()));
    if (c.text === $('copy-t').textContent) return;
    $('copy').classList.add('swap');
    swapTimer = window.setTimeout(() => { showCopy(c); $('copy').classList.remove('swap'); }, 260);
  }, 4000);
}

// Model text: textContent only. The page names a fact by index; main holds the URL.
function showCopy(c: { text: string; fact?: number }): void {
  $('copy-t').textContent = c.text;
  const src = $('copy-src');
  const idx = c.fact !== undefined && facts[c.fact]?.hasSource ? c.fact : -1;
  src.hidden = idx < 0;
  src.onclick = idx < 0 ? null : () => window.pixyOb.openSource(idx);
}

function showPersonality(p: Personality): void {
  personality = p;
  $('meet-hi').textContent = `Meet ${petName}`;
  $('meet-breed').textContent = p.breed;
  $('traits').replaceChildren(...p.traits.map((t) => Object.assign(document.createElement('span'), { textContent: t })));
  $('meet').classList.add('on');
}

// The cutout melts into the generated 3D idle, stars and hearts burst, then the window shrinks toward the floor where the pet lands.
function reveal(): void {
  clearTimeout(swapTimer);
  $('copy').classList.remove('swap');
  clearInterval(walkTimer);
  walkTimer = 0;
  $('making-title').textContent = `Say hi to ${petName}!`;
  showCopy({ text: stepsLost ? "Couldn't draw my steps today, so I'll bounce along" : (personality?.lines[0] ?? 'Right-click your pet any time.') });
  if (idleUrl) {
    $('b-gen').setAttribute('src', idleUrl);
    setTimeout(() => birth().classList.add('gen-on'), 350);
  }
  if (!calm) {
    const glyphs = ['✦', '♥', '✧', '♥'];
    $('sparks').innerHTML = Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * 2 * Math.PI + Math.random() * 0.4;
      const d = 70 + Math.random() * 50;
      return `<span style="--dx:${Math.round(Math.cos(a) * d)}px;--dy:${Math.round(Math.sin(a) * d * 0.8 - 20)}px;--rot:${Math.round(Math.random() * 120 - 60)}deg;color:${i % 2 ? 'var(--blush)' : 'var(--honey)'};animation-delay:${450 + i * 40}ms">${glyphs[i % 4]}</span>`;
    }).join('');
  }
  setTimeout(() => {
    document.body.classList.add('leaving');
    window.pixyOb.shrink(calm);
  }, calm ? 2200 : 3200);
}

function finished(r: CreateResult): void {
  const code = r.ok ? null : r.code;
  if (code === 'busy' || flow.step !== 'making') return; // busy: a run is already going, not a failure
  clearInterval(copyTimer);
  if (r.ok && r.idle) idleUrl = r.idle;
  if (code !== 'bad-key') typedKey = '';
  else keyEl.value = typedKey; // a bad key comes back in the field so a typo is one edit away
  go(code === null ? { t: 'success' } : { t: 'fail', code });
}

async function make(): Promise<void> {
  setupMaking();
  try {
    finished(await window.pixyOb.createPet(petName, species));
  } catch {
    finished({ ok: false, code: 'generation-failed' });
  }
}

function applyProgress(p: Progress): void {
  if (p.kind === 'cutout') {
    hasCutout = true;
    $('b-cut').setAttribute('src', p.url);
    birth().classList.add('has', 'cut-on');
    fill();
    return;
  }
  const k = tileOf(p.name);
  const tile = document.querySelector(`[data-tile="${k}"]`);
  if (!tile) return;
  if (p.name === 'idle_0') idleUrl = p.url;
  if (k === 'walk') walk.set(p.name, p.url);
  else if (tile.classList.contains('full')) return;
  const box = tile.querySelector('.box')!;
  let img = box.querySelector('img');
  if (!img) {
    img = document.createElement('img');
    img.alt = '';
    box.innerHTML = '';
    box.append(img);
    tile.classList.add('full');
  }
  img.src = k === 'walk' ? [...walk].sort()[0]![1] : p.url;
  if (k === 'walk' && walk.size > 1 && !walkTimer && !calm) {
    let f = 0;
    walkTimer = window.setInterval(() => { img!.src = [...walk].sort()[++f % walk.size]![1]; }, 160);
  }
  fill();
}
const IMPROV = "I'll improvise my steps";
function stepsFailed(): void {
  stepsLost = true;
  const tile = document.querySelector('[data-tile="walk"]');
  tile?.setAttribute('title', IMPROV);
  const lbl = tile?.querySelector('.lbl');
  if (lbl) lbl.textContent = 'improvising';
}
window.pixyOb.onStepsFailed(stepsFailed);
window.pixyOb.onProgress(applyProgress);
window.pixyOb.onFinished(finished);
window.pixyOb.onPersonality((p) => { if (flow.step === 'making') showPersonality(p); });
window.pixyOb.onFacts((f) => { facts = f; });

$('hero').setAttribute('src', sitUrl);
// Closing at any step, when the window opened by itself, counts as "keep Pakkun": the app never nags.
// A pet being made keeps going in main, so only a finished or idle window may keep.
$('close').addEventListener('click', () => (!fromMenu && flow.step !== 'making' && flow.step !== 'done' ? window.pixyOb.keep() : window.pixyOb.close()));
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
const speciesEl = $<HTMLInputElement>('species');
const speciesErr = $('speciesErr');
const checkSpecies = (): boolean => {
  const issue = speciesIssue(speciesEl.value);
  speciesErr.textContent = issue ?? '';
  speciesEl.setAttribute('aria-invalid', String(issue !== null));
  return issue === null;
};
speciesEl.addEventListener('input', checkSpecies);
speciesEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('named').click(); });
document.querySelectorAll<HTMLElement>('.chip').forEach((c) => c.addEventListener('click', () => {
  speciesEl.value = c.textContent ?? '';
  checkSpecies();
}));
$('named').addEventListener('click', () => {
  petName = nameEl.value.trim();
  if (!petName || !checkSpecies()) return;
  species = speciesEl.value.trim();
  go({ t: 'named' });
});

keyEl.addEventListener('input', () => { ($('savekey') as HTMLButtonElement).disabled = !/^\S{8,512}$/.test(keyEl.value.trim()); });
keyEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('savekey').click(); });
$('getkey').addEventListener('click', () => window.pixyOb.openKeyPage());
$('savekey').addEventListener('click', () => {
  // The field keeps its text on a bad key so a typo is one edit away.
  void window.pixyOb.saveKey(keyEl.value.trim()).then((ok) => {
    if (ok) {
      typedKey = keyEl.value.trim();
      keyEl.value = ''; // the key now lives in main only
      go({ t: 'key-saved' });
    }
    else $('key-msg').textContent = "I couldn't store that safely. Try again?";
  });
});
$('retry').addEventListener('click', () => go({ t: 'retry' }));
$('otherphoto').addEventListener('click', () => { flow = { ...flow, step: 'name' }; go({ t: 'back' }); });

const wkey = $<HTMLInputElement>('wkey');
const wsave = $<HTMLButtonElement>('wsave');
const WSAY = { 'bad-key': "Hmm, Meta didn't take that key. Want to try another?", network: "I couldn't reach Meta to check it. Try again in a moment?", unsafe: "I couldn't store that safely on this Mac, so I didn't keep it." };
const wready = (): boolean => /^\S{8,512}$/.test(wkey.value.trim());
wkey.addEventListener('input', () => { wsave.disabled = !wready(); $('wmsg').textContent = ''; });
wkey.addEventListener('keydown', (e) => { if (e.key === 'Enter' && wready()) wsave.click(); });
$('wget').addEventListener('click', () => window.pixyOb.openKeyPage());
const wlock = (on: boolean): void => { wkey.disabled = on; $<HTMLButtonElement>('start').disabled = on; };
wsave.addEventListener('click', () => {
  wsave.disabled = true;
  wlock(true);
  wsave.textContent = 'Checking…';
  void window.pixyOb.checkKey(wkey.value.trim()).then((r) => {
    wsave.textContent = 'Save key';
    wlock(false);
    if (r === 'ok') {
      wkey.value = ''; // the key now lives in main only
      flow = { ...flow, needsKey: false }; // Make my pet skips the key step
      $('perk').hidden = true;
      return;
    }
    $('wmsg').textContent = WSAY[r];
    wsave.disabled = !wready();
  });
});

void window.pixyOb.state().then((s) => {
  flow = { ...flow, needsKey: s.needsKey };
  $('perk').hidden = !s.needsKey || s.offline;
  if (s.running) {
    // Reopened while a pet is still being made: pick the scene up where it is.
    petName = s.running.name;
    species = s.running.species;
    flow = { ...flow, step: 'making' };
    setupMaking();
    s.running.progress.forEach(applyProgress);
    if (s.running.walkFailed) stepsFailed();
    if (s.running.personality) showPersonality(s.running.personality);
    facts = s.running.facts ?? [];
  }
  render();
});

if (import.meta.env.DEV) {
  Object.defineProperty(window, '__ob', { configurable: true, get: () => ({ flow, devPhoto: async () => usePhoto(await window.pixyOb.devPhoto()) }) });
}
