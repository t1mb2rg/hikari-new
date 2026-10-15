// The executor itself, and the things it is made of.
//
// What this package exports is a set of *parts* — a git runner, a containment check, a scope
// resolution, a tool table, an outcome judgement, two fact drafts, and the one function that puts them
// in order. It deliberately exports no Service: §3 of the implementation boundary freeze records the
// ruling that this slice's consumers are the human who typed the word and the record it leaves, and
// a contract published before either of them arrives would be a contract shaped by nobody. The
// `provides` array of the plugin is therefore empty, and this file has no `…Service` to export.
//
// The public surface is exactly the names below. Anything added here becomes something another module
// may depend on, so the exports are grouped by concern and each group is the smallest set its own
// consumer needs: `plugin.ts` (the endpoint and the composition) takes the executor, the git runner and
// the tool table, and the tests take everything.

export {
  executeRepositoryChange,
  type ExecuteRepositoryChangeInput,
  type RepositoryChangeExecution,
} from './execute.js';

export {
  EXECUTOR_IDENTITY,
  mandateFactDraft,
  REPOSITORY_CHANGE_FACT_TYPES,
  resultFactDraft,
  type MandateFactInput,
  type ResultFactInput,
} from './facts.js';

export {
  DEFAULT_GIT_BUDGETS,
  isRepositoryRoot,
  normalizePath,
  readDirty,
  readHead,
  readOriginUrl,
  readUnpushedCount,
  runGit,
  type GitBudgets,
  type GitRun,
} from './git.js';

export {
  isDirty,
  isPushObserved,
  judgeOutcome,
  readSnapshot,
  type OutcomeJudgement,
  type RepositorySnapshot,
} from './outcome.js';

export { containTarget, foldPath, isInside, realPathOf, type ContainmentVerdict } from './containment.js';

export { repositoryNameFromUrl, resolveDeclaredRoot, type ScopeResolution } from './scope.js';

export {
  findTool,
  readToolArguments,
  REPOSITORY_CHANGE_TOOLS,
  toModelTools,
  type RepositoryChangeTool,
  type RepositoryChangeToolField,
  type ToolArguments,
} from './tools.js';

export type {
  RepositoryChangeEvidence,
  RepositoryChangeHalt,
  RepositoryChangeOutcome,
  RepositoryChangeRequest,
  RepositoryChangeResult,
  RepositoryChangeRunReport,
  RepositoryChangeRunRequest,
  RepositoryChangeRunner,
  RepositoryChangeToolUse,
} from './types.js';
