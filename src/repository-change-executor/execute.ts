// One authorized change, from the sentence a human gave to the record it leaves behind.
//
// The order of the checks is the design. Everything that can refuse the request happens *before*
// anything can touch the repository, and each refusal names itself — §4 of the boundary review requires
// that a run which does not start says which of the conditions was not met, because "nothing happened"
// and "nothing happened because you never declared this repository" are different sentences to the
// human, and only the second one tells them what to do next.
//
// The four refusals, and what each of them is really protecting:
//
//   mandate-empty          a word arrived carrying nothing. There is no mandate to record, because
//                          §2 says the sentence *is* the mandate and an empty string is not one.
//   repository-not-declared the named repository is not among the roots a human declared, or no root
//                          names it. This is the second start condition, and it is the one that keeps a
//                          model's interpretation from ever widening what may be touched.
//   repository-unreachable  the declared root is not the top of a git working tree.
//   executor-unavailable    no runner was configured, so nothing could run even though everything else
//                          was in place. Said out loud rather than filed as "no change".
//
// The runner is a parameter and not an import (see `types.ts`), which is also what keeps this file
// honest about its own reach: with no runner configured this module can read a repository and write two
// facts, and it cannot change anything. That property is not incidental to the slice — it is the reason
// the first step of the implementation order ships no runner at all.
//
// Reading the mandate fact happens before the first start condition is checked, and that is deliberate:
// the proposition is "a human asked for this", and by the time this function is called, that has already
// happened. A refusal afterwards does not unsay it.

import type { FactDraft } from '../chronicle/types.js';
import type { ChangeableRepositoriesReadService } from '../changeable-repositories/index.js';

import { mandateFactDraft, resultFactDraft } from './facts.js';
import { isRepositoryRoot, type GitBudgets } from './git.js';
import { isDirty, judgeOutcome, readSnapshot, type RepositorySnapshot } from './outcome.js';
import { resolveDeclaredRoot } from './scope.js';
import type {
  RepositoryChangeEvidence,
  RepositoryChangeHalt,
  RepositoryChangeRequest,
  RepositoryChangeResult,
  RepositoryChangeRunReport,
  RepositoryChangeRunner,
} from './types.js';

export interface ExecuteRepositoryChangeInput {
  readonly request: RepositoryChangeRequest;
  /** The read half of the declaration. Only `roots()` is ever called on it. */
  readonly read: ChangeableRepositoriesReadService;
  /** `undefined` when no executor is configured. The run then refuses rather than pretends. */
  readonly runner: RepositoryChangeRunner | undefined;
  /** How long the whole runner call may take. Reaching it aborts the runner's signal. */
  readonly runTimeoutMs: number;
  /**
   * Reads the CI run that followed a push, if anyone can.
   *
   * Absent means nobody was asked, which the evidence records as `ciChecked: false` rather than as "there
   * was no run" — the two are different claims and only one of them is known here. This is Hikari asking
   * after the fact, and it is deliberately not the runner's `read_ci` tool: §8's fifth ruling wants the
   * number in the record from a source outside the executor's own account.
   */
  readonly readCi?: () => Promise<number | undefined>;
  readonly budgets?: GitBudgets;
}

export interface RepositoryChangeExecution {
  readonly result: RepositoryChangeResult;
  /** The drafts to admit, in the order they are to be written. Empty only when there was no mandate. */
  readonly facts: readonly FactDraft[];
}

