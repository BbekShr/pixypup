// "Show what Pakkun sees": a local-only card for the demo video and curious users. The terminal text on it is
// screen data: validated and cut to 80 chars here, rendered with textContent only, never logged or stored.
export type Rect = { x: number; y: number; w: number; h: number };
export const GATES = ['off', 'admin', 'offline', 'snoozed', 'on'] as const;
export type Gate = (typeof GATES)[number];
export type DebugInfo = {
  ts: number;
  gate: Gate;
  terminal: { found: boolean; box?: Rect; text?: string };
  slack: string | null;
  call: boolean;
  decision: { action: string; reason: string; bubble?: string; source: 'rule' | 'spark+rule' | 'none' } | null;
  sparkMs?: number;
};
export type DebugMsg = { on: boolean; name?: string; info?: DebugInfo };

const SOURCES = ['rule', 'spark+rule', 'none'];
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' ? v.slice(0, max) : undefined);
const obj = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null);

function parseInfo(raw: unknown): DebugInfo | null {
  const r = obj(raw);
  const t = obj(r?.['terminal']);
  if (!r || !t || !num(r['ts']) || !GATES.includes(r['gate'] as Gate) || typeof t['found'] !== 'boolean' || typeof r['call'] !== 'boolean') return null;
  const info: DebugInfo = { ts: r['ts'], gate: r['gate'] as Gate, terminal: { found: t['found'] }, slack: str(r['slack'], 40) ?? null, call: r['call'], decision: null };
  const b = obj(t['box']);
  if (b && num(b['x']) && num(b['y']) && num(b['w']) && num(b['h'])) info.terminal.box = { x: b['x'], y: b['y'], w: b['w'], h: b['h'] };
  const text = str(t['text'], 80);
  if (text !== undefined) info.terminal.text = text;
  const d = obj(r['decision']);
  if (d && typeof d['action'] === 'string' && SOURCES.includes(d['source'] as string)) {
    info.decision = { action: d['action'].slice(0, 20), reason: str(d['reason'], 80) ?? '', source: d['source'] as 'rule' | 'spark+rule' | 'none' };
    const bubble = str(d['bubble'], 40);
    if (bubble) info.decision.bubble = bubble;
  }
  if (num(r['sparkMs'])) info.sparkMs = r['sparkMs'];
  return info;
}

export function parseDebug(raw: unknown): DebugMsg | null {
  const r = obj(raw);
  if (!r || typeof r['on'] !== 'boolean') return null;
  const m: DebugMsg = { on: r['on'] };
  const name = str(r['name'], 30);
  if (name) m.name = name;
  const info = r['info'] === undefined ? null : parseInfo(r['info']);
  if (info) m.info = info;
  return m;
}

const WHY: Record<Exclude<Gate, 'on'>, string> = { off: 'off', admin: 'off, set by your organisation', offline: 'off, offline mode', snoozed: 'off, snoozed' };

/** [label, value, mono?] rows; the panel only ever puts these into textContent. */
export function panelRows(i: DebugInfo | null): [string, string, boolean?][] {
  if (!i) return [['Notice my screen', 'waiting for the next look…']];
  const rows: [string, string, boolean?][] = [['Notice my screen', i.gate === 'on' ? 'on' : WHY[i.gate]]];
  if (i.gate !== 'on') return rows;
  rows.push(['Terminal', i.terminal.found ? 'failing line found' : 'nothing failing']);
  if (i.terminal.found && i.terminal.text) rows.push(['', i.terminal.text, true]);
  rows.push(['Slack', i.slack ?? '—'], ['Call', i.call ? 'yes' : 'no']);
  const d = i.decision;
  rows.push(['Decision', d ? `${d.action} · ${d.source}` : 'nothing to do']);
  if (d?.bubble) rows.push(['Bubble', `“${d.bubble}”`]);
  if (d?.source === 'spark+rule' && i.sparkMs !== undefined) rows.push(['', `by Muse Spark in ${(i.sparkMs / 1000).toFixed(1)} s`]);
  return rows;
}

const BOX_MS = 3000;
const sameBox = (a?: Rect, b?: Rect): boolean => !!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

export function createDebugPanel(calm: boolean): (raw: unknown) => void {
  const card = document.createElement('div');
  card.style.cssText = 'position:fixed;top:16px;right:16px;width:270px;box-sizing:border-box;padding:12px 14px;border-radius:var(--radius);background:var(--cream);border:2px solid var(--blush);color:var(--ink);font:600 13px/1.4 var(--font);box-shadow:var(--shadow);pointer-events:none;display:none';
  const title = document.createElement('div');
  title.style.cssText = 'font:800 15px var(--font);margin-bottom:6px';
  const body = document.createElement('div');
  card.append(title, body);
  const mark = document.createElement('div');
  mark.style.cssText = `position:fixed;display:none;box-sizing:border-box;border:2px dashed var(--blush);border-radius:6px;pointer-events:none;${calm ? '' : 'transition:opacity .4s'}`;
  document.body.append(card, mark);
  let name = 'Pakkun';
  let lastBox: Rect | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hideMark = (): void => { clearTimeout(timer); mark.style.display = 'none'; };

  return (raw) => {
    const m = parseDebug(raw);
    if (!m) return;
    if (m.name) name = m.name;
    const info = m.info ?? null;
    card.style.display = m.on && info?.gate !== 'snoozed' ? 'block' : 'none';
    if (!m.on || info?.gate !== 'on') { lastBox = undefined; hideMark(); }
    if (!m.on) return;
    title.textContent = `What ${name} sees`;
    body.replaceChildren(...panelRows(info).map(([k, v, mono]) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;justify-content:space-between';
      const key = document.createElement('span');
      key.textContent = k;
      key.style.color = 'var(--ink-soft)';
      const val = document.createElement('span');
      val.textContent = v;
      val.style.cssText = `text-align:right;min-width:0;overflow-wrap:anywhere;${mono ? 'font:12px ui-monospace,Menlo,monospace;text-align:left;width:100%' : ''}`;
      row.append(...(k ? [key, val] : [val]));
      return row;
    }));
    const box = info?.gate === 'on' ? info.terminal.box : undefined;
    if (!box) { lastBox = undefined; hideMark(); return; }
    if (sameBox(box, lastBox)) return; // same line still on screen: it already had its 3 s
    lastBox = box;
    Object.assign(mark.style, { display: 'block', opacity: '1', left: `${box.x - 4}px`, top: `${box.y - 3}px`, width: `${box.w + 8}px`, height: `${box.h + 6}px` });
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (calm) hideMark();
      else { mark.style.opacity = '0'; timer = setTimeout(hideMark, 400); }
    }, BOX_MS);
  };
}
