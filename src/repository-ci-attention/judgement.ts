// Two pure functions and one literal: what counts as a new failure, and what it reads like.
//
// Both are exported and both are tested on every platform, for the reason `repository-ci-relevance`
// gives for exporting `renderJudgement` and `desktop-session-observe` gives for exporting
// `renderAssessment`: a rule pinned only by a test that needs a named pipe is a rule CI does not check
// at all, and this repository has already been bitten by exactly that. Everything that actually runs on
// a cadence lives in `plugin.ts`; nothing here holds state or reaches a Runtime.
//
// The two functions are the whole of what this module decides, and they are deliberately adjacent so
// that "what is announced" and "what is said" can be read against each other. Neither of them is
// allowed to ask whether the failure *matters*: `relevant ≠ salient`, and the moment this file grew a
// notion of importance it would have become the generic attention framework the ruling forbids.

import type { GitHubCiObservation } from '../github-ci/index.js';
import { oneLine } from '../terminal-text/index.js';

import type { RepositoryCiAttentionOccurrence } from './types.js';

// The conclusions that mean a run ran and failed.
//
// GitHub reports more conclusions than these, and the ones left out are left out on purpose rather
// than by oversight. `cancelled` is usually a person cancelling their own run, `action_required` is a
// run waiting for somebody to approve it, and neither is a failure to tell someone about. `neutral`,
// `skipped` and `stale` are not failures either. The three below are: the run ran and came out badly.
//
// A literal set in one place, not a mapping table and not an open-world predicate. GitHub's vocabulary
// is its own and this module does not own it, so the honest shape is "these three words, and widening
// it is one edit here" rather than a rule that guesses at words nobody has seen yet. The comparison is
// case-sensitive and exact because the value it is compared against is carried verbatim from
// `github-ci`, which passes GitHub's own spelling through unchanged.
const FAILURE_CONCLUSIONS: ReadonlySet<string> = new Set(['failure', 'timed_out', 'startup_failure']);

/**
 * The failure to announce, or `undefined` if this observation is not one.
 *
 * `announced` is this activation's own record of what it has already said, owned and closed over by
 * `plugin.ts`. Passing it in rather than holding it here is what keeps this function pure and what
 * makes the duplicate rule checkable without a clock: the caller supplies the set, so a test can write
 * down any history it likes.
 *
 * The order of the checks is the order of the facts, cheapest and most decisive first, and each one is
 * a different reason not to speak:
 *
 *   no run reported     nothing happened yet, or GitHub said nothing
 *   not completed       the run is still going — see the transition note below
 *   conclusion absent   GitHub reports a completed run with no conclusion while it settles
 *   not a failure       it finished, and it finished fine
 *   already announced   it failed, and this activation has already said so
 *
 * The in-progress case is worth stating outright because it is the one that looks like a gap and is
 * not. A run seen `in_progress` is not announced and **not recorded**, so when the same run id comes
 * back `completed` with a failure conclusion it is a first sighting and is announced once. That is the
 * `in_progress → failure` transition, and it falls out of recording only what was actually said rather
 * than out of a state machine over run statuses.
 *
 * What this cannot see is a failure that is superseded before it is ever polled: `github-ci` reports
 * the *latest* run, so a red run replaced by a newer one between two cycles leaves no trace here. That
 * is the v0 boundary recorded in the Repository CI Attention review, not something this function
 * papers over by widening what it reads.
 */
export function detectNewFailure(
  observation: GitHubCiObservation,
  announced: ReadonlySet<number>,
): RepositoryCiAttentionOccurrence | undefined {
  const latest = observation.latestRun;
  if (latest.kind !== 'reported') return undefined;

  const { run } = latest;
  if (run.status !== 'completed') return undefined;
  if (run.conclusion.kind !== 'reported') return undefined;
  if (!FAILURE_CONCLUSIONS.has(run.conclusion.value)) return undefined;
  if (announced.has(run.id)) return undefined;

  return Object.freeze({
    repository: observation.repository,
    runId: run.id,
    workflow: run.workflow,
    headBranch: run.headBranch,
    headSha: run.headSha,
    conclusion: run.conclusion.value,
    observedAt: observation.observedAt,
  });
}

// The judgement's own name, as a header — the same shape `renderJudgement` uses for
// `Repository CI relevance：`, and for the same reason. It names the surface that formed the judgement;
// it is not a sentence about the facts below it.
const HEADER = 'Repository CI attention：';

/**
 * The occurrence, said out loud, and nothing else.
 *
 * Every word is either the header above or a field of the occurrence, printed verbatim. Nothing is
 * translated, summarized, rounded or added to, and no line says what the failure is *about* — not that
 * a workflow is important, not that a branch is the main one, not that this matters. The question this
 * surface answers is "what did Hikari notice?", and the moment it answers "and that means…" it has
 * become the interpretation layer that `principles.md` keeps out of a renderer.
 *
 * The field labels are this file's words and the values are the contract's, which is exactly the split
 * `presentation.ts` describes: labels are layout, values are facts, and a label that restated its value
 * would be this file editing a judgement it was only asked to carry.
 *
 * `oneLine` is applied to the whole return value rather than to the fields that need it today, so that
 * "one element is one line" is a property of *this* value rather than a hope about its inputs — a field
 * added later cannot quietly reopen the hole. `renderAnswer` applies it a second time downstream, which
 * is a no-op on lines that already went through it.
 */
export function renderOccurrence(occurrence: RepositoryCiAttentionOccurrence): readonly string[] {
  return [
    HEADER,
    `  仓库：${occurrence.repository}`,
    `  运行：${occurrence.runId}`,
    `  工作流：${occurrence.workflow}`,
    `  分支：${occurrence.headBranch}`,
    `  提交：${occurrence.headSha}`,
    `  结论：${occurrence.conclusion}`,
    `  观察时间：${occurrence.observedAt}`,
  ].map(oneLine);
}
