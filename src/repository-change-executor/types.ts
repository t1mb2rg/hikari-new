// What one authorized change request is, and what can be said about it afterwards.
//
// The vocabulary here is deliberately small, and it is small in one particular direction: there is no
// field anywhere in this file that an executor could use to describe *itself* as successful. The three
// outcomes come from comparing the repository's own state before and after the run (see `outcome.ts`),
// and the run report is carried beside them as evidence, marked for what it is — the executor's own
// account. `authorized-repository-action-v0-boundary-review.md` §5.1 states the rule this file is
// shaped by: an executor's self-report must never be recorded as a verified fact.
//
// The mandate is a string and stays one. Nothing here parses it, trims more than its edges, checks it
// for a verb, or asks a model what it meant before the record is written: §2 of that review settled
// that the human's own sentence *is* the mandate, and the moment this file started interpreting it,
// the interpretation would be the thing being authorized.

/** One request: a repository the human named, and the sentence they named it with. */
export interface RepositoryChangeRequest {
  /** `owner/name` on GitHub, as the human wrote it. Compared literally; never folded, never inferred. */
  readonly repository: string;
  /** The human's own sentence, unwritten-to. Only its leading and trailing whitespace is not part of it. */
  readonly mandate: string;
}

/**
 * The three outcomes, and there are exactly three.
 *
 * `unknown` is not a failure of this code and it is not a polite `unchanged`: it is the honest answer
 * when the question "did anything change" cannot be answered by looking. §5.2 requires that it never
 * collapses into `unchanged`, which is why the two are separate members of a closed union rather than
 * a boolean and a flag.
 */
export type RepositoryChangeOutcome = 'changed' | 'unchanged' | 'unknown';

/**
 * Why the run stopped where it did, as a closed set.
 *
 * These are the sentences a human reads, so each one names a fact about this build rather than a
 * category of error: the first four are decided *before* anything could happen, and the last three are
 * the ways a run that started can end without an answer. Adding a member here is how a new way of
 * stopping becomes sayable; nothing else in this module decides what a human is told.
 */
export type RepositoryChangeHalt =
  | 'mandate-empty'
  | 'repository-not-declared'
  | 'repository-unreachable'
  | 'executor-unavailable'
  | 'executor-failed'
  | 'executor-timed-out'
  | 'outcome-unreadable'
  // The request arrived and a run would have started, but the sentence could not be written down first.
  // This one halts *before* anything can move, deliberately: §2.7 of the review puts the mandate fact
  // ahead of the run because a run that dies has to leave behind what was asked for, and an irreversible
  // change with no record of what it was asked to do is the one thing this slice must not produce.
  | 'record-unwritable';

/**
 * What the executor says it did.
 *
 * This is the executor's own account, and it is typed as such: `steps` and `toolCalls` are counts of
 * what it asked for, `pushed` is what it claims, and `notes` is prose. None of these fields is read by
 * `outcome.ts` when it decides which of the three outcomes happened, and that separation is the whole
 * reason this type is not called `RepositoryChangeResult`.
 */
export interface RepositoryChangeRunReport {
  readonly steps: number;
  readonly toolCalls: readonly RepositoryChangeToolUse[];
  /** What the executor claims about pushing. Cross-checked against git; the cross-check is what counts. */
  readonly pushed: boolean;
  readonly notes: readonly string[];
  /** Set when a tool call was refused by this build's boundaries rather than by the repository. */
  readonly refusedCalls: readonly string[];
  /**
   * Where the loop stopped before it ran out of things to do, and why.
   *
   * `undefined` means the run ended because the model said it was done. The implementation freeze's
   * §2.5 asks for "which step it stopped at, and why" to reach the record, and this is the only place
   * that knows: stopping on the step budget and stopping because the model finished both leave a
   * repository that may or may not have changed, and the difference is what a human reads next.
   */
  readonly stopped: RepositoryChangeStopped | undefined;
}

/**
 * Why a run that started ended without the model saying it was done.
 *
 * These are the executor's own account — `outcome.ts` never reads them, and none of them decides which
 * of the three outcomes happened. They explain a run whose repository may be untouched, and that
 * explanation is exactly why they are not allowed to be evidence.
 */
export interface RepositoryChangeStopped {
  readonly atStep: number;
  readonly reason: 'step-budget' | 'step-timeout' | 'run-budget' | 'model-failed';
}

export interface RepositoryChangeToolUse {
  /** The name the model wrote. A name outside the admitted set is recorded here as refused. */
  readonly name: string;
  readonly outcome: 'ok' | 'refused' | 'failed';
}

/**
 * What can be checked afterwards, from sources other than the executor.
 *
 * Every field here is read by this build from git or from `github-ci`, never from the run report. An
 * outcome of `changed` with no `headAfter` and no dirty transition is not a state this build can
 * produce: the outcome is derived from these fields, not asserted beside them.
 */
export interface RepositoryChangeEvidence {
  readonly headBefore: string | undefined;
  readonly headAfter: string | undefined;
  /** `undefined` when the look at the repository failed — never the same answer as a clean tree. */
  readonly dirtyBefore: boolean | undefined;
  /** As above, and for the same reason `headAfter` is: two looks, each with its own three answers. */
  readonly dirtyAfter: boolean | undefined;
  /**
   * Whether a push actually happened, as git reports it, not as the executor reports it.
   *
   * `undefined` is the third answer and not a synonym for `false`: it means the question could not be
   * asked — a repository whose state could not be read at all. Writing `false` there would turn "nobody
   * knows" into "it certainly did not happen", which is exactly the claim §8's fifth ruling exists to
   * keep the record from making (and it would skip the CI read that ruling requires).
   */
  readonly pushed: boolean | undefined;
  /** The run number pushed to GitHub, when a push happened and CI could be read. */
  readonly ciRunId: number | undefined;
  /** False when a push happened but no run could be read; the record must say so rather than stay silent. */
  readonly ciChecked: boolean;
}

/** Everything one request produced. `lines` is what the human is told; the rest is the record. */
export interface RepositoryChangeResult {
  readonly repository: string;
  readonly mandate: string;
  readonly outcome: RepositoryChangeOutcome;
  /** Present whenever the run did not end in `changed`; `undefined` means it did. */
  readonly halt: RepositoryChangeHalt | undefined;
  readonly evidence: RepositoryChangeEvidence;
  /** The executor's own account. Absent when nothing ran. */
  readonly report: RepositoryChangeRunReport | undefined;
  readonly lines: readonly string[];
}

/**
 * The one thing the loop is asked to do, and it is injected rather than imported.
 *
 * Two reasons, and both of them have precedent in this build. The first is testability: the three
 * outcomes of this module are about *when* a runner fails, times out or returns, and those are states
 * a test can produce only if it owns the runner. The second is the boundary `src/language/plugin.ts`
 * already draws around its model: a capability is a parameter of the plugin, not a dependency of it.
 *
 * What a runner is *not* given is any say in the outcome. It returns a report; `outcome.ts` reads git.
 */
export interface RepositoryChangeRunner {
  run(request: RepositoryChangeRunRequest): Promise<RepositoryChangeRunReport>;
}

export interface RepositoryChangeRunRequest {
  /** `owner/name`, as the human wrote it. The runner may put it in its prompt; it does not check it. */
  readonly repository: string;
  /** The absolute path of the declared root this repository resolved to. The runner stays inside it. */
  readonly root: string;
  /** The human's sentence, unwritten-to. */
  readonly mandate: string;
  /** Aborted when the run exceeds its budget. A runner that ignores it is a runner that gets killed. */
  readonly signal: AbortSignal;
}
