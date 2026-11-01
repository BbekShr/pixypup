export type Step = 'welcome' | 'photo' | 'name' | 'key' | 'making' | 'failed' | 'done';
export type Code = 'bad-key' | 'no-pet-found' | 'network' | 'generation-failed';

export interface Flow {
  step: Step;
  needsKey: boolean;
  /** Set when we bounce back to a step because of what went wrong, so the page can say so in the pet's voice. */
  error?: Code;
}

export type FlowEvent =
  | { t: 'start' }
  | { t: 'photo' }
  | { t: 'named' }
  | { t: 'key-saved' }
  | { t: 'back' }
  | { t: 'retry' }
  | { t: 'fail'; code: Code }
  | { t: 'success' };

export const initialFlow = (needsKey: boolean, fromMenu: boolean): Flow => ({ step: fromMenu ? 'photo' : 'welcome', needsKey });

export function advance(f: Flow, ev: FlowEvent): Flow {
  const to = (step: Step, error?: Code): Flow => ({ step, needsKey: f.needsKey, ...(error ? { error } : {}) });
  switch (ev.t) {
    case 'start': return f.step === 'welcome' ? to('photo') : f;
    case 'photo': return f.step === 'photo' ? to('name') : f;
    case 'named': return f.step === 'name' ? to(f.needsKey ? 'key' : 'making') : f;
    case 'key-saved': return f.step === 'key' ? to('making') : f;
    case 'back': return f.step === 'name' ? to('photo') : f.step === 'key' ? to('name') : f;
    case 'retry': return f.step === 'failed' ? to('making') : f;
    case 'success': return f.step === 'making' ? to('done') : f;
    case 'fail':
      if (f.step !== 'making') return f;
      if (ev.code === 'bad-key') return { step: 'key', needsKey: true, error: 'bad-key' };
      return ev.code === 'no-pet-found' ? to('photo', ev.code) : to('failed', ev.code);
  }
}
