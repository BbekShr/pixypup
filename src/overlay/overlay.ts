import '../ui/tokens.css';
import pupUrl from '../../assets/placeholder/pup.png';
import type { Pack } from '../main/pack';
import { dropLeft, flushCommand, handoffBusy, handoffNext, handoffStart, routeCommand, trotTarget, TROT_SPEEDUP, validCx, type Handoff } from './handoff';
import { behaviorBusy, HINT_WINDOW_MS, hideSpot, parseBehavior, parseHint, peekOutX, routeBehavior, SNIFF_MS, sniffPose, type Behavior } from './behavior';
import { canSpeak, clickSays, LINE_MS, nextSayAt, pickLine, quiet } from './chatter';
import { energyParams, parsePrefs, SIZES, sizeScale, type Prefs } from '../main/prefs';
import { createDebugPanel } from './debug-panel';
import { NEEDS_KEY, parseVoice } from '../voice/listen';
import { displayWidth, footOffset } from './layout';
import { CLICK_WIGGLE_MS, DOUBLE_BLINK_CHANCE, HOVER_TILT_DEG, WIGGLE_MS, YAWN_MS, blinkShut, detectPetting, perkPulse, stretch, wiggle, yawnSy, type Sample } from './micro';
import { BLINK_MS, MAX_SPEED, SETTLE_MS, barkPose, woofBurst, blinkDelay, airStep, breathe, dangle, envelope, gait, headX, hop, landSquash, LAND_SQUASH_MS, pivotShift, lean, releaseVelocity, overlap, petTransform, pickTarget, rollAngle, settle, walkFrame, walkStep, mirrorScale, steer, type Mirror, WALK_ACCEL } from './motion';
import { dwellMs, isClick, next, onTimeout, release, resolveWalk, type PetEvent, type PetState } from './state';

declare global {
  interface Window {
    pixy: {
      setClickThrough(on: boolean): void;
      onCommand(cb: (cmd: string) => void): void;
      onBehavior(cb: (b: unknown) => void): void;
      onDebug(cb: (d: unknown) => void): void;
      onVoice(cb: (m: unknown) => void): void;
      onPackChanged(cb: (h: { x?: number }) => void): void;
      getPack(): Promise<Pack | null>;
      askHint(): Promise<unknown>;
      showMenu(): void;
      getStay(): Promise<boolean>;
      getPrefs(): Promise<unknown>;
      onPrefs(cb: (p: unknown) => void): void;
      devCommand(cmd: string): void;
    };
  }
}

interface PoseSet { srcs: string[]; fps: number }
// A screen-aware behaviour that owns the pet until it ends; the normal state timers are paused meanwhile.
type Act =
  | { kind: 'sniff'; phase: 'run' | 'sniff' | 'bark'; until: number; target: { x: number; y: number }; bubble: string; hint: boolean }
  | { kind: 'perk'; until: number }
  | { kind: 'celebrate'; until: number }
  | { kind: 'hide'; phase: 'go' | 'away' | 'peek' | 'peeking'; until: number; side: -1 | 1; spot: number };
const LONG = 1e9; // a state dwell that never fires; the act ends it
const BARK_MS = 3500;
const PERK_MS = 1000;
const CELEBRATE_MS = 2600;
const HINT_SHOW_MS = 11000;
const MARK_MS = 2600;

const TURN_MS = 380; // a dog turning round, not a flip
type Fidget = 'look' | 'tilt' | 'sniff' | 'wag';
const LIFE_MS: Record<Fidget, number> = { look: 1000, tilt: 1400, sniff: 1200, wag: 1000 };
const WAG_FRAME_MS = 110;
const STRIDE = 0.22; // of displayed (idle) width per walk frame: ~5-6 frames/s at walking speed
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
const img = document.getElementById('pup') as HTMLImageElement;
const fx = document.getElementById('fx') as HTMLDivElement;

const keep: HTMLImageElement[] = []; // decoded bitmaps live as long as the pack so swapping src never re-decodes

// Placeholder until (unless) a pack loads.
let poses: Record<string, PoseSet> = { idle: { srcs: [pupUrl], fps: 1 } };
let W = 120;
let H = 120;
let nat: { w: number; h: number } | null = null; // the pose's natural size; W and H follow the chosen size
let prefs: Prefs = { size: 'medium', energy: 'normal', snoozed: false };
let footY = 1;
let reg = new Map<string, number>(); // src -> natural px its head sits right of idle's
let wagOk = false;
let widths = new Map<string, number>(); // src -> natural width; the profile walk is drawn wider than idle
let lines: string[] = []; // the pet's own catchphrases (model text: textContent only)
let sayAt = Infinity;
let speakingUntil = 0;
let lastLine: string | null = null;
let lineOnBark = false;
let woofs = false; // this bark shows "Woof!" bubbles
let woofShown = -1; // the last burst that got one
const chatty = import.meta.env.DEV && new URLSearchParams(location.search).get('chatty') === '1';

interface Prepared { name: string; lines: string[]; poses: Record<string, PoseSet>; bitmaps: HTMLImageElement[]; nw: number; nh: number; footY: number; reg: Map<string, number>; wag: boolean; widths: Map<string, number> }

const LYING = new Set(['sleep', 'roll']); // whole-body poses: nothing to line the head up with
const WAG_OVERLAP = 0.85; // bark this close to idle (same stance, tail up) doubles as a tail wag

/**
 * Per-frame head alignment: natural px each standing/sitting frame's head sits right of its reference's, both
 * measured from the canvas centre (every frame is drawn centred on the pet). The reference is idle, or for a pose
 * drawn on its own canvas size (the profile walk) that pose's first frame, so its body stays centred.
 * Also whether the bark frame is close enough to idle to flick between them as a wag.
 */
