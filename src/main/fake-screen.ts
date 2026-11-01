// Dev rehearsal (PIXY_FAKE_SCREEN=1, never in a packaged app): a scripted observation, so the full loop runs without any macOS permission.
import type { Observation } from '../screen/decide';

export function fakeReader(area: { x: number; y: number; width: number; height: number }) {
  const box = { x: area.x + area.width * 0.62, y: area.y + area.height * 0.3, w: 360, h: 16 };
  const observation: Observation = {
    windows: [{ owner: 'Terminal', title: 'fake', bounds: { x: box.x - 20, y: box.y - 120, w: 440, h: 300 } }],
    badge: null,
    terminalError: { text: 'FAIL src/math.test.ts > adds numbers', box },
  };
  return { tick: async () => ({ observation, changed: true, debug: { titlesRedacted: false, windowCount: 1, terminalKey: 'fake' } }) };
}
