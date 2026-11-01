import pupUrl from '../../assets/placeholder/pup.png';
import type { Pack } from '../main/pack';
import { DISPLAY_H, displayWidth, footOffset } from './layout';
import { bob, breathe, hop, lean, petTransform, pickTarget, rollAngle, squash, walkFrame, walkSpeed } from './motion';
import { dwellMs, next, onTimeout, type PetEvent, type PetState } from './state';

declare global {
  interface Window {
    pixy: {
      setClickThrough(on: boolean): void;
      onCommand(cb: (cmd: string) => void): void;
      getPack(): Promise<Pack | null>;
      showMenu(): void;
    };
  }
}

interface PoseSet { srcs: string[]; fps: number }

const TURN_MS = 120;
const STRIDE = 0.22; // of displayed width per walk frame
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
const img = document.getElementById('pup') as HTMLImageElement;
const fx = document.getElementById('fx') as HTMLDivElement;

// Placeholder until (unless) a pack loads.
let poses: Record<string, PoseSet> = { idle: { srcs: [pupUrl], fps: 1 } };
let W = 120;
let H = 120;
let footY = 1;

async function loadPackSprites(): Promise<void> {
  const pack = await window.pixy.getPack();
  if (!pack) return;
  const next: Record<string, PoseSet> = {};
  const loaded = new Map<string, HTMLImageElement>();
  for (const [name, p] of Object.entries(pack.manifest.poses)) {
    next[name] = { srcs: p.frames.map((f) => pack.frames[f]).filter((s): s is string => !!s), fps: p.fps };
  }
  await Promise.all(Object.values(next).flatMap((p) => p.srcs).map(async (s) => {
    const i = new Image();
    i.src = s;
    await i.decode();
    loaded.set(s, i); // keeps the decoded bitmaps alive so swapping src never flashes
  }));
  const first = next['idle']?.srcs[0] && loaded.get(next['idle'].srcs[0]);
  if (!first || !next['idle']) return;
  H = DISPLAY_H;
  W = displayWidth(first.naturalWidth, first.naturalHeight);
  footY = pack.manifest.poses['idle']?.footY ?? 1;
  poses = next;
  sizeImg();
}

function sizeImg(): void {
  img.style.width = `${W}px`;
  img.style.height = `${H}px`;
  img.style.transformOrigin = `50% ${footY * 100}%`;
}
img.src = pupUrl;
sizeImg();
void loadPackSprites().catch(() => undefined);

const floorY = (): number => window.innerHeight - footOffset(H, footY);
let state: PetState = 'walk';
let x = 100;
let lift = 0; // drag offset above/below the floor line; the floor itself follows the window size
let y = floorY();
let home = x;
let target = x;
let dir = 1; // where it is heading
let facing = 1; // what is drawn (lags dir by the turn squash)
let turnUntil = 0;
let stateAt = performance.now();
let walkAt = stateAt;
let deadline: number | null = null;
let lastInteraction = stateAt;
let lifeAt = stateAt + 3000;
let lifeUntil = 0;
let lifeKind: 'look' | 'tilt' = 'look';
let lifeTilt = 0;
let last = stateAt;
let stay = false; // menu toggle: no wander targets, idle/sit/sleep only
let menuCalls = 0;
let shownSrc = '';
let walked = 0; // distance walked, drives the stride-synced frame and bob
let zs: HTMLElement[] = [];

function setState(ev: PetEvent, o: { ms?: number; target?: number } = {}): void {
  const now = performance.now();
  const prev = state;
  state = next(state, ev);
  if (state === 'walk' && stay && o.target === undefined) state = 'idle';
  stateAt = now;
  const dwell = o.ms ?? dwellMs(state, Math.random());
  deadline = dwell === null ? null : now + dwell;
  if (state === 'walk') {
    walkAt = now;
    target = o.target ?? pickTarget(x, window.innerWidth - W, home, Math.random(), Math.random());
  }
  if (state !== prev) enter(prev);
}

function enter(prev: PetState): void {
  // brief dip so the frame swap reads as a crossfade
  img.style.transition = 'none';
  img.style.opacity = '0.4';
  requestAnimationFrame(() => {
    img.style.transition = 'opacity 120ms';
    img.style.opacity = '1';
  });
  if (prev === 'sleep') { zs.forEach((z) => z.remove()); zs = []; }
  if (state === 'sleep') {
    for (let i = 0; i < 3; i++) {
      const z = document.createElement('span');
      z.textContent = 'z';
      z.style.cssText = 'position:absolute;left:0;top:0;font:700 16px sans-serif;color:#555;pointer-events:none';
      fx.append(z);
      zs.push(z);
      z.animate(
        [{ opacity: 0, transform: 'translate(0,0)' }, { opacity: 1, offset: 0.3 }, { opacity: 0, transform: 'translate(14px,-34px)' }],
        { duration: 2700, delay: i * 900, iterations: Infinity },
      );
    }
  }
  if (state === 'bark') {
    const b = document.createElement('div');
    b.textContent = 'Woof!';
    b.style.cssText = 'position:absolute;left:0;top:0;font:700 14px sans-serif;background:#fff;color:#222;padding:2px 8px;border-radius:10px;white-space:nowrap;pointer-events:none';
    fx.append(b);
    b.animate(
      [{ opacity: 0, transform: 'translate(-50%,-100%) translateY(4px)' }, { opacity: 1, offset: 0.15 }, { opacity: 0, transform: 'translate(-50%,-100%) translateY(-10px)' }],
      { duration: 800 },
    ).onfinish = () => b.remove();
  }
}