function register(poses: Record<string, PoseSet>, bitmaps: HTMLImageElement[], idle: HTMLImageElement): { reg: Map<string, number>; wag: boolean } {
  const reg = new Map<string, number>();
  const alpha = (i: HTMLImageElement): Uint8ClampedArray | null => {
    const c = new OffscreenCanvas(i.naturalWidth, i.naturalHeight).getContext('2d', { willReadFrequently: true });
    if (!c) return null;
    c.drawImage(i, 0, 0);
    return c.getImageData(0, 0, i.naturalWidth, i.naturalHeight).data.subarray(3);
  };
  const head = (i: HTMLImageElement): number | null => {
    const a = alpha(i);
    const h = a && headX(a, i.naturalWidth, i.naturalHeight, 4);
    return h === null || h === undefined ? null : h - i.naturalWidth / 2;
  };
  const sameSize = (i: HTMLImageElement): boolean => i.naturalWidth === idle.naturalWidth && i.naturalHeight === idle.naturalHeight;
  const bitmap = (src: string | undefined): HTMLImageElement | undefined => bitmaps.find((b) => b.src === src);
  const h0 = head(idle);
  if (h0 === null) return { reg, wag: false };
  for (const [name, p] of Object.entries(poses)) {
    if (LYING.has(name)) continue;
    const first = bitmap(p.srcs[0]);
    const ref = !first || sameSize(first) ? h0 : head(first);
    for (const src of p.srcs) {
      const b = bitmap(src) ?? idle;
      const h = ref === null ? null : head(b);
      const max = 0.15 * b.naturalWidth;
      if (h !== null && ref !== null) reg.set(src, Math.max(-max, Math.min(max, h - ref)));
    }
  }
  const bark = poses['bark']?.srcs.length === 1 ? bitmap(poses['bark']!.srcs[0]) : undefined;
  const a0 = alpha(idle);
  const ab = bark && sameSize(bark) ? alpha(bark) : null;
  return { reg, wag: !!a0 && !!ab && overlap(a0, ab, 4) >= WAG_OVERLAP };
}

// Decodes everything before anything is swapped, so the old pet keeps its own poses until it has left.
async function readPack(): Promise<Prepared | null> {
  const pack = await window.pixy.getPack();
  if (!pack) return null;
  const poses: Record<string, PoseSet> = {};
  for (const [name, p] of Object.entries(pack.manifest.poses)) {
    poses[name] = { srcs: p.frames.map((f) => pack.frames[f]).filter((s): s is string => !!s), fps: p.fps };
  }
  const bitmaps: HTMLImageElement[] = [];
  await Promise.all(Object.values(poses).flatMap((p) => p.srcs).map(async (s) => {
    const i = new Image();
    i.src = s;
    await i.decode();
    bitmaps.push(i);
  }));
  const first = bitmaps.find((i) => i.src === poses['idle']?.srcs[0]);
  if (!first) return null;
  const { reg, wag } = register(poses, bitmaps, first);
  return { name: pack.manifest.pet, lines: pack.manifest.personality?.lines ?? [], poses, bitmaps, nw: first.naturalWidth, nh: first.naturalHeight, footY: pack.manifest.poses['idle']?.footY ?? 1, reg, wag, widths: new Map(bitmaps.map((b) => [b.src, b.naturalWidth])) };
}

function applyPack(p: Prepared): void {
  nat = { w: p.nw, h: p.nh };
  layout();
  footY = p.footY;
  keep.splice(0, keep.length, ...p.bitmaps); // the old pack's bitmaps are released only once the new poses are live
  poses = p.poses;
  reg = p.reg;
  wagOk = p.wag;
  widths = p.widths;
  lines = p.lines;
  sayAt = nextSayAt(performance.now(), Math.random(), chatty);
  sizeImg();
}

function layout(): void {
  const n = nat ?? (img.naturalHeight ? { w: img.naturalWidth, h: img.naturalHeight } : null); // before a pack: the placeholder's
  if (!n) return; // never stretch an image whose size is unknown
  H = SIZES[prefs.size];
  W = displayWidth(n.w, n.h, H);
  x = Math.min(x, Math.max(0, window.innerWidth - W));
  target = Math.min(target, Math.max(0, window.innerWidth - W));
}

function sizeImg(): void {
  img.style.width = `${W}px`;
  img.style.height = `${H}px`;
  img.style.transformOrigin = `50% ${footY * 100}%`;
}
img.src = pupUrl;
sizeImg();
img.addEventListener('load', () => { if (!nat) { layout(); sizeImg(); } }, { once: true });
void readPack().then((p) => p && applyPack(p)).catch(() => undefined);
void window.pixy.getStay().then((v) => { stay = v; }).catch(() => undefined); // main owns it, so a reload can't desync the menu checkbox

const floorY = (): number => window.innerHeight - footOffset(H, footY);
let state: PetState = 'walk';
let x = 100;
let lift = 0; // offset from the floor line (negative = above); only non-zero while dragged or falling
let vy = 0;
let vx = 0; // px/s, only while thrown or sliding
let landV = 0; // impact speed of the last floor hit, scales the squash
let dang = { angle: 0, omega: 0 }; // body swing under the hand, deg
let handX = 0;
let handV = 0;
let falling = false;
let landAt = -1e9;
let raf = 0;
let y = floorY();
let home = x;
let target = x;
let dir = 1; // where it is heading
let facing = 1; // the side drawn this frame (follows dir through a turn)
let mir: Mirror = { from: -1, to: 1, at: -Infinity };
let turnUntil = 0;
let stateAt = performance.now();
let walkV = 0; // px/s
let walkAcc = 0; // a / WALK_ACCEL
let walkFrac = 0; // v / vMax
const stopWalk = (): void => { walkV = 0; walkAcc = 0; walkFrac = 0; };
let deadline: number | null = null;
let lastInteraction = stateAt;
let lifeAt = stateAt + 3000;
let lifeUntil = 0;
let lifeStart = 0;
let lifeKind: Fidget = 'look';
let lifeTilt = 0;
let poseKey = ''; // the pose family on screen; a change starts the settle wobble
let settleAt = -1e9;
let blinkAt = stateAt + blinkDelay(Math.random());
let blinkAt0 = -1e9; // when the current blink began
let blinkDouble = false;
let hovering = false;
let hoverSide = 1; // which side of the pet the cursor is on
let tilt = 0;
let perkAt = -1e9;
let wg = { at: -1e9, dur: WIGGLE_MS, cycles: 3 };
let stretchAt = -1e9;
let yawn = false; // the idle dwell is the yawn; when it ends the pet falls asleep
let samples: Sample[] = [];
let petAt = -1e9;
let clickTimer: ReturnType<typeof setTimeout> | undefined;
let last = stateAt;
let stay = false; // menu toggle: no wander targets, idle/sit/sleep only
let menuCalls = 0;
let greet: string | null = null; // new pet's name: barked as a greeting on landing
let pendingSwap: { pack: Prepared; cx: number | undefined } | null = null; // a pet change that arrived mid-drag
let handoff: Handoff | null = null;
let queuedCmd: string | null = null; // a menu command that arrived mid-hand-off
let incoming: { pack: Prepared; cx: number | undefined } | null = null; // the new pet, waiting for the old one to leave
let shownSrc = '';
let walked = 0; // distance walked, drives the stride-synced frame and bob
let zs: HTMLElement[] = [];
let resting = false; // snoozed: invisible, and the rAF loop is stopped
let restTimer: ReturnType<typeof setTimeout> | undefined;
let wakeSay = false; // wake-up: drop in, then a sleepy greeting
let act: Act | null = null;
let queuedBehavior: Behavior | null = null; // the last behaviour that arrived while the pet was busy
let lastSeq = -1;
let lastBehavior: Behavior | null = null; // dev panel only
let hintUntil = 0; // after a sniff, a click asks for a hint until then
let hintAsking = false;

