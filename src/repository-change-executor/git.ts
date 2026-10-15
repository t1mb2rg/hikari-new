// git, run as a subprocess, with the bounds the boundary review asked for.
//
// `authorized-repository-action-v0-boundary-review.md` §4 says the executor is "a bounded subprocess,
// built the way `desktop-content-read` builds its PowerShell probe (with a timeout and a maxBuffer), so
// no new communication plane is introduced", and the implementation-freeze chose the reading in which
// the subprocess is *this* layer: every git invocation — reads included — is a child process whose exit
// code and stdout are the whole of what comes back. Nothing here speaks a protocol, keeps a connection,
// or holds state between calls. A caller that wants to know something about a repository asks git, and
// gets told or gets told why not.
//
// Why every read goes through git rather than through the filesystem: the three outcomes in `outcome.ts`
// have to come from a source the executor cannot write to. The executor can write files in the working
// tree, and it can run `git commit`; what it cannot do is make `rev-parse HEAD` answer something the
// repository does not say. That is the property this file exists to preserve, so it deliberately
// exposes no way to ask a *question about intent* — only the plain questions git answers by itself.
//
// The four results are the four things that can actually happen, and `timed-out` is separate from
// `failed` on purpose: a repository whose history is slow to walk and a repository that is not there
// are different sentences to the human, and collapsing them would make the record less specific than
// the run was.

import { execFile } from 'node:child_process';

/** One git invocation, and the four things that can come back. */
export type GitRun =
  | { readonly kind: 'ok'; readonly stdout: string; readonly stderr: string }
  | {
      readonly kind: 'failed';
      readonly stdout: string;
      readonly stderr: string;
      readonly exitCode: number | undefined;
    }
  | { readonly kind: 'timed-out' }
  | { readonly kind: 'unavailable'; readonly reason: string };

export interface GitBudgets {
  /** How long one invocation may take. Reaching it kills the child. */
  readonly timeoutMs: number;
  /** How much output one invocation may produce before it is killed. */
  readonly maxBytes: number;
}

/**
 * The default budgets, and where the numbers come from.
 *
 * A read against a working copy answers in milliseconds; ten seconds is generous enough that a slow
 * disk does not turn a read into a timeout, and short enough that a hung git cannot hold a human's
 * request open. The buffer is the same megabyte `execFile` defaults to, said out loud because this
 * build's contract now depends on it being bounded: an unbounded read of a repository is exactly the
 * shape that must not be reachable from a request.
 */
export const DEFAULT_GIT_BUDGETS: GitBudgets = Object.freeze({ timeoutMs: 10_000, maxBytes: 1024 * 1024 });

/**
 * Run one git command against one repository root.
 *
 * `-C <root>` rather than a `cwd` option, for the reason the sibling read half gives: the root is part
 * of the command the record will name, and a working directory that is set out of band is a second
 * place the truth about which repository was touched could live.
 */
export function runGit(
  root: string,
  args: readonly string[],
  budgets: GitBudgets = DEFAULT_GIT_BUDGETS,
  signal?: AbortSignal,
): Promise<GitRun> {
  return new Promise<GitRun>((settle) => {
    execFile(
      'git',
      ['-C', root, ...args],
      {
        timeout: budgets.timeoutMs,
        maxBuffer: budgets.maxBytes,
        windowsHide: true,
        encoding: 'utf8',
        ...(signal === undefined ? {} : { signal }),
      },
      (error, stdout, stderr) => {
        if (error === null) {
          settle({ kind: 'ok', stdout, stderr });
          return;
        }

        // `ENOENT` is not a failure of this repository, it is the absence of git on this machine, and
        // the two send a human to different places. It is checked before the timeout because a missing
        // executable never had a chance to time out.
        if (isMissingExecutable(error)) {
          settle({ kind: 'unavailable', reason: 'git 不可执行：本机找不到 git。' });
          return;
        }
        if (isTimeout(error)) {
          settle({ kind: 'timed-out' });
          return;
        }

        settle({ kind: 'failed', stdout, stderr, exitCode: error.code === undefined ? undefined : exitCodeOf(error) });
      },
    );
  });
}

/**
 * The commit at the tip, or `undefined` when there is not one.
 *
 * A repository with no commits is not an error state to report here: `rev-parse HEAD` failing on an
 * unborn branch is git saying "there is nothing to name yet", and the outcome comparison treats the
 * absence as an absence.
 */
export async function readHead(root: string, budgets?: GitBudgets, signal?: AbortSignal): Promise<string | undefined> {
  const run = await runGit(root, ['rev-parse', 'HEAD'], budgets, signal);
  if (run.kind !== 'ok') return undefined;
  const head = run.stdout.trim();
  return head === '' ? undefined : head;
}

/**
 * Whether the working tree has anything uncommitted, or `undefined` when that cannot be read.
 *
 * `--porcelain` and not `--short`: the two differ only in whether the output is meant for humans, and
 * this output is not. Untracked files count, which is what makes "the executor wrote a new file and did
 * not commit it" visible as a change rather than as a clean tree.
 */
