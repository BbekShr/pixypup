import type { Personality, PetFact } from '../../contracts/types';

export interface Progress { kind: 'cutout' | 'pose'; name: string; url: string }

/** The one pet-making run in flight. `id` is its token: events from any other run are ignored. */
export interface Run { id: number; name: string; species: 'dog' | 'cat'; progress: Progress[]; personality?: Personality; facts?: PetFact[]; failed?: string[] }
export interface Runs { current: Run | null; last: number }

export const noRuns: Runs = { current: null, last: 0 };

/** null = busy: a second create while one is running must not start or disturb it. */
export function startRun(r: Runs, name: string, species: 'dog' | 'cat'): { runs: Runs; id: number } | null {
  if (r.current) return null;
  const id = r.last + 1;
  return { id, runs: { last: id, current: { id, name, species, progress: [] } } };
}

/** Keeps what a reopened window needs to replay: the cutout and the latest frame per pose. */
export function record(r: Runs, id: number, p: Progress): Runs {
  if (r.current?.id !== id) return r;
  const progress = [...r.current.progress.filter((q) => q.kind !== p.kind || q.name !== p.name), p];
  return { ...r, current: { ...r.current, progress } };
}

/** A fact as the page sees it: the URL stays in main; the page only learns whether a source link exists. */
export interface FactView { text: string; hasSource: boolean }

export const factViews = (facts: PetFact[]): FactView[] => facts.map((f) => ({ text: f.text, hasSource: httpsSource(f.source) !== null }));

/** The only URLs main will open: https, and only ever one of the received fact sources. */
export function httpsSource(url: string | undefined): string | null {
  try {
    return url !== undefined && new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** The URL for fact `index` of the run, or null. The page passes an index, never a URL. */
export const sourceFor = (r: Runs, index: unknown): string | null =>
  Number.isInteger(index) ? httpsSource(r.current?.facts?.[index as number]?.source) : null;

export function recordInfo(r: Runs, id: number, info: { personality: Personality } | { facts: PetFact[] }): Runs {
  if (r.current?.id !== id) return r;
  // Bounded: the pipeline already validates, but replayed state must never grow with model output.
  const facts = 'facts' in info ? { facts: info.facts.slice(0, 3) } : info;
  return { ...r, current: { ...r.current, ...facts } };
}

export const finishRun = (r: Runs, id: number): Runs => (r.current?.id === id ? { ...r, current: null } : r);

const SIDE_FRAMES = ['side_0', 'side_1', 'side_2', 'side_3'];

export function recordFailed(r: Runs, id: number, name: string): Runs {
  if (r.current?.id !== id) return r;
  const failed = [...new Set([...(r.current.failed ?? []), name])];
  return { ...r, current: { ...r.current, failed } };
}

/** The walk cycle is lost when the pipeline says so, or when every side frame failed. */
export const walkFailed = (run: Pick<Run, 'failed'> | null): boolean =>
  !!run?.failed && (run.failed.includes('walk') || SIDE_FRAMES.every((n) => run.failed!.includes(n)));