const en = (): ReturnType<typeof energyParams> => energyParams(prefs.energy);

function setState(ev: PetEvent, o: { ms?: number; target?: number } = {}, forced?: PetState): void {
  const now = performance.now();
  const prev = state;
  yawn = false;
  state = forced ?? resolveWalk(next(state, ev), stay, o.target !== undefined);
  stateAt = now;
  lifeUntil = 0;
  lifeAt = Math.max(lifeAt, now + 1500); // let a new pose land before the first fidget
  const dwell = o.ms ?? dwellMs(state, Math.random(), en());
  deadline = dwell === null ? null : now + dwell;
  if (state === 'walk') {
    stopWalk();
    target = o.target ?? pickTarget(x, window.innerWidth - W, home, Math.random(), Math.random());
  }
  if (state !== prev) enter(prev);
}

// The energy model's pick; a nap starts with a yawn.
function timeout(from: PetState, now: number): void {
  const ev = onTimeout(from, Math.random(), now - lastInteraction, en());
  if (ev === 'sleep' && !calm) startYawn();
  else setState(ev, ev === 'sit' ? { ms: 4000 } : {});
}

function startYawn(): void {
  setState('idle', { ms: YAWN_MS });
  yawn = true;
  if (quiet(performance.now(), speakingUntil)) say('~', YAWN_MS);
}

function enter(prev: PetState): void {
  // brief dip so the swap to or from a lying pose reads as a crossfade; upright swaps get the settle wobble instead
  if (!calm && (LYING.has(state) || LYING.has(prev))) {
    img.style.transition = 'none';
    img.style.opacity = '0.4';
    requestAnimationFrame(() => {
      img.style.transition = 'opacity 120ms';
      img.style.opacity = '1';
    });
  }
  if (prev === 'sleep') {
    zs.forEach((z) => z.remove());
    zs = [];
    if (state !== 'drag') stretchAt = performance.now();
  }
  if (state === 'sleep') {
    for (let i = 0; i < 3; i++) {
      const z = document.createElement('span');
      z.textContent = 'z';
      z.style.cssText = 'position:absolute;left:0;top:0;font:700 16px sans-serif;color:#555;pointer-events:none';
      fx.append(z);
      zs.push(z);
      if (calm) { z.style.transform = `translate(${4 + i * 6}px,${-6 - i * 10}px)`; continue; }
      z.animate(
        [{ opacity: 0, transform: 'translate(0,0)' }, { opacity: 1, offset: 0.3 }, { opacity: 0, transform: 'translate(14px,-34px)' }],
        { duration: 2700, delay: i * 900, iterations: Infinity },
      );
    }
  }
  woofs = false;
  woofShown = -1;
  if (state === 'bark' && !greet && quiet(performance.now(), speakingUntil)) {
    if (lineOnBark && speakLine()) return;
    woofs = true; // the frame loop pops a "Woof!" on each burst
  }
}

function woofBubble(): void {
  const b = document.createElement('div');
  b.textContent = 'Woof!';
  b.style.cssText = 'position:absolute;left:0;top:0;font:700 14px sans-serif;background:#fff;color:#222;padding:2px 8px;border-radius:10px;white-space:nowrap;pointer-events:none';
  fx.append(b);
  b.animate(
    [{ opacity: 0, transform: 'translate(-50%,-100%) translateY(4px)' }, { opacity: 1, offset: 0.15 }, { opacity: 0, transform: 'translate(-50%,-100%) translateY(-10px)' }],
    { duration: 800 },
  ).onfinish = () => b.remove();
}

