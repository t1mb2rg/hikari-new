// The executor itself, and the things it is made of.
//
// What this package exports is a set of *parts* — a git runner, a containment check, a scope
// resolution, a tool table, an outcome judgement, two fact drafts, and the one function that puts them
// in order. It exported no Service for its first slice: §3 of the implementation boundary freeze
// recorded the ruling that this slice's consumers are the human who typed the word and the record it
// leaves, and a contract published before either of them arrives would be a contract shaped by nobody. A
// third consumer has since arrived — `repository-ci-diagnosis-proposal`, which asks whether a commit a
// failing CI run ran against is one this executor pushed — so this package now exports exactly one
// Service (`contracts.ts`) and the pure rule behind it (`history.ts`), and the review that approved it
// records why that is the same ruling rather than an exception to it. What it still does not export is
// any way to make the executor do something: a mandate comes from a person's own sentence.

export {
  repositoryChangeActionsService,
  type RepositoryChangeActionsService,
} from './contracts.js';
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
  findPushedCommit,
  type RepositoryChangeActionQuery,
  type RepositoryChangeActionRecord,
} from './history.js';

export {
  isDirty,
  isPushObserved,
  judgeOutcome,
  readSnapshot,
  type OutcomeJudgement,
  type RepositorySnapshot,
} from './outcome.js';

export { containTarget, foldPath, isInside, realPathOf, type ContainmentVerdict } from './containment.js';

export { repositoryChangeEndpointPath } from './endpoint-path.js';

export { RepositoryChangeError } from './errors.js';

export {
  listenRepositoryChangeEndpoint,
  type RepositoryChangeEndpoint,
  type RepositoryChangeHost,
} from './endpoint.js';

export {
  decodeRepositoryChangeReply,
  decodeRepositoryChangeRequest,
  encodeRepositoryChangeReply,
  encodeRepositoryChangeRequest,
  EXECUTOR_PROTOCOL,
  MAX_EXECUTOR_REQUEST_LINE,
  RepositoryChangeLineReader,
  type DecodedRepositoryChangeReply,
  type DecodedRepositoryChangeRequest,
  type RepositoryChangeLineRead,
  type RepositoryChangeWireReply,
  type RepositoryChangeWireRequest,
} from './protocol.js';

export {
  createRepositoryChangeExecutorPlugin,
  DEFAULT_RUN_TIMEOUT_MS,
  type RepositoryChangeExecutorOptions,
} from './plugin.js';

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

export {
  performTool,
  type PerformedTool,
  type PerformToolInput,
} from './perform.js';

export { createRepositoryChangeRunner, type ModelLoopOptions } from './loop.js';

export type {
  RepositoryChangeEvidence,
  RepositoryChangeHalt,
  RepositoryChangeOutcome,
  RepositoryChangeRequest,
  RepositoryChangeResult,
  RepositoryChangeRunReport,
  RepositoryChangeRunRequest,
  RepositoryChangeRunner,
  RepositoryChangeStopped,
  RepositoryChangeToolUse,
} from './types.js';

