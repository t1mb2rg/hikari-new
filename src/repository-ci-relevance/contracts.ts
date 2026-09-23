// The relevance judgement, as a contract with the rest of Hikari.
//
// This Service was withheld for one round, and the reason it was withheld is the reason it exists now —
// the same shape `work-focus/contracts.ts` records for its own contract. What decides a contract here is
// whether something in the composition actually calls it, and until the repository-aware Language variant
// existed, nothing did: `hikari relevance` is a *client*, not a consumer, and it reaches this plugin over
// the plugin's own endpoint. A Service published to the whole composition in order to serve a client
// arriving through a pipe would have been published for nobody.
//
// Which half of the Contract Creation Gate was binding is worth stating, because the comment this file
// replaces named the right half and the distinction is what kept it unwritten for a round. The old
// comment said there was no callable need — nothing in the composition asked this plugin for a verdict,
// and the one thing that did was a client arriving through a pipe. That is §16.2, and §16.2 still
// decides: a real callable need is required. What §16.1 adds is only that the need does not have to be
// satisfied by a consumer that already exists — a consumer may be written in the same slice. So the
// obstacle was never "no consumer has been written yet"; it was that nothing called this judgement. The
// repository-aware Language variant is the first thing that does, and this contract lands in the same
// change as the exposure that names it, because a Service with no caller is exactly what §16.2 refuses.
//
// What it exposes is the judgement, and the whole of it: the same `RepositoryCiRelevanceJudgement` the
// endpoint answers with, from the same call. It does not expose the world snapshot, the designations or
// the awareness assessment it was computed from, and it says nothing about how the comparison was
// reached. It cannot subdivide `unknown` into causes: the judgement is a frozen `{ verdict: 'unknown' }`
// with no room for one, so subdividing would mean widening what this domain's verdict *is* — a change to
// the judgement, not to this contract, and one the renderer already refuses for the same reason.
//
// Nothing is held between calls. There is no cache, no stored last answer, and no second judgement: a
// caller that asks twice gets two independent comparisons of two independent snapshots, which is the
// only shape in which "relevance" is a question about now rather than a memory of a previous answer.

import { defineService } from '../runtime/contracts.js';

import type { RepositoryCiRelevanceJudgement } from './types.js';

export interface RepositoryCiRelevanceService {
  /**
   * The judgement, made now, from a freshly acquired focus set and a freshly acquired snapshot.
   *
   * `async` because both halves are: it pulls `work-focus.current@1` and the Repository CI awareness
   * assessment on every call. It never resolves a failure into `unknown` — a dependency that rejects
   * makes this reject, because `unknown` is a verdict this layer reached and a failed acquisition is a
   * comparison it did not get to make. A caller that wants the two told apart gets them told apart.
   */
  current(): Promise<RepositoryCiRelevanceJudgement>;
}

export const repositoryCiRelevanceService = defineService<RepositoryCiRelevanceService>(
  'repository-ci-relevance.current',
  1,
);