function frame(now: number): void {
  if (resting) return;
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const age = now - stateAt;

  if (queuedBehavior && !busyNow() && (!act || queuedBehavior.action === 'hide')) { const q = queuedBehavior; queuedBehavior = null; start(q); }
  if (queuedCmd && !act && !handoffBusy(handoff) && handoff !== 'greet') { const q = queuedCmd; queuedCmd = null; command(q); }
  if (act && act.until && now >= act.until) actTimeout(now);
  if (falling) {
    const r = airStep({ x, lift, vx, vy }, dt, window.innerWidth - W, floorY());
    ({ x, lift, vx, vy } = r);
    if (r.impact) { landAt = now; landV = r.impact; }
    if (r.settled) {
      falling = false;
      home = x;
      if (state === 'walk' && !act && !handoff) target = pickTarget(x, window.innerWidth - W, home, Math.random(), Math.random()); // not back toward the release side
      stopWalk();
      if (greet) {
        const g = greet;
        greet = null;
        if (handoff === 'drop') handoff = handoffNext(handoff, 'landed');
        land(g);
      }
    }
    if (r.settled && wakeSay) {
      wakeSay = false;
      lastInteraction = now;
      setState('sit', { ms: 3000 });
      say('Hi again… *yawn*', 3000);
    }
  } else if (state === 'walk' && now >= turnUntil) {
    const rem = Math.abs(target - x);
    const want = target >= x ? 1 : -1;
    if (rem < 1 && handoff === 'trotOff') {
      handoff = handoffNext(handoff, 'offscreen');
      dropIn();
    } else if (rem < 1 && act) {
      actArrive(now);
    } else if (rem < 1) {
      timeout('walk', now);
    } else if (want !== dir) {
      dir = want;
      turnUntil = now + (calm ? 0 : TURN_MS);
      stopWalk(); // speeds up again from the end of the turn, no lurch
    } else {
      const vMax = MAX_SPEED * (act?.kind === 'sniff' ? energyParams('playful').speed : en().speed) * sizeScale(prefs.size) * (handoff === 'trotOff' || (act?.kind === 'hide' && act.phase === 'go') ? TROT_SPEEDUP : 1);
      const v0 = walkV;
      walkV = walkStep(v0, rem, vMax, dt);
      walkAcc = (walkV - v0) / dt / (WALK_ACCEL * vMax / MAX_SPEED);
      walkFrac = walkV / vMax;
      const step = Math.min(walkV * dt, rem);
      x += dir * step;
      walked += step;
    }
  } else if (!act && deadline !== null && now >= deadline) {
    if (yawn) setState('sleep');
    else timeout(state, now);
  }

  if (now >= sayAt && canSpeak(state, act !== null || (handoff !== null && handoff !== 'wander') ||dragging || falling || now < speakingUntil || greet !== null) && speakLine()) sayAt = nextSayAt(now, Math.random(), chatty);

  // idle life every 3-6 s: look the other way, tilt the head, sniff the floor or wag (sitting: tilt only)
  const upright = state === 'idle' || state === 'sit';
  if (upright && !act && !yawn && now >= lifeAt) {
    const kinds: Fidget[] = state === 'sit' ? ['tilt'] : ['look', 'tilt', 'sniff', ...(wagOk ? ['wag' as const] : [])];
    lifeKind = kinds[Math.floor(Math.random() * kinds.length)]!;
    lifeTilt = Math.random() < 0.5 ? -4 : 4;
    lifeStart = now;
    lifeUntil = now + LIFE_MS[lifeKind];
    lifeAt = now + 3000 + Math.random() * 3000;
  }
  if (state === 'idle' && now >= blinkAt) {
    blinkAt0 = now;
    blinkDouble = Math.random() < DOUBLE_BLINK_CHANCE;
    blinkAt = now + blinkDelay(Math.random());
  }
  const life = upright && !act && now < lifeUntil;
  const turning = state === 'walk' && now < turnUntil;
  const turnMs = calm ? 0 : TURN_MS;
  mir = steer(mir, dir * (life && lifeKind === 'look' ? -1 : 1) as 1 | -1, now, turnMs); // look: the head turns away and back, any interruption turns too
  const ms = mirrorScale(mir, now, turnMs);
  const flip = Math.sign(ms);
  facing = flip;
  y = floorY() + lift;
  if (dragging && !calm) {
    const d = Math.max(dt, 0.001);
    const v = handV + ((x - handX) / d - handV) * 0.5;
    const arm = Math.max(40, Math.hypot(offX - W / 2, offY - H / 2));
    dang = dangle(dang, Math.max(-30000, Math.min(30000, (v - handV) / d)), dt, arm);
    handV = v;
  } else if (dang.angle) {
    dang = { angle: Math.abs(dang.angle) < 0.05 ? 0 : dang.angle * Math.exp(-10 * dt), omega: 0 }; // lets go of the swing
  }
  handX = x;

  const px = nat ? W / nat.w : 1; // display px per natural px
  const shownW = (src: string | undefined): number => (src && nat ? (widths.get(src) ?? nat.w) * px : W);
  const stride = STRIDE * W;
  const walking = state === 'walk' && !turning && !falling;
  const blinking = state === 'idle' && !yawn && blinkShut(now - blinkAt0, BLINK_MS, blinkDouble) && !!poses['blink'];
  const name = blinking ? 'blink' : walking ? 'walk' : state === 'drag' || state === 'walk' || falling ? 'idle' : state;
  const key = blinking ? 'idle' : state === 'walk' && !falling ? 'walk' : name; // blinks and walk turns are not pose changes
  if (key !== poseKey) {
    if (poseKey && !LYING.has(key) && !LYING.has(poseKey)) settleAt = now;
    poseKey = key;
  }
  const wagging = life && lifeKind === 'wag' && !calm && Math.floor((now - lifeStart) / WAG_FRAME_MS) % 2 === 1;
  const pose = poses[wagging ? 'bark' : name] ?? poses['idle']!;
  const i = Math.max(0, walking ? walkFrame(walked, pose.srcs.length, stride) : Math.floor((now / 1000) * pose.fps) % pose.srcs.length);
  const src = pose.srcs[i]!;
  if (src !== shownSrc) { img.src = src; shownSrc = src; }
  const fw = shownW(src);
  if (img.style.width !== `${fw}px`) img.style.width = `${fw}px`; // a wider frame (the profile walk) stays centred on the pet

  let dx = 0;
  let dy = 0;
  let sx = 1;
  let sy = 1;
  let rot = 0;
  if (walking) {
    if (!calm) {
      const g = gait(walked, stride, shownW(poses['walk']?.srcs[0]) !== W); // a wider walk frame is the drawn profile cycle
      dy = g.dy;
      sx = g.sx;
      sy = g.sy;
      rot = lean(dir, walkFrac, walkAcc) + g.rot * dir;
    }
  } else if (upright) {
    const b = breathe(now, 0.3, 0.02);
    sy = b;
    if (!calm) {
      sx = 1 - (b - 1) / 2; // chest fills out as it rises
      rot = 0.6 * Math.sin((2 * Math.PI * 0.11 * now) / 1000); // slow weight shift
      if (life) {
        const t = now - lifeStart;
        const e = envelope(t, lifeUntil - lifeStart);
        if (lifeKind === 'tilt') rot += lifeTilt * e;
        else if (lifeKind === 'sniff') { rot += 5 * e * facing; dy = -1.5 * e * Math.abs(Math.sin(t / 70)); }
        else if (lifeKind === 'wag') rot += 1.2 * e * Math.sin((Math.PI * t) / WAG_FRAME_MS);
      }
    }
    if (act?.kind === 'sniff' && act.phase === 'sniff' && !calm) {
      const p = sniffPose(now - (act.until - SNIFF_MS));
      rot = p.tilt * facing;
      dy = p.dy;
    } else if (act?.kind === 'perk' && !calm) {
      const h = hop((now - (act.until - PERK_MS)) % 500);
      dy = h.dy;
      sy = h.sy;
    }
  } else if (state === 'sleep') {
    sy = breathe(now, 0.2, 0.04);
  } else if (state === 'bark') {
    if (woofs && woofBurst(age) > woofShown && quiet(now, speakingUntil)) { woofShown = woofBurst(age); woofBubble(); }
    if (!calm) {
      const b = barkPose(age);
      dx = b.dx * facing;
      rot = -b.rot * facing; // nose up
      sx = b.sx;
      sy = b.sy;
    }
  } else if (state === 'roll' && !calm) {
    rot = rollAngle(age);
  }
  if (turning) { sx = 1; sy = 1; }
  sx *= Math.abs(ms); // the sign lives in flip, so the head registration mirrors with it
  sy *= 1 - 0.04 * envelope(now - mir.at, turnMs);
  if (!calm) {
    const ok = hovering && microOk();
    tilt += ((ok ? HOVER_TILT_DEG * hoverSide : 0) - tilt) * Math.min(1, dt * 12);
    rot += tilt + wiggle(now - wg.at, wg.dur, wg.cycles);
    const p = perkPulse(now - perkAt);
    const st = stretch(now - stretchAt);
    const se = now - settleAt < SETTLE_MS ? settle(now - settleAt) : 1;
    sx *= p * st.sx * (1 + (1 - se) / 2);
    sy *= p * st.sy * se * (yawn ? yawnSy(age) : 1);
  }
  if (now - landAt < LAND_SQUASH_MS) { const k = landSquash(now - landAt, landV); sy *= k; sx *= 1 + (1 - k) / 2; }
  const swing = dang.angle ? -dang.angle : 0;
  if (dang.angle) { rot += swing; sy *= 1.03; }
  dx += (W - fw) / 2 - (reg.get(src) ?? 0) * px * flip; // centred, head where its reference's is
  if (state === 'roll') img.style.transformOrigin = '50% 50%';
  else img.style.transformOrigin = `50% ${footY * 100}%`;
  if (swing && state !== 'roll') { // rotate about the grab point: shift by what the origin-pivot rotation moved it
    const s = pivotShift(offX - dx - fw / 2, offY - dy - footY * H, swing);
    dx += s.dx;
    dy += s.dy;
  }
  img.style.transform = petTransform(x + dx, y + dy, rot, flip, sx, sy);
  fx.style.transform = `translate(${x + W / 2 + flip * W * 0.3}px, ${y + dy}px)`;
  raf = requestAnimationFrame(frame);
}

