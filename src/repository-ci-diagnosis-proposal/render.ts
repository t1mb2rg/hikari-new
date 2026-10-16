// The suggestion, as lines — the owner's own rendering of its own judgement.
//
// Same division of labour as `repository-ci-attention/judgement.ts`'s `renderOccurrence`: this file
// decides what its own kind means in words, Language decides that those lines are a block attributed to
// this module, and the delivery layer decides how a block becomes a message. Nothing here chooses a
// greeting, a tone or an order of messages.
//
// **This renderer is where the inference's strength has to survive.** Three sentences are load-bearing
// and each is written to be read exactly as far as the facts go:
//
//   * a string comparison is a string comparison. `different` means two reported commit strings are not
//     equal. It does **not** mean the difference caused the failure, and the sentence says so rather than
//     leaving a reader to infer it. This repository has already paid once for words that claimed more
//     than the judgement did; the fix then was the same as it is here — put the limit in the sentence the
//     human reads, not only in a comment above it.
//
//   * the run's steps have not been read. `inspect-run-steps` is a suggestion to go and look, and the
//     module that suggests it has read a commit comparison and nothing else. A line that implied the log
//     had been consulted would be this module claiming a capability it deliberately does not have.
//
//   * the designation is quoted, not re-derived. When relevance matched, it matched on a string, and
//     that string is printed as the reason this suggestion is about this repository at all. A suggestion
//     whose basis is not printed is a suggestion a human has to take on faith.
//
//   * an origin is not a cause. `inspect-own-action` says the failing run ran against a commit that an
//     earlier run of Hikari's own record says it pushed, and it names that record — the time and the
//     fact id — so a reader can go and read it. It does **not** say that action broke anything; the
//     sentence says so out loud, in the same breath, for the same reason the `different` sentence does.

import type { RepositoryCiDiagnosisEvidence, RepositoryCiDiagnosisSuggestion } from './types.js';

/** The owner's name for this judgement, and the first thing a reader sees. */
const HEADER = 'Repository CI 诊断建议：';

/**
 * The suggestion, as the lines a human reads.
 *
 * The argument type excludes the absence arm, so this function cannot be asked to render "there is
 * nothing to suggest" — see `types.ts`. The caller decides which of the two it has, and the ordinary
 * announcement is a different call entirely (`language.speaking@1`).
 */
export function renderProposal(suggestion: RepositoryCiDiagnosisSuggestion): readonly string[] {
  const { evidence } = suggestion;

  const basis =
    evidence.designation === undefined
      ? '依据：当前的工作焦点与这次运行的仓库逐字相同。'
      : `依据：工作焦点命中「${evidence.designation}」，且人声明的配对把本机路径与 GitHub 名绑在一起。`;

  const lines = [
    `${HEADER}${suggestion.kind}`,
    `仓库：${evidence.repository}，运行：${evidence.runId}，这次运行用的提交：${evidence.headSha}`,
    basis,
  ];

  switch (suggestion.kind) {
    case 'check-commit-alignment':
      // The comparison, and the limit of it, in the same breath. Splitting them into two sentences was
      // tried and read worse: the second sentence then looks like a disclaimer rather than part of what
      // the suggestion is.
      return [
        ...lines,
        '这次运行用的提交与工作树报告的提交逐字不同——这是一个字符串比较，不代表差异就是失败的原因。',
        '可以先确认正在看的是同一次提交。',
      ];
    case 'inspect-run-steps':
      return [
        ...lines,
        '这次运行用的提交与工作树报告的提交逐字相同——这个模块没有读过运行日志。',
        '可以先看这次运行自己失败的步骤。',
      ];
    case 'inspect-own-action':
      return [
        ...lines,
        `这次运行用的提交，是 Hikari 自己的一次行动推上去的：${suggestion.evidence.ownAction.occurredAt}（记录 ${suggestion.evidence.ownAction.factId}）。`,
        '这仍然是一个字符串比较，不代表那次行动就是失败的原因——可以先看那次行动自己的记录。',
      ];
  }
}

/** Re-exported shape for a caller that wants to name what it is about to render. */
export type { RepositoryCiDiagnosisEvidence };
