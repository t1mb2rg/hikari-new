// What this plugin offers an intelligence layer, and why it is a *view* rather than a capability of its
// own.
//
// Hikari has one callable primitive and it is the Service. `core-architecture-v0.md` §5.3 froze that
// before this slice existed: Service is the Runtime's real primitive, a Capability is the view formed
// from a public Service, and a second truth source duplicating it is not maintained. So an agent-facing
// capability is not a new contract, not a second result type and not an entry in a registry — it is two
// strings and a pointer at a contract that already exists, exported beside it by the same owner.
//
// The owner is this plugin, and not the layer that consumes it. A name and a description of the work
// focus are claims about what the work focus *means*, and `principles.md` §6 splits the two roles
// accordingly: the provider owns the "how" and the semantics with it, the consumer owns the question of
// what to do with the result. The other split — which capabilities are actually offered to a model — is
// the consumer's and lives in the consumer. A consumer that wrote these words instead would be a second
// thing deciding what this domain's capability is called, and the day the two disagree the disagreeing
// is invisible, because a description is prose and prose has no compiler.
//
// `service` is a field rather than a comment so that "this exposure is a view of that Service" is a
// claim this plugin makes and a test can prove. It is the same frozen contract object `contracts.ts`
// exports, by reference: nothing is copied, nothing is registered, and the identity is assertable. It
// grants nothing — a consumer still has to be handed the Service through its own `requires`, and
// exposure is the answer to "what may be offered", never to "what is this caller allowed to do".
//
// Deliberately absent, and each one was considered rather than forgotten: an input schema, an output
// schema, an authority classification, a side-effect class, tags, categories, cost, model hints,
// examples, aliases and discovery keywords. Two read capabilities that take no arguments need none of
// them, and the field added for a caller that does not exist yet is precisely the "maybe somebody will
// want it" that the Contract Creation Gate §16 refuses. The list is here rather than in a design note
// because the cheapest moment to refuse a field is before the first one is added.

import type { ServiceContract } from '../runtime/contracts.js';

import { workFocusCurrentService, type WorkFocusCurrentService } from './contracts.js';

/**
 * What an intelligence layer is offered, and what it is offered about.
 *
 * Three fields, and the third is what keeps the first two honest: a name and a description with nothing
 * underneath them would be a label a consumer could attach to whichever Service it preferred.
 */
export interface WorkFocusReadExposure {
  /** The stable name a model selects this by. Agent-facing vocabulary, deliberately not a contract id. */
  readonly name: string;
  /** What the capability covers and, just as load-bearingly, what it does not. */
  readonly description: string;
  /** The public Service this is a view of. */
  readonly service: ServiceContract<WorkFocusCurrentService>;
}

/**
 * The work focus, as an intelligence layer may ask for it.
 *
 * The description is the whole of what a future model is told about this capability, so it carries the
 * limit as well as the offer. The set is what a human declared; reading what a human declared is not the
 * same as knowing what they are doing, and a surface that let the second be inferred from the first
 * would be answering a question this plugin was never given the facts for.
 */
export const workFocusReadExposure: WorkFocusReadExposure = Object.freeze({
  name: 'work_focus.read',
  description:
    '读取用户当前明确声明的工作焦点。结果只是用户明确声明过的那组 designation，不解释它们的含义，也不推断优先级、重要性，或者用户此刻实际正在做什么。',
  service: workFocusCurrentService,
});
