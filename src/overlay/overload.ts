import '../ui/tokens.css';
import type { Pack } from '../main/pack';
import { alphaPlane, cleanFrame, walkTiming } from './frames';
import { FALLBACK_STRIDE, strideFromFrames } from './stride';
import { displayWidth } from './layout';
import { GAITS, bakeWalk, legBand, rigFor } from './puppet';
import { boundGait, gaitParams, hop, hopTurn, landSquash, LAND_SQUASH_MS, lean, MAX_SPEED, mirrorProgress, mirrorScale, petTransform, profileScale, turnFrame, usableTurn, walkBody, walkFrame } from './motion';
import { calmAlpha, calmX, castIndices, createShow, flyLift, HOP_WINDOW_MS, SHOW_MS, T, TURN_MS, type CastMember } from './overload-choreo';

declare global {
  interface Window {
    pixyOverload: { onStart(cb: (p: unknown) => void): void; onCursor(cb: (c: { x: number; y: number }) => void): void; started(): void; done(): void };
    __pixyOverload: { frameMs: number; count: number; t: number };
  }
}

interface Start { packs: Pack[]; seed: number }
interface Prep { idle: string; walk: string[]; spans?: number[]; turn: string[] | null; strideFrac: number; body: { bounce: number; pitch: number }; fps: number; footY: number; natW: Map<string, number>; idleW: number; drawn: boolean; flier: boolean; member: CastMember }

const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
const keep: HTMLImageElement[] = []; // decoded bitmaps live as long as the show so swapping src never re-decodes
let cursorX = window.innerWidth / 2;
window.__pixyOverload = { frameMs: 0, count: 0, t: 0 };
window.pixyOverload.onCursor((c) => { cursorX = c.x; });

async function prep(pack: Pack): Promise<Prep | null> {
  const poses = pack.manifest.poses;
  const idle = pack.frames[poses['idle']?.frames[0] ?? ''];
  if (!idle) return null;
  let walk = (poses['walk']?.frames ?? []).map((f) => pack.frames[f]).filter((s): s is string => !!s);
  const natW = new Map<string, number>();
  let idleH = 1;
  const walkImgs: HTMLImageElement[] = [];
  const turn = usableTurn(poses['turn']?.frames.map((f) => pack.frames[f]).filter((s): s is string => !!s))?.slice(0, 2) ?? null; // front and front34 are all a turn needs
  await Promise.all((turn ?? []).map(async (s) => {
    const i = new Image();
    i.src = s;
    await i.decode();
    keep.push(i);
    natW.set(s, i.naturalWidth);
  }));
  walk = await Promise.all([idle, ...walk].map(async (s, k) => {
    const i = new Image();
    i.src = s;
    await i.decode();
    const c = s === idle ? null : await cleanFrame(i).catch(() => null); // old packs: a sliver of a neighbouring tail on the edge
    const f = c ?? i;
    keep.push(f);
    natW.set(f.src, f.naturalWidth);
    if (s === idle) idleH = i.naturalHeight;
    else walkImgs[k - 1] = f; // frame order matters for the stride
    return f.src;
  })).then((all) => all.slice(1));
  const idleW = natW.get(idle)!;
  let spans = walkTiming(walkImgs);
  let strideFrac: number | undefined;
  let body: { bounce: number; pitch: number } | undefined;
  const kind = rigFor(pack.manifest.species, poses['walk']); // same rule as the main pet: a judged drawn walk beats the rig
  if (kind) {
    const idleImg = keep.find((i) => i.src === idle);
    const a = idleImg && alphaPlane(idleImg);
    const band = idleImg && a && legBand(a, idleImg.naturalWidth, idleImg.naturalHeight, 4);
    if (band) {
      const gait = GAITS[kind];
      try {
        const baked = await bakeWalk(idleImg, band, gait, a);
        keep.push(...baked.bitmaps);
        walk = baked.srcs;
        spans = undefined; // the rig's frames are evenly spaced already
        for (const b of baked.bitmaps) natW.set(b.src, b.naturalWidth);
        strideFrac = baked.cycleNat / gait.frames / idleW;
        body = { bounce: gait.bounce, pitch: gait.pitch };
      } catch { /* keep the AI walk */ }
    }
  }
  const prof = pack.manifest.profile;
  const flier = prof?.locomotion === 'fly';
  const member: CastMember = { flier, aspect: displayWidth(idleW, idleH, 1), air: flier && prof?.air ? { min: prof.air.minLiftBody, max: prof.air.maxLiftBody } : undefined };
  const measuredStride = (): number => {
    const w0 = walkImgs[0];
    const alphas = walkImgs.map(alphaPlane);
    const same = !!w0 && walkImgs.every((f) => f.naturalWidth === w0.naturalWidth && f.naturalHeight === w0.naturalHeight);
    return same && alphas.every((a) => a) ? strideFromFrames(alphas as Uint8ClampedArray[], w0.naturalWidth, w0.naturalHeight, 4, idleW) / idleW : FALLBACK_STRIDE; // measured from the art so the feet don't slide
  };
  return { idle, walk, spans, turn, strideFrac: strideFrac ?? measuredStride(), body: body ?? profileScale(prof?.gait), fps: poses['walk']?.fps ?? 8, footY: poses['idle']?.footY ?? 1, natW, idleW, drawn: walk.length > 0, flier, member }; // drawn: loadPack already dropped walks that never move
}

