// The executor's history question, as a contract with the rest of Hikari.
//
// **Why this file exists at all, given the ruling that said it should not.** `index.ts` recorded, and
// `plugin.ts` repeated, that this slice deliberately published nothing: "a contract published before
// either of them arrives would be a contract shaped by nobody". The trigger written down then was a
// caller inside the composition that needs a *change made*. The caller that actually arrived does not
// want a change made — it wants to know whether a commit it is looking at is one this executor pushed.
//
// That is not the old trigger being satisfied by word-play, and it is not this module quietly widening
// its surface either. It is the same ruling applied again to a second capability: the shape of the
// contract is what the consumer needs and nothing more, and the consumer is real. The L2 review that
// approved this (`docs/architecture/repository-change-history-readback-v0-boundary-review.md`, NARROW)
// states the deviation in full, and the human confirmed it before any of this was written.
//
// **What is exposed is one question, not a query surface.** There is no list, no limit, no time range, no
// "recent N", no index and no cursor. A caller can ask about one repository and one commit and gets back
// one record or nothing. Every widening of this interface would be a capability that nobody has needed
// yet, published in advance of the need — which is exactly what the ruling above exists to prevent.
//
// **`undefined` means "my record does not say so"**, and it is deliberately one value rather than two: it
// covers "there is no such fact" and "there is such a fact and it does not claim a push". This layer does
// not tell those apart because no consumer has asked for the difference; a consumer that needs it will
// have to ask for it in so many words.
//
// **This contract never answers "may I act".** It reports what a past run recorded, and it is read only
// by a judgement that shapes a *suggestion* to a human. The executor's own permission to touch a
// repository is decided from the declaration set and the current state of the work tree, in `execute.ts`,
// and not one line of that path consults anything here. A history-driven decision to move the world is
// what `core-architecture-v0.md` §11's ninth invariant refuses.
//
// Nothing is held between calls: no cache, no last answer, no index. The answer is a function of the
// facts on disk at the moment the caller asks, and two calls a second apart are two readings.

import { defineService } from '../runtime/contracts.js';

import type { RepositoryChangeActionQuery, RepositoryChangeActionRecord } from './history.js';

export interface RepositoryChangeActionsService {
  /**
   * The most recent run of this executor whose record says it pushed this commit, or `undefined`.
   *
   * `async` because the facts are read from the chronicle on every call. It reads the whole store — the
   * chronicle has no filtered read in v1 — and that cost is stated in the review rather than hidden
   * behind an index that would be this slice's second feature.
   *
   * It does not reject when the store cannot be read: a reader that cannot read has nothing to say, and
   * `undefined` is that sentence. The caller is then expected to fall back to what it would have said
   * without any history at all, which is the direction every failure in this path takes — toward
   * speaking, never toward silence.
   */
  pushedCommit(query: RepositoryChangeActionQuery): Promise<RepositoryChangeActionRecord | undefined>;
}

export const repositoryChangeActionsService = defineService<RepositoryChangeActionsService>(
  'repository-change-executor.actions',
  1,
);