function frame(now: number): void {
  y = floorY() + lift;
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const age = now - stateAt;

  if (now >= turnUntil) facing = dir;
  if (state === 'walk' && now >= turnUntil) {
    const rem = Math.abs(target - x);
    const want = target >= x ? 1 : -1;
    if (rem < 1) {
      const ev = onTimeout('walk', Math.random(), now - lastInteraction);
      setState(ev, ev === 'sit' ? { ms: 4000 } : {});
    } else if (want !== dir) {
      dir = want;
      turnUntil = now + TURN_MS;
    } else {
      const step = Math.min(walkSpeed(now - walkAt, rem) * dt, rem);
      x += dir * step;
      walked += step;
    }
  } else if (deadline !== null && now >= deadline) {
    const ev = onTimeout(state, Math.random(), now - lastInteraction);
    setState(ev, ev === 'sit' ? { ms: 4000 } : {});
  }

  // idle life: look around or tilt the head every 3-6 s
  if (state === 'idle' && now >= lifeAt) {
    lifeKind = Math.random() < 0.5 ? 'look' : 'tilt';
    lifeTilt = Math.random() < 0.5 ? -4 : 4;
    lifeUntil = now + 1000;
    lifeAt = now + 3000 + Math.random() * 3000;
  }
  const life = state === 'idle' && now < lifeUntil;
  const turning = now < turnUntil;

  const stride = STRIDE * W;
  const walking = state === 'walk' && !turning;
  const pose = poses[walking ? 'walk' : state === 'drag' || state === 'walk' ? 'idle' : state] ?? poses['idle']!;
  const i = walking ? walkFrame(walked, pose.srcs.length, stride) : Math.floor((now / 1000) * pose.fps) % pose.srcs.length;
  const src = pose.srcs[i]!;
  if (src !== shownSrc) { img.src = src; shownSrc = src; }

  let dy = 0;
  let sx = 1;
  let sy = 1;
  let rot = 0;
  if (state === 'walk' && !turning) {
    if (!calm) { dy = bob(walked, stride); rot = lean(dir); }
  } else if (state === 'idle' || state === 'sit') {
    sy = breathe(now, 0.4, 0.025) * (state === 'sit' ? squash(age, 0.06, 150) : 1);
    if (life && lifeKind === 'tilt' && !calm) rot = lifeTilt;
  } else if (state === 'sleep') {
    sy = breathe(now, 0.2, 0.04);
  } else if (state === 'bark') {
    const h = hop(age);
    dy = calm ? 0 : h.dy;
    sy = h.sy;
  } else if (state === 'roll' && !calm) {
    rot = rollAngle(age);
  }
  if (turning) { sx = 1.06; sy = 0.92; }
  const flip = facing * (life && lifeKind === 'look' ? -1 : 1);
  if (state === 'roll') img.style.transformOrigin = '50% 50%';
  else img.style.transformOrigin = `50% ${footY * 100}%`;
  img.style.transform = petTransform(x, y + dy, rot, flip, sx, sy);
  fx.style.transform = `translate(${x + W / 2 + flip * W * 0.3}px, ${y + dy}px)`;
  requestAnimationFrame(frame);
}

img.addEventListener('mouseenter', () => window.pixy.setClickThrough(false));
img.addEventListener('mouseleave', () => {
  if (!dragging) window.pixy.setClickThrough(true);
});

let dragging = false;
let offX = 0;
let offY = 0;
let preDrag: PetState = 'walk';
let downAt = 0;
let downX = 0;
let downY = 0;
img.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  menuCalls++;
  window.pixy.showMenu();
});
img.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return; // right click opens the menu; it is neither a drag nor a trick
  dragging = true;
  offX = e.clientX - x;
  offY = e.clientY - y;
  preDrag = state;
  downAt = performance.now();
  downX = e.clientX;
  downY = e.clientY;
  lastInteraction = downAt;
  img.setPointerCapture(e.pointerId);
  setState('dragStart');
});
img.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  x = e.clientX - offX;
  lift = e.clientY - offY - floorY();
});
img.addEventListener('pointerup', (e) => {
  if (!dragging) return;
  dragging = false;
  img.releasePointerCapture(e.pointerId);
  const click = Math.hypot(e.clientX - downX, e.clientY - downY) < 5 && performance.now() - downAt < 300;
  home = x;
  if (click) {
    state = preDrag; // a click is not a drag: keep the trick cycle and wake-from-sleep working
    setState('click');
  } else setState('dragEnd');
  // mouseleave was skipped mid-drag; without this the overlay would swallow every click.
  if (!img.matches(':hover')) window.pixy.setClickThrough(true);
});

function command(cmd: string): void {
  lastInteraction = performance.now();
  if (cmd === 'sit' || cmd === 'roll' || cmd === 'bark') setState(cmd);
  else if (cmd === 'bed') setState('sleep');
  else if (cmd === 'come') setState('walk', { target: (window.innerWidth - W) / 2 });
  else if (cmd === 'stay') {
    stay = true;
    if (state === 'walk') setState('idle');
  } else if (cmd === 'wander') stay = false;
}
window.pixy.onCommand(command);

setState('walk');
requestAnimationFrame(frame);

if (import.meta.env.DEV) {
  Object.defineProperty(window, '__pixyDebug', { get: () => ({ state, x, dir, facing, walked, stay, menuCalls, command }) });
}
