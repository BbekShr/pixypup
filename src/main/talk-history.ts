import { MAX_TURNS, type TalkReply, type Turn } from '../api/pet-talk';

/** A crisis turn is never added: the next normal message would otherwise carry it to Meta as history. */
export function nextHistory(history: Turn[], text: string, r: TalkReply): Turn[] {
  if (r.crisis) return history;
  return [...history, { role: 'user' as const, text }, { role: 'pet' as const, text: `${r.woof} (${r.caption})` }].slice(-MAX_TURNS);
}