export async function executeRepositoryChange(
  input: ExecuteRepositoryChangeInput,
): Promise<RepositoryChangeExecution> {
  const repository = input.request.repository;
  const mandate = input.request.mandate.trim();

  if (mandate === '') {
    return settle({
      repository,
      mandate: input.request.mandate,
      outcome: 'unchanged',
      halt: 'mandate-empty',
      evidence: emptyEvidence(),
      report: undefined,
      facts: [],
      lines: [`没有改动 ${repository}：这次请求没有带来任何原句。`],
    });
  }

  const mandateFact = mandateFactDraft({ repository, mandate });
  const facts: FactDraft[] = [mandateFact];

  const roots = await input.read.roots();
  const scope = await resolveDeclaredRoot(repository, roots, input.budgets);
  if (scope.kind === 'not-declared') {
    return settle({
      repository,
      mandate,
      outcome: 'unchanged',
      halt: 'repository-not-declared',
      evidence: emptyEvidence(),
      report: undefined,
      facts,
      lines: [`没有改动 ${repository}：它不在人类声明的可改仓库里。`, scope.reason],
    });
  }

  const root = scope.root;
  if (!(await isRepositoryRoot(root, input.budgets))) {
    return settle({
      repository,
      mandate,
      outcome: 'unchanged',
      halt: 'repository-unreachable',
      evidence: emptyEvidence(),
      report: undefined,
      facts,
      lines: [`没有改动 ${repository}：声明的本机路径 ${root} 不是一个 git 工作区的根。`],
    });
  }

  if (input.runner === undefined) {
    return settle({
      repository,
      mandate,
      outcome: 'unchanged',
      halt: 'executor-unavailable',
      evidence: emptyEvidence(),
      report: undefined,
      facts,
      lines: [`没有改动 ${repository}：这次常驻没有配置执行者。`],
    });
  }

  const before = await readSnapshot(root, input.budgets);
  const ran = await runWithBudget(input.runner, {
    repository,
    root,
    mandate,
    timeoutMs: input.runTimeoutMs,
  });
  const after = await readSnapshot(root, input.budgets);

  const judgement = judgeOutcome(before, after);
  const halt: RepositoryChangeHalt | undefined =
    judgement.outcome === 'changed'
      ? undefined
      : ran.halt !== undefined
        ? ran.halt
        : judgement.outcome === 'unknown'
          ? 'outcome-unreadable'
          : undefined;

  // A determinate change stays determinate. If git says the tree or the tip moved, that happened —
  // and a runner that also timed out does not make it not have happened. What the timeout costs is the
  // run's own account, which is why `unknown` is the answer in the other direction: a run that failed
  // and left no trace is not evidence that nothing was touched, and §5.2 forbids filing it that way.
  const outcome = judgement.outcome === 'changed' ? 'changed' : halt !== undefined ? 'unknown' : judgement.outcome;

  // §8's fifth ruling: once a push has been observed, the evidence has to name the CI run that followed
  // it, because push is the one step in this slice a local rollback cannot undo. Read here, afterwards,
  // and never taken from the runner's own account — a report saying "I pushed and CI is green" would be
  // the self-description §3.3 forbids recording as a verified fact. A read that fails leaves the number
  // absent rather than inventing one, and `ciChecked` says whether anyone was asked at all.
  let ciRunId: number | undefined;
  if (judgement.pushed && input.readCi !== undefined) {
    try {
      ciRunId = await input.readCi();
    } catch {
      ciRunId = undefined;
    }
  }

  const evidence: RepositoryChangeEvidence = {
    headBefore: before.head,
    headAfter: after.head,
    dirtyBefore: before.readable ? isDirty(before) : undefined,
    dirtyAfter: after.readable ? isDirty(after) : undefined,
    pushed: judgement.pushed,
    ciRunId,
    ciChecked: input.readCi !== undefined,
  };

  facts.push(
    resultFactDraft({
      repository,
      outcome,
      halt,
      evidence,
    }),
  );

  return settle({
    repository,
    mandate,
    outcome,
    halt,
    evidence,
    report: ran.report,
    facts,
    lines: describe({ repository, root, outcome, halt, evidence, before, after }),
  });
}

/** The outcome of the runner call, as three separate things rather than one caught exception. */
interface RunAttempt {
  readonly report: RepositoryChangeRunReport | undefined;
  readonly halt: RepositoryChangeHalt | undefined;
}

