import type { BehaviorDecision } from '../../contracts/types';
import type { Observation } from '../screen/decide';

// TODO(F5): LLM behavior decision; must validate against contracts/behavior-decision.schema.json.
export function decideBehavior(_observation: Observation): Promise<BehaviorDecision> {
  throw new Error('not implemented');
}