function heart(x: number, y: number): void {
  const h = document.createElement('div');
  h.textContent = '♥';
  h.className = 'heart';
  document.body.append(h);
  const dx = (Math.random() - 0.5) * 30;
  h.animate(
    [{ opacity: 0, transform: `translate(${x}px,${y}px) scale(.5)` }, { opacity: 1, offset: 0.2 }, { opacity: 0, transform: `translate(${x + dx}px,${y - 46}px) scale(1)` }],
    { duration: 900, easing: 'ease-out' },
  ).onfinish = () => h.remove();
}

async function begin(raw: unknown): Promise<void> {
  const { packs, seed } = raw as Start;
  const preps = await Promise.all(packs.map((p) => prep(p).catch(() => null))); // one undecodable pack is skipped, not fatal
  const ok = preps.flatMap((p, i) => (p ? [i] : []));
  if (ok.length === 0) { window.pixyOverload.done(); return; }
  const cast = castIndices(ok.length).map((k) => preps[ok[k]!]!);
  const W = window.innerWidth;
  const show = createShow(seed, cast.map((c) => c.member), W, window.innerHeight);
  const calmXs = calm ? calmX(show.plans, W) : [];
  const els = cast.map((c, i) => {
    const el = new Image();
    el.className = 'sp';
    el.src = c.idle;
    el.style.width = `${show.plans[i]!.w}px`;
    el.style.height = `${show.plans[i]!.h}px`;
    el.style.transformOrigin = `50% ${c.footY * 100}%`;
    if (calm) el.style.opacity = '0';
    document.body.append(el);
    return el;
  });
  const shown = els.map(() => '');
  const hearted = new Set<number>();
  const start = performance.now();
  let last = start;
  let ema = 0;
  window.__pixyOverload.count = els.length;

  let announced = false;
  const frame = (): void => {
    if (!announced) { announced = true; window.pixyOverload.started(); }
    const w0 = performance.now();
    const t = w0 - start;
    const dt = Math.min(0.05, (w0 - last) / 1000);
    last = w0;
    if (!calm) show.step(t, dt, cursorX);
    show.sprites.forEach((s, i) => {
      const c = cast[i]!;
      const p = show.plans[i]!;
      const el = els[i]!;
      const px = p.w / c.idleW;
      let src = c.idle;
      let x = s.x;
      let y = window.innerHeight - p.h * c.footY + s.lift;
      let rot = 0;
      let sx = 1;
      let sy = 1;
      let flip = 1;
      if (calm) {
        el.style.opacity = String(calmAlpha(t, p.dropAt));
        x = calmXs[i]!;
        y = window.innerHeight - p.h * c.footY;
      } else if (s.mode === 'wait' || s.gone) {
        el.style.transform = 'translate(-9999px, 0)';
        return;
      } else {
        flip = Math.sign(mirrorScale(s.mir, t, TURN_MS));
        const u = mirrorProgress(s.mir, t, TURN_MS);
        const dir = s.mir.to;
        const gp = gaitParams(t >= T.conga ? 'trot' : 'walk'); // the conga and the exit trot
        const stride = c.strideFrac * p.w * gp.reach;
        if (c.flier && c.walk.length) src = c.walk[Math.floor((t / 1000) * c.fps) % c.walk.length]!;
        else if (s.v > 0 && u >= 1 && c.walk.length) src = c.walk[walkFrame(s.walked, c.walk.length, stride, c.spans)]!;
        if (u < 1) {
          const ht = hopTurn(u, s.turnH);
          y += ht.dy; sx = ht.sx; sy = ht.sy;
          if (c.turn) { // through the front view; the mirror flips once, while it is drawn
            const tf = turnFrame(u);
            if (tf.idx !== 2) src = c.turn[tf.idx]!;
            flip = tf.mirrorFromFacing ? s.mir.from : s.mir.to;
          }
        }
        else if (c.flier) rot = lean(dir, 0.5) + 3 * Math.sin(flyLift(p, t) / 12);
        else if (s.v > 0) {
          if (c.drawn) {
            const b = walkBody(s.walked / (stride * c.walk.length), p.h, gp, c.body);
            y += b.dy; sx = b.sx; sy = b.sy;
            rot = lean(dir, s.v / MAX_SPEED) - b.rot * dir;
          } else {
            const g = boundGait(s.walked, stride, p.h);
            y += g.dy; sx = g.sx; sy = g.sy;
            rot = lean(dir, s.v / MAX_SPEED) + g.rot * dir;
          }
        }
        if (t - s.hopAt >= 0 && t - s.hopAt < HOP_WINDOW_MS) {
          const h = hop(t - s.hopAt);
          y += h.dy; sy *= h.sy;
          if (!hearted.has(i)) { hearted.add(i); heart(s.x + p.w / 2, y - p.h * 0.6); }
        }
        if (t - s.landAt < LAND_SQUASH_MS) sy *= landSquash(t - s.landAt, s.landV);
      }
      if (src !== shown[i]) {
        shown[i] = src;
        el.src = src;
        el.style.width = `${(c.natW.get(src) ?? c.idleW) * px}px`;
      }
      const fw = (c.natW.get(src) ?? c.idleW) * px;
      el.style.transform = petTransform(x + (p.w - fw) / 2, y, rot, flip, sx, sy);
    });
    ema = ema * 0.9 + (performance.now() - w0) * 0.1;
    window.__pixyOverload = { frameMs: ema, count: els.length, t };
    if (t >= SHOW_MS || (!calm && show.done)) window.pixyOverload.done();
    else requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

window.pixyOverload.onStart((p) => { begin(p).catch(() => window.pixyOverload.done()); });
