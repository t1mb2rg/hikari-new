// The durable fact family of the authorization, and the one rule that decides whether one is written.
//
// A durable fact is not a record that a command arrived. It is a record of something that happened and
// will still have to be provable later, and this file is where the authorization states which of its
// own occurrences qualify. Three of the four words move the set, so there are three types here;
// `status` asks and changes nothing, and a family that admitted it would be a log of questions.
//
// Only the semantic owner of a concern admits a fact about it, and only the proposition that owner is
// entitled to assert. This is the owner: the payload is built from the transition that just happened,
// and never derived afterwards from the state as it stands at read time.
//
// Where this family differs from the work focus's, and why:
//
//   - **It is read back.** A work focus starts empty on every activation and never reads its history;
//     this authorization is persistent by ruling, so a new activation rebuilds the set from here. That
//     is the reason every payload carries the *complete set the transition left behind* rather than
//     only what the word did — a reader that wants yesterday's answer gets it from one fact instead of
//     by replaying a sequence, and there is no second place the set could disagree with itself.
//   - **`cleared` carries nothing.** The one case where the resulting set is not worth a field: an
//     empty set can only hold one value, so a payload repeating it would be a field with one legal
//     content. A reader reconstructing from it knows the answer without being told.
//
// What is deliberately absent is anything a fact might be *judged* by — no importance, no expiry, no
// confidence, no reading of what a directory means, and no statement about what the authorization
// permitted. Chronicle stores that an authority was declared. It does not explain what it authorizes.

import type { FactDraft } from '../chronicle/types.js';
import type { ChangeableRepositoriesState } from './state.js';
import type { ChangeableRepositoriesRequest } from './types.js';

/** The only version this family speaks. A reader that meets another one must not guess at it. */
const CHANGEABLE_REPOSITORIES_FACT_VERSION = 1;

/**
 * What is provable about where this fact came from, and it is less than "a human".
 *
 * The ingress has no authentication: anything on this host that can open the pipe can state an
 * authorization, so a fact claiming `human` would be asserting an identity that nothing here
 * established. `durable-fact-admission-v0.md` forbids exactly that claim. What this plugin can prove
 * is that the request arrived through its own endpoint and was accepted, and that is what it says.
 *
 * The distinction is worth more here than it is for a work focus, not less: this fact is the record
 * of a permission, and the one thing a record of a permission must never do is imply that a
 * particular person granted it when all that was verified is that a request arrived.
 */
const CHANGEABLE_REPOSITORIES_SOURCE_KIND = 'changeable-repositories.declaration';

/**
 * The draft this request admits, or `undefined` when it admits none.
 *
 * The caller has already decided that the set moved; this answers the other half of the question —
 * which proposition, in this owner's vocabulary, the movement is. `status` is the word that never
 * moves anything, so this family has no type for it, and answering `undefined` rather than throwing is
 * what makes the caller's rule total: it asks what to admit, and "nothing" is one of the answers.
 */
export function changeableRepositoriesFactDraft(
  request: ChangeableRepositoriesRequest,
  next: ChangeableRepositoriesState,
): FactDraft | undefined {
  if (request.word === 'status') return undefined;

  // Read once, here, at the moment the occurrence is being recorded. `occurredAt` is when the change
  // happened rather than when the fact was written down; a single reading cannot disagree with itself,
  // and nothing else in this draft needs a clock.
  const occurredAt = new Date().toISOString();
  const source = { kind: CHANGEABLE_REPOSITORIES_SOURCE_KIND } as const;

  // `clear` has nothing to add: the proposition is the whole of what it did, and a payload repeating
  // the empty set would be a field that can only ever hold one value.
  if (request.word === 'clear') {
    return {
      type: 'changeable-repositories.cleared',
      version: CHANGEABLE_REPOSITORIES_FACT_VERSION,
      occurredAt,
      source,
      payload: {},
    };
  }

  // A copy, not the state's own array: the fact is a snapshot of the set as this transition left it,
  // and sharing the live reference would make the two the same object for no reason either needs.
  //
  // The two moving words differ in the `type` and in nothing else. That is not an accident of shaping:
  // `declare` and `replace` differ only in whether the earlier members survive, and by the time the
  // transition has happened that difference is entirely contained in the set each one leaves behind.
  // A reader that needs to know which word it was is reading a log of commands rather than a record of
  // what the authority became.
  return {
    type: request.word === 'declare'
      ? 'changeable-repositories.declared'
      : 'changeable-repositories.replaced',
    version: CHANGEABLE_REPOSITORIES_FACT_VERSION,
    occurredAt,
    source,
    payload: { repositories: [...next.repositories] },
  };
}
