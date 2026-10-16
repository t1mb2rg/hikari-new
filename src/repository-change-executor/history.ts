// The executor's own history, read back — one question, asked of the facts this owner wrote.
//
// The question is exactly this and nothing wider:
//
//     **did one of my runs push *this* commit?**
//
// It is not "what have I done", not "when did I last run", not "show me the history". The answer is a
// single record or nothing, because the one consumer that exists today (`repository-ci-diagnosis-proposal`,
// via `contracts.ts`) needs to know whether the commit a failing CI run ran against is one this executor
// pushed — a yes/no with a date and a fact id attached so the answer can be checked rather than taken.
//
// Why this is a file of its own rather than a method on the plugin: the rule is a pure function over
// facts, the way `judgement.ts` is a pure function over a snapshot, so CI can test it without a pipe, a
// process or a store. `plugin.ts` supplies the facts; this file decides what they say.
//
// **What "this commit" means: two verbatim equalities and one case-insensitive one, and the split is a
// decision that is recorded rather than folded in.**
//
//   1. the repository, compared **without regard to case**, equals the record's own `repository` field;
//   2. the commit, as reported by the source that asked, equals the record's `headAfter` — the commit the
//      run left `HEAD` at;
//   3. the record says the run **pushed** (`pushed === true`, the three-state field's strongest value).
//
// The commit id and the push claim are compared verbatim: those are the claims being made. The repository
// is not, and that is an **amendment** (2026-10-16) to §2.2 of
// `docs/architecture/repository-change-history-readback-v0-boundary-review.md`, which said "verbatim" for
// all three and listed case folding among the failure conditions. Reproductions showed why verbatim is
// wrong for this one field: the two sides are spelled by different authorities — the run's repository is
// the GitHub API's canonical `full_name`, the record's is the local remote URL's spelling (and therefore
// the mandate's) — and GitHub itself treats owner and repository names as case-insensitive. A verbatim
// comparison drops the association silently, and a silent drop is indistinguishable from "there is no
// such record": a false negative that hides a true one, with a sentence that reads as if the run's commit
// had come from somewhere else. Nothing else about the comparison moved.
//
// Still no trimming, no prefix matching, no walking the commit graph, and no "close enough". A string
// equality is a string equality and it is not a claim about causation: that the failing run ran a commit
// this executor pushed does **not** mean the push caused the failure, and no renderer is allowed to make
// it sound like one (`repository-ci-diagnosis-proposal/render.ts` carries the same rule).
//
// **Why `headAfter` and not the recorded `ciRunId`:** a commit that is re-run is a new run id, so an id
// equality would miss the very case this is for — the same pushed commit, run again, failing now. The
// commit is the thing that was pushed; the run id is a fact about GitHub's queue.
//
// **`outcome` is deliberately not read.** The record has a three-state outcome and a `halt`, and this
// reader ignores both: the question is whether *this commit went up*, not whether the run was tidy. A run
// that pushed and then died is exactly the kind of record a reader must not silently drop.
//
// **Failure policy, in the direction this repository always takes:** nothing here throws and nothing here
// guesses. A fact of another type is skipped, because the store is shared; a version this code has never
// seen is skipped, because a shape you have not read is not a shape you may interpret; a payload that
// does not carry the three fields at their types is skipped, because a file can be edited and reading a
// commit out of a mangled payload would be inventing one. An empty answer means **"my record does not say
// so"**, and it covers both "there is no such fact" and "there is one and it does not claim a push".
// This layer does not distinguish those two, because no consumer needs the difference yet; a consumer
// that does need it will have to ask for it explicitly rather than read it out of this return value.

import type { DurableFact } from '../chronicle/types.js';

import { REPOSITORY_CHANGE_FACT_TYPES } from './facts.js';

/**
 * The one version of the result fact this reader knows the shape of.
 *
 * Written here rather than imported from `facts.ts`, and that is deliberate: a reader that followed the
 * writer's constant would start interpreting a version 2 the day the writer bumps it, on the strength of
 * a name. A reader may only read what it has been taught, so the number it has been taught lives with the
 * reader.
 */
const READABLE_RESULT_VERSION = 1;

/** What the caller wants to know: this repository, this commit. */
export interface RepositoryChangeActionQuery {
  /** Spelled by the caller — today, GitHub's own `owner/name` spelling, taken from the failing run. */
  readonly repository: string;
  /** The commit the caller is asking about, verbatim (today: the run's `headSha`). */
  readonly commit: string;
}

/**
 * The answer, when there is one: which run it was, and which fact says so.
 *
 * Two fields and neither is decoration. `occurredAt` is what the record itself says about when, and
 * `factId` is what makes the answer checkable — a consumer can hand it back to the chronicle and read the
 * same line this function read. There is no `mandate`, no outcome and no evidence here: this is not a
 * summary of the run, it is a pointer to the record, and widening it would make this module the second
 * place where a run is described.
 */
export interface RepositoryChangeActionRecord {
  readonly occurredAt: string;
  readonly factId: string;
}

/**
 * The most recent run of this executor whose record says it pushed this commit, or `undefined`.
 *
 * "Most recent" is decided by `occurredAt` — the timestamps this family writes are ISO 8601 UTC strings
 * from one clock, so lexicographic order is chronological order — and a tie is broken by the larger
 * `factId`, so the answer is a function of the facts rather than of the order they happened to be read
 * in.
 */
export function findPushedCommit(
  facts: readonly DurableFact[],
  query: RepositoryChangeActionQuery,
): RepositoryChangeActionRecord | undefined {
  let found: DurableFact | undefined;

  for (const fact of facts) {
    if (fact.type !== REPOSITORY_CHANGE_FACT_TYPES.result) continue;
    if (fact.version !== READABLE_RESULT_VERSION) continue;

    const payload: unknown = fact.payload;
    if (typeof payload !== 'object' || payload === null) continue;

    // An array arrives here as an object whose named fields are absent, so it falls out on the checks
    // below rather than needing one of its own. What matters is that no shape is *assumed* to be this
    // family's on the strength of its type alone.
    const fields = payload as {
      readonly repository?: unknown;
      readonly headAfter?: unknown;
      readonly pushed?: unknown;
    };

    // The repository is the one field compared without regard to case, and the reason is where the two
    // sides come from. The run's repository is what the GitHub API reports as the canonical `full_name`;
    // the record carries the spelling the local remote URL used, and therefore the spelling the mandate
    // used. GitHub itself treats owner and repository names as case-insensitive, so the same repository
    // legitimately arrives spelled two ways — and a verbatim comparison would drop the association
    // silently, which reads exactly like "there is no such record" (a false negative that hides a true
    // one). The commit id and `pushed === true` below stay verbatim: those are the claims being made.
    const repositoryMatches =
      typeof fields.repository === 'string' &&
      fields.repository.toLowerCase() === query.repository.toLowerCase();
    if (!repositoryMatches) continue;
    if (fields.headAfter !== query.commit) continue;
    // `true` and only `true`. `false` is "I did not push it" and `null` is "I could not tell" — neither
    // is the claim this reader is looking for, and treating the second as the first would turn an
    // unreadable record into an accusation.
    if (fields.pushed !== true) continue;

    if (found === undefined || isLater(fact, found)) found = fact;
  }

  return found === undefined
    ? undefined
    : Object.freeze({ occurredAt: found.occurredAt, factId: found.factId });
}

function isLater(candidate: DurableFact, current: DurableFact): boolean {
  if (candidate.occurredAt !== current.occurredAt) return candidate.occurredAt > current.occurredAt;
  return candidate.factId > current.factId;
}