async function runWithBudget(
  runner: RepositoryChangeRunner,
  input: { repository: string; root: string; mandate: string; timeoutMs: number },
): Promise<RunAttempt> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;

  // The budget is raced against the call rather than only signalled into it. A runner that honours the
  // signal stops on its own, and one that does not must still not be able to hold the human's request
  // open forever: `AbortController` is how the runner *can* stop, and the race is what guarantees the
  // answer comes back either way. Both are needed, and neither is sufficient.
  const budget = new Promise<'timed-out'>((settle) => {
    timer = setTimeout(() => {
      controller.abort();
      settle('timed-out');
    }, input.timeoutMs);
  });

  // The runner's own failure is turned into a value here, so that a runner still running when the
  // budget expires cannot later reject unobserved.
  const attempt = runner
    .run({
      repository: input.repository,
      root: input.root,
      mandate: input.mandate,
      signal: controller.signal,
    })
    .then(
      (report) => ({ kind: 'report' as const, report }),
      () => ({ kind: 'failed' as const }),
    );

  try {
    const raced = await Promise.race([attempt, budget]);

    if (raced === 'timed-out') return { report: undefined, halt: 'executor-timed-out' };
    if (raced.kind === 'failed') return { report: undefined, halt: 'executor-failed' };

    return { report: raced.report, halt: undefined };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * What the human is told, built here rather than by a renderer.
 *
 * The read half keeps its rendering in `src/language/`, because a CI failure is announced by an owner
 * whose audience is the desktop. This owner's audience is the person who typed the word, and they are
 * answered by the endpoint that carried it; a second module to render three sentences would be a second
 * place the same fact is phrased. The wording never asserts more than the outcome does, which is why
 * `unknown` is spelled as "cannot be determined" rather than as a suspicion in either direction.
 */
function describe(input: {
  readonly repository: string;
  readonly root: string;
  readonly outcome: RepositoryChangeResult['outcome'];
  readonly halt: RepositoryChangeHalt | undefined;
  readonly evidence: RepositoryChangeEvidence;
  readonly before: RepositorySnapshot;
  readonly after: RepositorySnapshot;
}): readonly string[] {
  const { repository, outcome, evidence, halt } = input;

  if (outcome === 'changed') {
    const lines = [`已按你的原句在 ${repository} 上产生改动。`];
    if (evidence.headBefore !== evidence.headAfter) {
      lines.push(`HEAD：${short(evidence.headBefore)} → ${short(evidence.headAfter)}`);
    } else {
      lines.push('HEAD 没有变，变的是工作区。');
    }
    if (evidence.pushed) {
      lines.push('执行者把它推送到了远端——这一步不能收回。');
      lines.push(
        evidence.ciRunId === undefined
          ? '推送之后没有读到 CI run（这个仓库可能没有配置 CI，或者这次没能读到）。'
          : `推送之后的 CI run：#${evidence.ciRunId}`,
      );
    }
    return lines;
  }

  if (outcome === 'unchanged') {
    return [`没有改动 ${repository}。`, ...(halt === undefined ? [] : [haltSentence(halt)])];
  }

  return [
    `无法确定 ${repository} 是否被改动。`,
    ...(halt === undefined ? [] : [haltSentence(halt)]),
    '记录里写的是这一条，而不是「没有改动」。',
  ];
}

/** One sentence per halt, so that every way of stopping is sayable and none of them is a guess. */
function haltSentence(halt: RepositoryChangeHalt): string {
  switch (halt) {
    case 'mandate-empty':
      return '原因：这次请求没有带来任何原句。';
    case 'repository-not-declared':
      return '原因：它不在人类声明的可改仓库里。';
    case 'repository-unreachable':
      return '原因：声明的本机路径不是一个 git 工作区的根。';
    case 'executor-unavailable':
      return '原因：这次常驻没有配置执行者。';
    case 'executor-failed':
      return '原因：执行者中途失败。';
    case 'executor-timed-out':
      return '原因：执行者超出了这次的时间预算，已被中止。';
    case 'outcome-unreadable':
      return '原因：改动前后读不到仓库状态，因此无法比对。';
  }
}

function emptyEvidence(): RepositoryChangeEvidence {
  return {
    headBefore: undefined,
    headAfter: undefined,
    dirtyBefore: false,
    dirtyAfter: false,
    pushed: false,
    ciRunId: undefined,
    ciChecked: false,
  };
}

function short(sha: string | undefined): string {
  return sha === undefined ? '（还没有提交）' : sha.slice(0, 7);
}

function settle(input: {
  readonly repository: string;
  readonly mandate: string;
  readonly outcome: RepositoryChangeResult['outcome'];
  readonly halt: RepositoryChangeHalt | undefined;
  readonly evidence: RepositoryChangeEvidence;
  readonly report: RepositoryChangeRunReport | undefined;
  readonly facts: FactDraft[];
  readonly lines: readonly string[];
}): RepositoryChangeExecution {
  return {
    result: {
      repository: input.repository,
      mandate: input.mandate,
      outcome: input.outcome,
      halt: input.halt,
      evidence: input.evidence,
      report: input.report,
      lines: input.lines,
    },
    facts: input.facts,
  };
}
