/** Pose tiles on the birth screen, plus the cutout: the ribbon fills as these arrive. */
export const BIRTH_STEPS = 8;

/** 0..1 by what has arrived; never a percentage on screen, and never full before everything is in. */
export const ribbonFraction = (cutout: boolean, poseTiles: number): number =>
  Math.min(1, Math.max(0, ((cutout ? 1 : 0) + Math.min(poseTiles, BIRTH_STEPS - 1)) / BIRTH_STEPS));

export const copyLines = (name: string): string[] => [`Learning ${name}'s ears…`, 'Practising the sit…', 'Fluffing the fur…', 'Almost ready to say hi…'];

/** Cycles the first lines every tick; the last one waits until the ribbon is nearly full so it is never a lie. */
export function copyFor(lines: string[], tick: number, fraction: number): string {
  const last = lines[lines.length - 1]!;
  return fraction >= 0.75 ? last : lines[tick % (lines.length - 1)]!;
}

export interface Copy { text: string; fact?: number }

/**
 * With facts in hand the rotation alternates the pet's own voice with "Did you know?" cards;
 * the final "almost ready" line still waits for the ribbon. `fact` is the index the source link refers to.
 */
export function nextCopy(lines: string[], voice: string[], facts: { text: string }[], tick: number, fraction: number): Copy {
  if (fraction >= 0.75 || facts.length === 0) return { text: copyFor([...lines.slice(0, -1), ...voice, lines[lines.length - 1]!], tick, fraction) };
  const k = Math.floor(tick / 2);
  if (tick % 2 === 1) return { text: `Did you know? ${facts[k % facts.length]!.text}`, fact: k % facts.length };
  const pool = [...lines.slice(0, -1), ...voice];
  return { text: pool[k % pool.length]! };
}