img.addEventListener('mouseenter', (e) => {
  window.pixy.setClickThrough(false);
  hoverSide = e.clientX >= x + W / 2 ? 1 : -1;
  if (!microOk()) return;
  hovering = true;
  face(hoverSide);
  perkAt = performance.now();
});
img.addEventListener('mouseleave', () => {
  hovering = false;
  samples = [];
  if (!dragging) window.pixy.setClickThrough(true);
});

// Calm, idle, nobody else has the pet: only then do the little reactions run.
const microOk = (): boolean => !calm && !busyNow() && !dragging && !act && !yawn && (state === 'idle' || state === 'sit');

function heart(): void {
  const h = document.createElement('div');
  h.textContent = '\u2665';
  h.style.cssText = 'position:absolute;left:0;top:0;font:700 14px var(--font);color:var(--blush);pointer-events:none';
  fx.append(h);
  const dx = (Math.random() - 0.5) * 24;
  h.animate(
    [{ opacity: 0, transform: `translate(${dx}px,6px) scale(.5)` }, { opacity: 1, offset: 0.2 }, { opacity: 0, transform: `translate(${dx * 1.5}px,-34px) scale(1)` }],
    { duration: 900, easing: 'ease-out' },
  ).onfinish = () => h.remove();
}

function pet(now: number): void {
  petAt = now;
  samples = [];
  lastInteraction = now;
  wg = { at: now, dur: WIGGLE_MS, cycles: 3 };
  const n = 2 + Math.floor(Math.random() * 2);
  for (let i = 0; i < n; i++) setTimeout(heart, i * 160);
  if (Math.random() < 0.3 && quiet(now, speakingUntil)) speakLine();
}
img.addEventListener('pointermove', (e) => {
  if (dragging || !microOk()) return;
  const now = performance.now();
  samples.push({ x: e.clientX, t: now });
  if (samples.length > 40) samples.shift();
  if (now - petAt > 1500 && detectPetting(samples)) pet(now);
});

