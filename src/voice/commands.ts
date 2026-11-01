export type Command = 'sit' | 'roll' | 'bed' | 'come' | 'bark';

const PATTERNS: [Command, RegExp][] = [
  ['sit', /\bsit\b/g],
  ['roll', /\broll(\s+over)?\b/g],
  ['bed', /\bgo\s+to\s+(your\s+)?bed\b|\bbed\b|\bnap\b/g],
  ['come', /\bcome(\s+here)?\b/g],
  ['bark', /\bbark\b|\bspeak\b/g],
];

function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

// Fuzzy only for names of 5+ chars: "pakun" for "Pakkun". Shorter names must match exactly.
const hasName = (words: string[], name: string) =>
  words.some((w) => w === name || (name.length >= 5 && distance(w, name) <= 1));

/** The last command in the utterance wins ("sit, no, roll over" -> roll). The pet's name is required. */
export function matchCommand(transcript: string, petName: string): Command | null {
  const name = petName.trim().toLowerCase();
  const t = transcript.toLowerCase().replace(/[^a-z0-9\s']/g, ' ').replace(/\s+/g, ' ');
  if (!name || !hasName(t.split(' '), name)) return null;
  let best: Command | null = null;
  let at = -1;
  for (const [cmd, re] of PATTERNS) for (const m of t.matchAll(re)) if (m.index > at) [best, at] = [cmd, m.index];
  return best;
}
