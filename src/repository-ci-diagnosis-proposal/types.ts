// What this domain proposes, as a value another module can be handed.
//
// It carries facts and a kind. It carries no words, for the reason
// `repository-ci-attention/types.ts` gives for the same rule: a material that carried the sentence would
// let whoever built it decide what Hikari says. The sentence is produced by Language's own renderer, on
// the far side of the contract.
//
// There is no `lines`, no `text` and no `message` here, and there is deliberately no free-form
// `summary` either. `kind` names which of a closed set of suggestions this is; the fields below it are
// the facts that suggestion rests on, named so that a reader can check them rather than take them.

import type { RepositoryCiCommitAssessment, RepositoryCiCommitComparison } from '../repository-ci-awareness/types.js';
import type { RepositoryCiAttentionOccurrence } from '../repository-ci-attention/types.js';
import type { RepositoryChangeActionRecord } from '../repository-change-executor/index.js';

/**
 * The facts a suggestion rests on, all of them named and all of them somebody else's.
 *
 * `commitComparison` is `repository-ci-awareness`'s verdict, `designation` is the string
 * `repository-ci-relevance` reported as the one that made this failure relevant, and the rest are the
 * occurrence's own fields. Nothing here is derived on this layer: the point of listing them is that the
 * suggestion can be re-read against the facts it claims to rest on.
 *
 * `designation` is `undefined` only when the relevance judgement is not `relevant` — and in that case
 * this type is not produced at all. It is `| undefined` rather than non-optional because the judgement's
 * own union is what decides that, and pinning it here would be this file re-deciding a verdict it does
 * not own.
 */
export interface RepositoryCiDiagnosisEvidence {
  /** GitHub's own `owner/name` spelling, exactly as the occurrence carried it. */
  readonly repository: string;
  readonly runId: number;
  /** The commit GitHub reported for the failing run, verbatim. */
  readonly headSha: string;
  readonly commitComparison: RepositoryCiCommitComparison;
  /** The designation `repository-ci-relevance` matched on, when it matched at all. */
  readonly designation: string | undefined;
}

/**
 * The same facts, plus what somebody else's record says about the commit this run ran against.
 *
 * `ownAction` is not derived and not judged here: it is the executor's own answer, in the executor's own
 * words, to the question "did you push this commit?". This type exists so that the suggestion can name
 * *which* earlier record it is talking about — `factId` and the time it happened — rather than saying
 * "an earlier action of Hikari's" and leaving a reader to go and look.
 *
 * It carries no cause. That the failing run ran against a commit this executor pushed is a string
 * equality, three of them in fact, and it is not evidence that the push caused anything. The renderer is
 * where that limit has to survive, and `render.ts` is written to say so in the sentence a human reads.
 */
export interface RepositoryCiDiagnosisOwnActionEvidence extends RepositoryCiDiagnosisEvidence {
  readonly ownAction: RepositoryChangeActionRecord;
}

/**
 * Why no suggestion could be made.
 *
 * Three values and no fourth: each names a material this layer was entitled to ask for and did not get.
 * They exist so that "no suggestion" is a result a test can assert and a reader can tell apart from a
 * plugin that never ran, a transport that was down, or a defect — the distinction
 * `repository-ci-diagnosis-proposal` review §3.3 requires.
 */
export type RepositoryCiDiagnosisMissing =
  | 'no-github-ci-facet'
  | 'relevance-not-established'
  | 'commit-comparison-indeterminate';

/**
 * One suggestion, or the statement that there is none.
 *
 * The three suggestions are not three manners of saying the same thing. `check-commit-alignment` and
 * `inspect-run-steps` are two different suggestions, derived from two different facts, and a later
 * change that made them one sentence would be the failure `§4 ③` of the review names outright: a
 * notification template wearing a domain judgement's clothes. `insufficient-evidence` is not a third
 * suggestion at all — it is the absence of one, and the caller is expected to fall back to the plain
 * announcement rather than to invent words for this arm.
 *
 * `inspect-own-action` is the third suggestion and it replaces `check-commit-alignment`, never joins it:
 * when the commit the run ran against is one this executor's record says it pushed, "which version am I
 * looking at?" is no longer the weaker-but-honest thing to ask — the answer to it is already known, and
 * the thing worth looking at is that earlier run's own record. The other two arms are untouched by it,
 * deliberately: `same`'s suggestion is still the right one, and `indeterminate` still has nothing
 * specific to say (`docs/architecture/repository-change-history-readback-v0-boundary-review.md` §2.3).
 */
export type RepositoryCiDiagnosisProposal =
  | { readonly kind: 'check-commit-alignment'; readonly evidence: RepositoryCiDiagnosisEvidence }
  | { readonly kind: 'inspect-run-steps'; readonly evidence: RepositoryCiDiagnosisEvidence }
  | { readonly kind: 'inspect-own-action'; readonly evidence: RepositoryCiDiagnosisOwnActionEvidence }
  | { readonly kind: 'insufficient-evidence'; readonly missing: RepositoryCiDiagnosisMissing };

/**
 * The arms that are actually a suggestion, and the type Language's renderer accepts.
 *
 * The absence is not in this type, and that is the guarantee rather than a convention: a caller holding
 * one of these cannot be holding "there is nothing to suggest", because a suggestion that does not exist
 * cannot be handed to a renderer. The alternative — one type covering every arm and a renderer that
 * prints nothing for the last — would make "we had nothing to say" a thing Hikari can be made to say,
 * and would put the caller's decision about which case it is inside a renderer that has no business
 * making it.
 */
export type RepositoryCiDiagnosisSuggestion = Extract<
  RepositoryCiDiagnosisProposal,
  { readonly kind: 'check-commit-alignment' | 'inspect-run-steps' | 'inspect-own-action' }
>;

/**
 * What the caller hands over: the failure it is about to announce, and the one assessment the cycle
 * acquired.
 *
 * The assessment comes in rather than being fetched, and that is the whole of Finding 2's answer: the
 * failing run and the commit comparison must come out of **one** acquirement, so the failing run and the
 * thing it is compared against cannot describe two different moments. A module that acquired its own
 * would be a second reader of the same world in the same cycle, and "the two reads happened to agree"
 * is not a property anyone can stand behind.
 */
export interface RepositoryCiDiagnosisRequest {
  readonly occurrence: RepositoryCiAttentionOccurrence;
  readonly assessment: RepositoryCiCommitAssessment;
}