let dragging = false;
let offX = 0;
let offY = 0;
let preDrag: PetState = 'walk';
let downAt = 0;
let downX = 0;
let downY = 0;
let ptrX = 0; // last pointer position while dragging
let ptrY = 0;
let path: { x: number; y: number; t: number }[] = []; // recent pointer path for the throw
const track = (e: PointerEvent): void => { path = [...path.filter((p) => e.timeStamp - p.t < 200), { x: e.clientX, y: e.clientY, t: e.timeStamp }]; };
img.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  menuCalls++;
  window.pixy.showMenu();
});
img.addEventListener('pointerdown', (e) => {
  if (dragging || handoffBusy(handoff) || e.button !== 0 || e.ctrlKey) return; // right/ctrl click opens the menu; it is neither a drag nor a trick
  dragging = true;
  stopWalk();
  hovering = false;
  if (act && !(act.kind === 'hide' && (act.phase === 'go' || act.phase === 'away'))) act = null; // hiding survives a poke; anything else yields
  falling = false;
  lift = Math.min(0, lift);
  offX = e.clientX - x;
  offY = e.clientY - y;
  preDrag = state;
  downAt = performance.now();
  downX = e.clientX;
  downY = e.clientY;
  ptrX = downX;
  ptrY = downY;
  path = [];
  track(e);
  dang = { angle: 0, omega: 0 };
  handX = x;
  handV = 0;
  vx = 0;
  lastInteraction = downAt;
  img.setPointerCapture(e.pointerId);
  setState('dragStart');
});
img.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  ptrX = e.clientX;
  ptrY = e.clientY;
  track(e);
  x = Math.min(Math.max(0, e.clientX - offX), window.innerWidth - W);
  const top = Math.min(Math.max(0, e.clientY - offY), window.innerHeight - H);
  lift = top - floorY();
});
// pointerup, pointercancel and lostpointercapture all end the drag: a stuck drag would leave click-through off.
function finish(e: PointerEvent): void {
  if (!dragging) return;
  dragging = false;
  if (img.hasPointerCapture(e.pointerId)) img.releasePointerCapture(e.pointerId);
  const click = e.type === 'pointerup' && isClick(Math.hypot(e.clientX - downX, e.clientY - downY), performance.now() - downAt);
  home = x;
  const forced = release(preDrag, click, stay);
  const go = (): void => {
    if (click && preDrag === 'sleep' && !calm) stretchAt = performance.now();
    lineOnBark = click && clickSays(lines.length > 0, Math.random());
    setState(click ? 'click' : 'dragEnd', {}, forced);
    lineOnBark = false;
  };
  if (click && lift === 0 && !hintAsking && performance.now() < hintUntil) {
    hintUntil = 0; // one hint per failure
    if (!calm) wg = { at: performance.now(), dur: CLICK_WIGGLE_MS, cycles: 2 };
    setState('click', { ms: HINT_SHOW_MS }, 'sit');
    void askHint();
  } else if (click && !calm && lift === 0) {
    // wiggle and a heart first, then the trick; any other takeover of the pet cancels it
    const now = performance.now();
    wg = { at: now, dur: CLICK_WIGGLE_MS, cycles: 2 };
    heart();
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => { if (state === 'drag' && !dragging && !resting) go(); }, CLICK_WIGGLE_MS);
  } else go();
  const t = click || calm ? { vx: 0, vy: 0 } : releaseVelocity(path, e.timeStamp);
  if (lift < 0 || Math.abs(t.vx) > 60) { falling = true; vx = t.vx; vy = t.vy; if (Math.abs(vx) > 200) dir = Math.sign(vx); }
  if (act?.kind === 'hide') { act.phase = 'go'; setState('walk', { target: act.spot }); } // poked out of hiding: go back
  // mouseleave was skipped mid-drag; without this the overlay would swallow every click.
  if (!img.matches(':hover')) window.pixy.setClickThrough(true);
  applyRest();
  if (pendingSwap) { const q = pendingSwap; pendingSwap = null; swapPets(q.pack, q.cx); }
}
img.addEventListener('pointerup', finish);
img.addEventListener('pointercancel', finish);
img.addEventListener('lostpointercapture', finish);

