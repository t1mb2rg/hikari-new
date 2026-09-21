// The whole of the judgement, and it is one comparison.
//
// What this file is given is a snapshot — not an assessment, and the difference is load-bearing. The
// Awareness layer hands back a snapshot *and* a verdict about commits; this layer takes the snapshot
// and never sees the verdict, so `same` / `different` / `indeterminate` cannot reach the answer even
// by accident. That is deliberate and not a stylistic choice: whether two commit strings match is a
// question about commits, and whether a human's declaration names the repository a CI observation is
// about is a question about a name. They are orthogonal, and one must not stand in for the other.
//
// The consequence is worth stating because it reads as a bug until it does not. A repository the
// human declared, whose CI ran against a different commit than the local HEAD, is *relevant* — the
// observation is about the repository they named, and it reports a commit that is not the one they
// have checked out. Both of those are true at once, and neither is a reason to answer `unknown`.
//
// Nothing here reads the work tree, the run, the branch, the workflow or the conclusion. Two strings
// and an equality, which is why this file has no I/O and no lifecycle.

import type { RepositoryCiWorldSnapshot } from '../repository-ci-world/index.js';
import type { RepositoryCiRelevanceJudgement } from './types.js';

const UNKNOWN: RepositoryCiRelevanceJudgement = Object.freeze({ verdict: 'unknown' });

const HEADER = 'Repository CI relevance：';
const RELEVANT_LINE = '与工作焦点逐字相同：';
const UNKNOWN_LINE = '未能在当前工作焦点与 Repository CI observation 之间建立逐字相等关系。';

/**
 * Whether the current work focus names the repository the current GitHub CI observation reports.
 *
 * The only rule that can produce `relevant` is: the GitHub CI facet is available, the human has
 * declared at least one designation, and one of them equals `observation.repository` character for
 * character. Anything else is `unknown`, and `unknown` is a finished judgement rather than a missing
 * one — a facet that could not be observed is a facet the World reported, exactly as an available
 * one is, so a snapshot with no GitHub CI in it is a question that was put and could not be answered
 * in the affirmative.
 *
 * One designation matching is enough, and a set with a match and a non-match is still `relevant`:
 * `P4-03` is a declaration about the human's own work, and this layer has no licence to decide it is
 * *about* a repository, so it contributes nothing either way. It cannot cancel a match and it cannot
 * manufacture one.
 */
export function judgeRelevance(
  designations: readonly string[],
  snapshot: RepositoryCiWorldSnapshot,
): RepositoryCiRelevanceJudgement {
  const githubCi = snapshot.githubCi;

  // Not an error path. The World reports a source it could not observe as a facet rather than by
  // rejecting, and this is that facet arriving where a repository string would have been. There is
  // nothing to compare, so nothing can be found equal.
  if (githubCi.kind !== 'available') return UNKNOWN;

  // Compared exactly as reported, and each of the exclusions is the same exclusion: trimming, case
  // folding, taking a basename, splitting an owner from a name, rewriting a remote URL, detecting a
  // fork, consulting an alias table, asking a model. Every one of them is this layer deciding that
  // two different strings denote the same repository — an inference about meaning, which is not what
  // the two sources reported and not something this layer is entitled to add to it.
  //
  // `hikari-new` therefore does not match `t1mb2rg/hikari-new`, and `P4-03` matches neither. That is
  // not a v1 shortfall to be closed later; it is where the truth boundary for this judgement sits.
  const repository = githubCi.observation.repository;
  for (const designation of designations) {
    if (designation === repository) return { verdict: 'relevant', designation };
  }

  return UNKNOWN;
}

/**
 * What the judgement is, as lines the human who asked can read.
 *
 * The `unknown` line is one sentence and it is true in all three of the ways `unknown` can come
 * about — no GitHub CI facet, no declared focus, no equality. Naming a specific cause would be a
 * second judgement, and a wrong one whenever a different cause was the real one.
 */
export function renderJudgement(judgement: RepositoryCiRelevanceJudgement): readonly string[] {
  if (judgement.verdict === 'unknown') return [`${HEADER}unknown`, UNKNOWN_LINE];
  return [`${HEADER}relevant`, `${RELEVANT_LINE}${judgement.designation}`];
}
