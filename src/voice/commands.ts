export type Command = 'sit' | 'roll' | 'bed' | 'come';

const PATTERNS: [Command, RegExp][] = [
  ['sit', /\bsit\b/],
  ['roll', /\broll(\s+over)?\b/],
  ['bed', /\bgo\s+to\s+(your\s+)?bed\b|\bbed\b/],
  ['come', /\bcome(\s+here)?\b/],
];

export function matchCommand(transcript: string, petName: string): Command | null {
  const t = transcript.toLowerCase();
  if (!petName || !t.includes(petName.toLowerCase())) return null;
  for (const [cmd, re] of PATTERNS) if (re.test(t)) return cmd;
  return null;
}
