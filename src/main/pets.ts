// Pure rules for several pets, one overlay window each. Electron-free so vitest can run them.
export const MAX_PETS = 4;

/** Every pet's slug, primary first. An empty or missing `pets` means just the primary. */
export const petList = (s: { petName: string; pets?: string[] }): string[] => (s.pets && s.pets.length > 0 ? s.pets : [s.petName]);

/** The list with `slug` appended, or null at the cap or for a duplicate. */
/** APFS folds case, so "Pakkun" and "pakkun" are one folder. */
export const takenSlug = (list: string[], slug: string): boolean => list.some((s) => s.toLowerCase() === slug.toLowerCase());

export const addPet = (list: string[], slug: string): string[] | null => (list.length >= MAX_PETS || takenSlug(list, slug) ? null : [...list, slug]);

/** The list without `slug`, or null if it isn't there or is the last pet. */
export const removePet = (list: string[], slug: string): string[] | null => (list.length < 2 || !list.includes(slug) ? null : list.filter((s) => s !== slug));

/**
 * Windows whose slug is no longer in the list, paired with a listed slug that has no window yet, in order:
 * replace-mode onboarding renames the primary, and its window must follow.
 */
export function rekeyWins<T>(wins: ReadonlyMap<string, T>, list: string[]): [string, string][] {
  const orphans = [...wins.keys()].filter((k) => !list.includes(k));
  const free = list.filter((s) => !wins.has(s));
  return orphans.slice(0, free.length).map((k, i) => [k, free[i]!]);
}

/** Only a window main created for exactly this slug; an unknown or missing sender must never reach another pet's window. */
export const pickWindow = <T>(wins: ReadonlyMap<string, T>, slug: string | undefined): T | undefined => (slug === undefined ? undefined : wins.get(slug));

export interface Reaction { seq: number; action: string }

/** Screen reactions: a call hides every pet; a sniff or celebration is the primary's, the others just perk up. */
export function routeReaction<B extends Reaction>(slugs: string[], b: B): [string, B | { seq: number; action: 'perk_up'; reason: string }][] {
  if (b.action === 'hide' || b.action === 'perk_up') return slugs.map((s) => [s, b]);
  return slugs.map((s, i) => [s, i === 0 ? b : { seq: b.seq, action: 'perk_up' as const, reason: 'friend noticed something' }]);
}
