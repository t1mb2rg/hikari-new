// The durable fact family of the work focus, and the one rule that decides whether one is written.
//
// A durable fact is not a record that a command arrived. It is a record of something that happened and
// will still have to be provable later, and this file is where the work focus states which of its own
// occurrences qualify. Three of the four words move the set, so there are three types here; `status`
// asks and changes nothing, and a family that admitted it would be a log of questions.
//
// Only the semantic owner of a concern admits a fact about it, and only the proposition that owner is
// entitled to assert. This is the owner: the payload is built from the transition that just happened,
// and never derived afterwards from `current()`. A fact reconstructed from the state as it stands at
// read time would describe whatever the set had become by then, and would quietly disagree with the
// state at the moment it claims to be about.
//
// What is deliberately absent is anything a fact might be *judged* by — no importance, no salience, no
// confidence, no relation to another fact, no reading of what a designation means. Chronicle stores
// what happened. It does not explain what it means.

import type { FactDraft } from '../chronicle/types.js';
import type { WorkFocusState } from './state.js';
import type { WorkFocusRequest } from './types.js';

/** The only version this family speaks. A reader that meets another one must not guess at it. */
const WORK_FOCUS_FACT_VERSION = 1;

/**
 * What is provable about where this fact came from, and it is less than "a human".
 *
 * The ingress has no authentication: anything on this host that can open the pipe can state a work
 * focus, so a fact claiming `human` would be asserting an identity that nothing here established.
 * What this plugin can actually prove is that the request arrived through its own endpoint, and that
 * is what it says. A narrower claim that is true is worth more than a larger one that is not.
 */
const WORK_FOCUS_SOURCE_KIND = 'work-focus.endpoint';

/**
 * The draft this request admits, or `undefined` when it admits none.
 *
 * The caller has already decided that the set moved; this answers the other half of the question —
 * which proposition, in this owner's vocabulary, the movement is. `status` is the word that never
 * moves anything, so this family has no type for it, and answering `undefined` rather than throwing
 * is what makes the caller's rule total: it asks what to admit, and "nothing" is one of the answers.
 */
export function workFocusFactDraft(
  request: WorkFocusRequest,
  next: WorkFocusState,
): FactDraft | undefined {
  if (request.word === 'status') return undefined;

  // Read once, here, at the moment the occurrence is being recorded. `occurredAt` is when the change
  // happened rather than when the fact was written down; a single reading cannot disagree with itself,
  // and nothing else in this draft needs a clock.
  const occurredAt = new Date().toISOString();
  const source = { kind: WORK_FOCUS_SOURCE_KIND } as const;

  // The three payloads are shaped by what each word means, and each carries what that word did rather
  // than the set it left behind. A `declare` is one designation arriving — the one the human named,
  // byte for byte as `state.ts` accepted it — and not the set, which the resulting `replaced` would
  // have carried and which a reader who wants it can get from the next fact or from `current()`.
  if (request.word === 'declare') {
    return {
      type: 'work-focus.declared',
      version: WORK_FOCUS_FACT_VERSION,
      occurredAt,
      source,
      payload: { designation: request.designation },
    };
  }

  // `clear` has nothing to add: the proposition is the whole of what it did, and a payload repeating
  // the empty set would be a field that can only ever hold one value.
  if (request.word === 'clear') {
    return {
      type: 'work-focus.cleared',
      version: WORK_FOCUS_FACT_VERSION,
      occurredAt,
      source,
      payload: {},
    };
  }

  // A copy, not the state's own array: the fact is a snapshot of the set as this transition left it,
  // and sharing the live reference would make the two the same object for no reason either needs.
  return {
    type: 'work-focus.replaced',
    version: WORK_FOCUS_FACT_VERSION,
    occurredAt,
    source,
    payload: { designations: [...next.designations] },
  };
}
