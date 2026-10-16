// The rule, as one pure function, exported so that CI checks it without a pipe.
//
// The question it answers is small on purpose: **for this one failure, which has already been judged
// relevant, is there a specific thing worth suggesting a human look at?** It is not "does this matter"
// (that was answered when relevance said `relevant`), not "is this important" (no layer in this
// repository owns that), and not "what should be done" (this module does not act).
//
// Every fact it reads was handed to it. It acquires nothing, remembers nothing, and holds nothing
// between calls: the same input produces the same answer forever, which is what makes the rule
// checkable and what makes `§4 ③` of the review a test rather than a hope.
//
// The three commit comparisons are read as three different situations and never collapsed:
//
//   different      the two reported commit strings are not equal — suggesting a human check which
//                  version they are looking at is supported by that string comparison and by nothing
//                  else. It is **not** a claim that the difference caused the failure, and the renderer
//                  is not allowed to make it sound like one.
//   same           the two strings are equal — the local tree reports the same commit the run ran
//                  against, so the useful next step is the run's own failing steps. This module has not
//                  read them and the suggestion has to say so; suggesting "look at the log" while
//                  implying the log has been read is the one failure mode worth writing this paragraph
//                  about.
//   indeterminate  the comparison could not be put — one of the two sources did not report. This is the
//                  arm where the honest answer is that there is no specific suggestion, and the caller
//                  falls back to announcing the failure plainly. Reading it as `same` or as `different`
//                  would be inventing the fact that was missing.
//
// What this function deliberately does not have is a fallback sentence, a default suggestion, or a
// template. A rule set that produced the same sentence in all three cases would pass a test that only
// checked "a suggestion was produced" and would be exactly the notification template the review rules
// out — which is why the test asserts the three cases differ and that each names its own evidence.
//
// **One of the three arms can be replaced, and only that one.** When the caller also hands in the
// executor's own answer that *this* commit was pushed by an earlier run of Hikari's, `different` becomes
// `inspect-own-action`: the difference between the run's commit and the working tree is no longer of
// unknown origin, so the honest next step is no longer "check which version you are looking at" but
// "look at that earlier action's own record". `same` and `indeterminate` are deliberately untouched by
// that material: `same`'s suggestion is still correct with a record in hand — swapping it would only be
// pasting one more fact onto it — and `indeterminate` still has nothing specific to say.
//
// What the new arm must **not** be read as: a cause. Three string equalities say the failing run ran
// against a commit this executor pushed. They do not say the push broke anything, and no wording derived
// from here is allowed to imply it.

import type { RepositoryChangeActionRecord } from '../repository-change-executor/index.js';
import type { RepositoryCiCommitAssessment } from '../repository-ci-awareness/types.js';
import type { RepositoryCiAttentionOccurrence } from '../repository-ci-attention/types.js';
import type { RepositoryCiRelevanceJudgement } from '../repository-ci-relevance/types.js';

import type {
  RepositoryCiDiagnosisEvidence,
  RepositoryCiDiagnosisMissing,
  RepositoryCiDiagnosisProposal,
} from './types.js';

function insufficient(missing: RepositoryCiDiagnosisMissing): RepositoryCiDiagnosisProposal {
  return Object.freeze({ kind: 'insufficient-evidence', missing });
}

/**
 * The suggestion for one already-relevant failure, or the statement that there is none.
 *
 * The order of the checks is the order of the materials, and each one is a different reason not to
 * suggest anything specific:
 *
 *   no GitHub CI facet            the snapshot holds no CI observation — nothing to suggest about
 *   relevance not established     nobody has established that this repository is the one the human
 *                                 meant; the failure is still announced, but a suggestion would be
 *                                 advice about a repository this layer cannot name
 *   comparison indeterminate      the one comparison this layer reads could not be put
 *
 * A `relevant` judgement always carries the string it matched on, so `evidence.designation` is filled
 * from the judgement rather than recomputed here. This module does not decide relevance and does not
 * repeat the comparison that decided it.
 *
 * `ownAction` is not acquired here either. It is the executor's answer, asked by the caller, or
 * `undefined` — which means "its record does not say so" and is the only value this rule can act on
 * besides a record. A caller that could not ask passes nothing and gets exactly today's answer.
 */
export function judgeProposal(input: {
  readonly occurrence: RepositoryCiAttentionOccurrence;
  readonly assessment: RepositoryCiCommitAssessment;
  readonly relevance: RepositoryCiRelevanceJudgement;
  readonly ownAction?: RepositoryChangeActionRecord | undefined;
}): RepositoryCiDiagnosisProposal {
  const { occurrence, assessment, relevance, ownAction } = input;

  // The snapshot is asked for its CI facet even though a failure normally implies one, because
  // "normally" is not a guarantee this layer gets to hold: `unavailable` is a state the World can
  // report, and a proposal derived from a facet that was not there would be a suggestion about a run
  // nobody observed.
  if (assessment.snapshot.githubCi.kind !== 'available') return insufficient('no-github-ci-facet');

  // Relevance is consulted, never recomputed. `unknown` and `relevant` are this module's only two
  // inputs here, and `unknown` means exactly what it means upstream: the human's declaration and the CI
  // observation were not tied together, so there is no repository this suggestion would be about.
  if (relevance.verdict !== 'relevant') return insufficient('relevance-not-established');

  const evidence: RepositoryCiDiagnosisEvidence = Object.freeze({
    repository: occurrence.repository,
    runId: occurrence.runId,
    headSha: occurrence.headSha,
    commitComparison: assessment.commitComparison,
    designation: relevance.designation,
  });

  switch (assessment.commitComparison) {
    case 'different':
      // The one arm a record can replace. Without one, this is unchanged, word for word and value for
      // value: the difference is real and its origin is unknown.
      return ownAction === undefined
        ? Object.freeze({ kind: 'check-commit-alignment', evidence })
        : Object.freeze({
            kind: 'inspect-own-action',
            evidence: Object.freeze({ ...evidence, ownAction }),
          });
    case 'same':
      return Object.freeze({ kind: 'inspect-run-steps', evidence });
    case 'indeterminate':
      return insufficient('commit-comparison-indeterminate');
  }
}
