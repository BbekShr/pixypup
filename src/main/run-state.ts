export interface Progress { kind: 'cutout' | 'pose'; name: string; url: string }

/** The one pet-making run in flight. `id` is its token: events from any other run are ignored. */
export interface Run { id: number; name: string; species: 'dog' | 'cat'; progress: Progress[] }
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

export const finishRun = (r: Runs, id: number): Runs => (r.current?.id === id ? { ...r, current: null } : r);
