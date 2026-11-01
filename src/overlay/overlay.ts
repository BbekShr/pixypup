import pupUrl from '../../assets/placeholder/pup.png';
import { next, type PetState } from './state';

declare global {
  interface Window {
    pixy: { setClickThrough(on: boolean): void; onCommand(cb: (cmd: string) => void): void };
  }
}

const SIZE = 120;
const SPEED = 60; // px/s
const img = document.getElementById('pup') as HTMLImageElement;
img.src = pupUrl;

let state: PetState = 'walk';
let x = 100;
let y = window.innerHeight - SIZE;
let dir = 1;
let last = performance.now();

function render(): void {
  img.style.transform = `translate(${x}px, ${y}px) scaleX(${dir})`;
}

function frame(now: number): void {
  const dt = (now - last) / 1000;
  last = now;
  if (state === 'walk') {
    x += dir * SPEED * dt;
    const max = window.innerWidth - SIZE;
    if (x <= 0) { x = 0; dir = 1; }
    else if (x >= max) { x = max; dir = -1; }
  }
  render();
  requestAnimationFrame(frame);
}

// transform includes translate, so pin the element at 0,0
img.style.transformOrigin = 'center';

img.addEventListener('mouseenter', () => window.pixy.setClickThrough(false));
img.addEventListener('mouseleave', () => {
  if (!dragging) window.pixy.setClickThrough(true);
});

let dragging = false;
let offX = 0;
let offY = 0;
img.addEventListener('pointerdown', (e) => {
  dragging = true;
  offX = e.clientX - x;
  offY = e.clientY - y;
  img.setPointerCapture(e.pointerId);
  state = next(state, 'dragStart');
});
img.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  x = e.clientX - offX;
  y = e.clientY - offY;
});
img.addEventListener('pointerup', (e) => {
  if (!dragging) return;
  dragging = false;
  img.releasePointerCapture(e.pointerId);
  state = next(state, 'dragEnd');
  // mouseleave was skipped mid-drag; without this the overlay would swallow every click.
  if (!img.matches(':hover')) window.pixy.setClickThrough(true);
});

requestAnimationFrame(frame);