export async function readDirty(
  root: string,
  budgets?: GitBudgets,
  signal?: AbortSignal,
): Promise<boolean | undefined> {
  const run = await runGit(root, ['status', '--porcelain'], budgets, signal);
  if (run.kind !== 'ok') return undefined;
  return run.stdout.trim() !== '';
}

/**
 * How many commits exist locally that no remote has, or `undefined` when that cannot be read.
 *
 * This is how a push is *observed* rather than believed. The executor says whether it pushed; this
 * number, read before and after, is what the record stands on. `--branches --not --remotes` is the
 * question "what do I have that they do not", and it answers zero for a repository whose work is
 * already published — including one where a push happened in this very run.
 *
 * A repository with no remote configured answers with a number rather than failing, which is the right
 * shape: "there is nowhere to push to" is not the same fact as "the question could not be asked", and
 * the caller can tell them apart by looking at the remote separately.
 */
export async function readUnpushedCount(
  root: string,
  budgets?: GitBudgets,
  signal?: AbortSignal,
): Promise<number | undefined> {
  const run = await runGit(root, ['rev-list', '--count', '--branches', '--not', '--remotes'], budgets, signal);
  if (run.kind !== 'ok') return undefined;
  const count = Number.parseInt(run.stdout.trim(), 10);
  return Number.isSafeInteger(count) && count >= 0 ? count : undefined;
}

/**
 * The URL of the `origin` remote, or `undefined` when there is none.
 *
 * `origin` by name and not "the remote": git has no concept of *the* remote (the read half's
 * `git-repository/types.ts` says so in its own words), and the declaration a human writes names a
 * GitHub repository, which is what a clone from GitHub conventionally calls `origin`. A repository
 * whose default remote has another name is a case this build answers "not declared" to rather than
 * guesses about, and the record says which question was asked.
 */
export async function readOriginUrl(
  root: string,
  budgets?: GitBudgets,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const run = await runGit(root, ['remote', 'get-url', 'origin'], budgets, signal);
  if (run.kind !== 'ok') return undefined;
  const url = run.stdout.trim();
  return url === '' ? undefined : url;
}

/**
 * Whether a directory is a git working tree that includes this directory itself.
 *
 * `rev-parse --is-inside-work-tree` answers `true` for any directory *inside* a working tree, which is
 * not the question wanted here: the declared root must be the top of the tree the executor will touch,
 * or `write_file`'s containment check would be measuring the wrong prefix. `--show-toplevel` is asked
 * as well and the two answers have to name the same place.
 */
export async function isRepositoryRoot(
  root: string,
  budgets?: GitBudgets,
  signal?: AbortSignal,
): Promise<boolean> {
  const inside = await runGit(root, ['rev-parse', '--is-inside-work-tree'], budgets, signal);
  if (inside.kind !== 'ok' || inside.stdout.trim() !== 'true') return false;
  const top = await runGit(root, ['rev-parse', '--show-toplevel'], budgets, signal);
  if (top.kind !== 'ok') return false;
  return normalizePath(top.stdout.trim()) === normalizePath(root);
}

/**
 * Compare two paths the way this platform does, for the one comparison above.
 *
 * Windows answers `--show-toplevel` with forward slashes and a drive letter whose case is whatever git
 * felt like; a declared root written by a human can differ in both without naming a different place.
 * Only case and separators are folded — nothing here resolves symlinks or short names, because that is
 * `containment.ts`'s job and doing it twice would give two answers to one question.
 */
export function normalizePath(value: string): string {
  return value.replace(/\\/gu, '/').replace(/\/+$/u, '').toLowerCase();
}

/**
 * The shape of what `execFile` hands back when a command fails.
 *
 * Node's `ErrnoException` is narrower than the object the callback actually receives: `code` can be
 * `null`, and `signal` is present only when a signal was sent. With `exactOptionalPropertyTypes` that
 * mismatch is a compile error rather than something to cast away, and naming the fields this build
 * reads says precisely which parts of a failure it is allowed to depend on.
 */
interface ExecFailure {
  readonly code?: string | number | null;
  readonly signal?: string | null;
}

/** `true` when the child could not be spawned at all, which for git means it is not installed. */
function isMissingExecutable(error: ExecFailure): boolean {
  return error.code === 'ENOENT';
}

/**
 * `true` when git was killed for taking too long.
 *
 * `execFile` reports its own timeout as a kill signal, and a caller-supplied abort reports the same
 * signal, so the two are told apart by `code`: the timeout carries `ETIMEDOUT`, a caller's abort
 * carries `ABORT_ERR`. Only the first is this build's timeout, and only it becomes `timed-out`; an
 * abort is the caller's own decision and travels as `failed`, because the caller already knows why.
 */
function isTimeout(error: ExecFailure): boolean {
  return error.code === 'ETIMEDOUT' || error.signal === 'SIGTERM';
}

function exitCodeOf(error: ExecFailure): number | undefined {
  return typeof error.code === 'number' ? error.code : undefined;
}