function command(raw: string): void {
  const r = routeCommand(handoff, raw, queuedCmd);
  queuedCmd = r.queued;
  if (!r.now) return;
  const cmd = r.now;
  if (act?.kind === 'hide') return;
  if (act?.kind === 'sniff') { queuedCmd = cmd; return; } // a voice command waits for the sniff to finish
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

const REST_MS = 600;
// Snooze/wake wait out a drag or the pet-swap hand-off, which own the pet until they finish.
const canRest = (): boolean => !dragging && !handoffBusy(handoff);
function applyRest(): void {
  if (prefs.snoozed === resting || !canRest()) return;
  resting = prefs.snoozed;
  if (resting) { act = null; queuedBehavior = null; }
  clearTimeout(restTimer);
  document.body.style.transition = `opacity ${calm ? 200 : REST_MS}ms`;
  if (resting) {
    cancelAnimationFrame(raf);
    document.body.style.opacity = '0';
    window.pixy.setClickThrough(true);
    restTimer = setTimeout(() => {
      img.style.display = 'none'; // no hover target while snoozed
      fx.replaceChildren();
      zs = [];
    }, REST_MS);
    return;
  }
  img.style.display = '';
  document.body.style.opacity = '1';
  const now = performance.now();
  last = now;
  lastInteraction = now;
  wakeSay = true;
  sayAt = nextSayAt(now, Math.random(), chatty); // no chatter line right after "Hi again"
  falling = !calm;
  vy = 0;
  vx = 0;
  lift = calm ? 0 : -(floorY() + H);
  setState('idle', { ms: 3000 });
  if (calm) { wakeSay = false; setState('sit', { ms: 3000 }); say('Hi again… *yawn*', 3000); }
  raf = requestAnimationFrame(frame);
}
function applyPrefs(raw: unknown): void {
  const p = parsePrefs(raw);
  if (!p) return;
  const sizeChanged = p.size !== prefs.size;
  prefs = p;
  if (sizeChanged) {
    layout();
    sizeImg();
    if (dragging) { offX = ptrX - x; offY = ptrY - (floorY() + lift); } // keep the grab point under the pointer
  }
  applyRest();
}
window.pixy.onPrefs(applyPrefs);
void window.pixy.getPrefs().then((raw) => {
  document.body.style.transition = 'none';
  applyPrefs(raw);
  if (!prefs.snoozed) document.body.style.opacity = '1';
}).catch(() => { document.body.style.opacity = '1'; });

const busyNow = (): boolean => behaviorBusy({ dragging, falling, resting, snoozed: prefs.snoozed, handoff });

function onBehavior(raw: unknown): void {
  const b = parseBehavior(raw);
  if (!b || b.seq === lastSeq) return;
  lastSeq = b.seq;
  lastBehavior = b;
  const r = routeBehavior(b, { busy: busyNow(), acting: act ? (act.kind === 'hide' ? 'hide' : 'other') : null });
  if (r === 'queue') queuedBehavior = b;
  else if (r === 'run') start(b);
}

function face(toward: number): void {
  dir = toward >= 0 ? 1 : -1;
  turnUntil = 0;
}

function start(b: Behavior): void {
  const now = performance.now();
  lastInteraction = now;
  if (b.action === 'hide') {
    if (b.on) {
      if (act?.kind === 'hide' && (act.phase === 'go' || act.phase === 'away')) return;
      if (queuedBehavior?.action !== 'hide') queuedBehavior = null; // a sniff that waited is stale by the time the call ends
      const h = hideSpot(x, W, window.innerWidth);
      act = { kind: 'hide', phase: 'go', until: 0, ...h };
      setState('walk', { target: h.spot });
    } else if (!b.on && act?.kind === 'hide') {
      act.phase = 'peek';
      setState('walk', { target: peekOutX(act.side, W, window.innerWidth) });
    }
  } else if (b.action === 'sniff' && b.target) {
    hintUntil = 0;
    act = { kind: 'sniff', phase: 'run', until: 0, target: b.target, bubble: b.bubble ?? 'Found a bug!', hint: b.hint === true };
    setState('walk', { target: Math.min(Math.max(0, b.target.x - W / 2), Math.max(0, window.innerWidth - W)) });
  } else if (b.action === 'perk_up') {
    act = { kind: 'perk', until: now + PERK_MS };
    face(1); // toward the Dock's right side
    setState('idle', { ms: LONG });
    say(b.bubble ?? '!', PERK_MS);
  } else if (b.action === 'celebrate') {
    hintUntil = 0; // fixed: nothing left to hint at
    act = { kind: 'celebrate', until: now + CELEBRATE_MS };
    setState('click', { ms: LONG }, calm ? 'sit' : 'roll');
    say(b.bubble ?? 'You fixed it!', CELEBRATE_MS);
    if (!calm) {
      for (let i = 0; i < 6; i++) setTimeout(heart, i * 140);
      setTimeout(() => { if (act?.kind === 'celebrate' && state === 'roll') setState('click', { ms: LONG }, 'bark'); }, 900); // one roll, then happy hops
    }
  }
}

// The walk the act asked for has ended.
function actArrive(now: number): void {
  if (!act) return;
  if (act.kind === 'sniff' && act.phase === 'run') {
    face(act.target.x - (x + W / 2));
    lifeAt = now + 8000; // no idle head-turn mid-sniff
    act.phase = 'sniff';
    act.until = now + SNIFF_MS;
    setState('idle', { ms: LONG });
    showMark(act.target);
  } else if (act.kind === 'hide' && act.phase === 'go') {
    act.phase = 'away';
    face(-act.side); // looks in from the edge
    setState('idle', { ms: LONG });
  } else if (act.kind === 'hide' && act.phase === 'peek') {
    act.phase = 'peeking';
    act.until = now + 900;
    setState('idle', { ms: LONG });
  }
}

function actTimeout(now: number): void {
  if (!act) return;
  const a = act;
  act = null;
  lastInteraction = now;
  if (a.kind === 'sniff' && a.phase === 'sniff') {
    act = { ...a, phase: 'bark', until: now + BARK_MS };
    say(a.bubble, BARK_MS); // before the bark, so its own "Woof!" stays quiet
    setState('bark', { ms: LONG });
  } else if (a.kind === 'hide' && a.phase === 'peeking') {
    const max = Math.max(0, window.innerWidth - W);
    setState('walk', { target: a.side < 0 ? Math.min(max, 200) : Math.max(0, max - 200) });
  } else if (a.kind === 'sniff' && a.hint) {
    hintUntil = now + HINT_WINDOW_MS;
    setState('sit', { ms: 6000 }); // waits a moment where the user can click him
    say('Click me for a hint', 3200);
  } else {
    setState('idle');
  }
}

// Main asks Muse Spark about the failure it sniffed; the answer is model text, so textContent only.
async function askHint(): Promise<void> {
  hintAsking = true;
  fx.querySelectorAll('.hi:not(.card)').forEach((b) => b.remove()); // the "Click me" offer has been answered
  showPill('thinking…', true);
  let hint: string | null = null;
  try {
    hint = parseHint(await window.pixy.askHint());
  } catch {
    /* shown as "not sure" below */
  }
  hidePill();
  hintAsking = false;
  if (hint) showCard(hint, HINT_SHOW_MS);
  else say("Hmm, I'm not sure this time", 2500);
}

function showCard(text: string, ms: number): void {
  const c = document.createElement('div');
  c.className = 'hi card';
  const t = document.createElement('div');
  t.className = 'card-title';
  t.textContent = 'Hint';
  const body = document.createElement('div');
  body.textContent = text;
  c.append(t, body);
  // Keep the 260 px card on screen when the pet sits near an edge.
  const cx = x + W / 2;
  const shift = Math.max(140 - cx, Math.min(0, window.innerWidth - 140 - cx));
  c.style.transform = `translate(calc(-50% + ${shift}px), -100%)`;
  speakingUntil = performance.now() + ms;
  fx.append(c);
  if (calm) { setTimeout(() => c.remove(), ms); return; }
  c.animate([{ opacity: 0 }, { opacity: 1, offset: 0.04 }, { opacity: 1, offset: 0.95 }, { opacity: 0 }], { duration: ms }).onfinish = () => c.remove();
}

// "!" where he found it. Screen-derived coordinates only; no text from the screen is shown here.
function showMark(p: { x: number; y: number }): void {
  const m = document.createElement('div');
  m.textContent = '!';
  m.style.cssText = `position:absolute;left:${p.x}px;top:${p.y}px;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;background:var(--blush);color:#fff;font:800 17px/26px var(--font);text-align:center;box-shadow:var(--shadow);pointer-events:none`;
  document.body.append(m);
  m.animate(
    [{ opacity: 0, transform: 'scale(.3)' }, { opacity: 1, transform: 'scale(1.25)', offset: 0.12 }, { opacity: 1, transform: 'scale(1)', offset: 0.2 }, { opacity: 1, offset: 0.8 }, { opacity: 0, transform: 'scale(.8)' }],
    { duration: MARK_MS },
  ).onfinish = () => m.remove();
}
window.pixy.onBehavior(onBehavior);
window.pixy.onDebug(createDebugPanel(calm));

// The "listening…" pill rides with the head like a speech bubble. Partial text is a transcript: textContent only.
let pill: HTMLDivElement | null = null;
let pillText: HTMLSpanElement;
let pillTimer: ReturnType<typeof setTimeout> | undefined;
function showPill(text: string, dot: boolean, ms?: number): void {
  if (!pill) {
    pill = document.createElement('div');
    pill.className = 'hi';
    const d = document.createElement('span');
    d.style.cssText = 'display:inline-block;width:8px;height:8px;margin-right:8px;border-radius:50%;background:var(--blush);vertical-align:middle';
    if (!calm) d.animate([{ opacity: 1 }, { opacity: 0.3 }, { opacity: 1 }], { duration: 1200, iterations: Infinity });
    pillText = document.createElement('span');
    pill.append(d, pillText);
    pill.style.transform = 'translate(-50%,-100%)';
    fx.append(pill);
  }
  pillText.textContent = text;
  (pill.firstElementChild as HTMLElement).style.display = dot ? 'inline-block' : 'none';
  clearTimeout(pillTimer);
  if (ms) pillTimer = setTimeout(hidePill, ms);
}
function hidePill(): void {
  clearTimeout(pillTimer);
  pill?.remove();
  pill = null;
}
window.pixy.onVoice((raw) => {
  const m = parseVoice(raw);
  if (!m) return;
  if (m.kind === 'listening') {
    showPill('listening…', true);
    if (!busyNow()) perkAt = performance.now();
  } else if (m.kind === 'partial') showPill(m.text || 'listening…', true);
  else if (m.kind === 'thinking') showPill('…', false);
  else if (m.kind === 'huh') {
    showPill('?', false, 1200);
    if (!calm && !busyNow()) wg = { at: performance.now(), dur: WIGGLE_MS, cycles: 1 };
  } else if (m.kind === 'nokey') showPill(NEEDS_KEY, false, 5000);
  else if (m.kind === 'error') {
    hidePill();
    say("I didn't catch that", 2500);
  } else hidePill();
});

// Old pet trots off the nearest edge at double speed; dropIn() then fires on arrival. Reduced motion: crossfade swap.
function swapPets(pack: Prepared, cx: number | undefined): void {
  if (dragging) { pendingSwap = { pack, cx }; return; }
  wakeSay = false; // main wakes the pet right before it reveals the new one
  act = null;
  queuedBehavior = null;
  incoming = { pack, cx: validCx(cx, window.innerWidth, x + W / 2) };
  handoff = handoffStart(calm);
  greet = null;
  falling = false;
  lift = 0;
  lastInteraction = performance.now(); // onboarding takes minutes; without this the pet would nap right after landing
  if (!calm) { setState('walk', { target: trotTarget(x, W, window.innerWidth) }); return; }
  img.style.transition = 'opacity 200ms';
  img.style.opacity = '0';
  setTimeout(() => {
    const n = incoming!;
    applyPack(n.pack);
    x = home = dropLeft(n.cx, W, window.innerWidth);
    setState('idle', { ms: 10_000 });
    img.style.transition = 'opacity 300ms';
    img.style.opacity = '1';
    land(n.pack.name);
  }, 220);
}
// The new pet falls in from above, at the spot the onboarding window shrank toward.
function dropIn(): void {
  const n = incoming!;
  applyPack(n.pack);
  x = home = dropLeft(n.cx, W, window.innerWidth);
  lift = -(floorY() + H);
  vy = 0;
  vx = 0;
  falling = true;
  greet = n.pack.name;
  setState('idle', { ms: 10_000 });
}
function land(name: string): void {
  lastInteraction = performance.now();
  setState('bark'); // enter() skips its own "Woof!" while a greeting is pending
  sayHi(name);
  setTimeout(() => {
    if (handoff) handoff = handoffNext(handoff, 'greeted');
    const r = flushCommand(handoff, queuedCmd);
    queuedCmd = r.queued;
    if (r.now) command(r.now);
    applyRest();
  }, 3600);
}
function speakLine(): boolean {
  const l = pickLine(lines, lastLine, Math.random());
  if (!l) return false;
  lastLine = l;
  say(l, LINE_MS);
  return true;
}
const sayHi = (name: string): void => say(`Hi, I'm ${name}!`, 3600);
function say(text: string, ms: number): void {
  const b = document.createElement('div');
  b.className = 'hi';
  b.textContent = text;
  speakingUntil = performance.now() + ms;
  fx.append(b);
  b.animate(
    // the pop easing belongs on the first segment only: as a whole-animation easing it overshoots and fades the bubble out in under a second
    [{ opacity: 0, transform: 'translate(-50%,-100%) scale(.6)', easing: 'cubic-bezier(.34,1.56,.64,1)' }, { opacity: 1, transform: 'translate(-50%,-100%) scale(1)', offset: 0.1 }, { opacity: 1, offset: 0.9 }, { opacity: 0, transform: 'translate(-50%,-100%) translateY(-8px)' }],
    { duration: ms, fill: 'backwards' },
  ).onfinish = () => b.remove();
}
window.pixy.onPackChanged((h) => {
  void readPack().then((p) => p && swapPets(p, h.x)).catch(() => undefined);
});

setState('walk');
raf = requestAnimationFrame(frame);
import.meta.hot?.dispose(() => cancelAnimationFrame(raf));

if (import.meta.env.DEV) {
  Object.defineProperty(window, '__pixyDebug', { configurable: true, get: () => ({ pref: (cmd: string) => window.pixy.devCommand(cmd), behave: (b: unknown) => onBehavior(b), lastBehavior, act: act && { ...act }, size: [W, H], energy: prefs.energy, snoozed: prefs.snoozed, resting, deadline, state, x, dir, facing, walked, stay, wag: wagOk, reg: [...reg.values()].map(Math.round), pose: poseKey, menuCalls, lift, falling, handoff, command, yawn: startYawn }) });
}
