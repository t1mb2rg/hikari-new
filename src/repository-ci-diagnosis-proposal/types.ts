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
 * The three arms are not three manners of saying the same thing. `check-commit-alignment` and
 * `inspect-run-steps` are two different suggestions, derived from two different facts, and a later
 * change that made them one sentence would be the failure `§4 ③` of the review names outright: a
 * notification template wearing a domain judgement's clothes. `insufficient-evidence` is not a third
 * suggestion at all — it is the absence of one, and the caller is expected to fall back to the plain
 * announcement rather than to invent words for this arm.
 */
export type RepositoryCiDiagnosisProposal =
  | { readonly kind: 'check-commit-alignment'; readonly evidence: RepositoryCiDiagnosisEvidence }
  | { readonly kind: 'inspect-run-steps'; readonly evidence: RepositoryCiDiagnosisEvidence }
  | { readonly kind: 'insufficient-evidence'; readonly missing: RepositoryCiDiagnosisMissing };

/**
 * The two arms that are actually a suggestion, and the type Language's renderer accepts.
 *
 * The absence is not in this type, and that is the guarantee rather than a convention: a caller holding
 * one of these cannot be holding "there is nothing to suggest", because a suggestion that does not exist
 * cannot be handed to a renderer. The alternative — one type covering all three arms and a renderer that
 * prints nothing for the third — would make "we had nothing to say" a thing Hikari can be made to say,
 * and would put the caller's decision about which case it is inside a renderer that has no business
 * making it.
 */
export type RepositoryCiDiagnosisSuggestion = Extract<
  RepositoryCiDiagnosisProposal,
  { readonly kind: 'check-commit-alignment' | 'inspect-run-steps' }
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
