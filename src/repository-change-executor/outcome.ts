// The three outcomes, decided by looking at the repository.
//
// This is the file that makes §5.1's rule true in code: an executor's self-report must not be recorded
// as a verified fact. Nothing here takes a run report as an input. It reads the repository before the
// run and after it, compares what it found, and answers one of three things — and the executor's own
// account is carried beside that answer in the record, clearly as its own account.
//
// What "the repository" answers with is three numbers rather than one, and each is there because a
// different outcome needs it:
//
//   · `head`        a commit moved, which is what a commit or a push does.
//   · `statusDigest` a *digest of the whole porcelain output*, not a boolean. "Was it dirty before and
//                   after" cannot tell "wrote a new file" from "edited that same file again", and a
//                   run that rewrote a file it had already made would then be reported as unchanged.
//                   The digest changes whenever any line of the status changes, which is the smallest
//                   honest question: did the working tree's reported state differ in any way at all.
//   · `unpushed`    how many commits exist here that no remote has. A push is what makes this number
//                   fall, so a push is *observed* rather than believed. The executor says whether it
//                   pushed and its answer is recorded as its answer; this number is what the record
//                   stands on, and §8's fifth ruling requires exactly that the record say a push
//                   happened.
//   · `onRemote`    whether the commit at HEAD is one a remote already has. The count above cannot see
//                   a commit and a push that both happened *inside the same run* starting from a
//                   repository that was already in sync with its remote — that run reads 0 before and 0
//                   after — and that is the ordinary shape of the work: a human asking for a change on a
//                   clean checkout. There, "the new commit is on a remote" is the thing that is visible,
//                   and without it the record would say a push did not happen while the world had
//                   already been changed in a way no one can take back.
//
// `unknown` is the answer when the read itself failed. Note what that means: it is not "nothing
// happened", and the type makes it impossible to write the code that way, because the three outcomes
// are three members of a closed union and the branch that cannot read says `unknown` and returns. The
// freeze's §4 names this as the most important test in the slice, and the reason is that the alternative
// — a run that timed out being filed as "no change" — is a record that lies about the world.

import { createHash } from 'node:crypto';

import { runGit, type GitBudgets } from './git.js';
import type { RepositoryChangeOutcome } from './types.js';

/**
 * What one look at the repository found.
 *
 * `readable` is a separate field rather than a convention about `undefined`, because `head` has a
 * legitimate `undefined`: an unborn branch has no commit to name. A shape where "no commits yet" and
 * "could not read" were spelled the same way would make the outcome depend on which one happened.
 */
export interface RepositorySnapshot {
  readonly readable: boolean;
  readonly head: string | undefined;
  readonly statusDigest: string | undefined;
  readonly unpushed: number | undefined;
  /** Whether a remote-tracking ref contains HEAD. `undefined` means the question could not be asked. */
  readonly onRemote: boolean | undefined;
}

/** Read all four answers. Every failure inside is folded into `readable: false`, not thrown. */
export async function readSnapshot(
  root: string,
  budgets?: GitBudgets,
  signal?: AbortSignal,
): Promise<RepositorySnapshot> {
  const [head, status, unpushed, remotes] = await Promise.all([
    runGit(root, ['rev-parse', 'HEAD'], budgets, signal),
    runGit(root, ['status', '--porcelain'], budgets, signal),
    runGit(root, ['rev-list', '--count', '--branches', '--not', '--remotes'], budgets, signal),
    // `branch -r --contains HEAD` names the remote-tracking refs holding this commit, and names none when
    // there are none. It is asked independently of the count above rather than inferred from it, because
    // the two disagree in exactly the case that matters: a commit and a push inside one run.
    runGit(root, ['branch', '--remotes', '--contains', 'HEAD'], budgets, signal),
  ]);

  // `rev-parse HEAD` is allowed to fail — an unborn branch is a repository with nothing in it yet — but
  // it is not allowed to fail *silently* in a way that hides a broken repository: if it failed, the
  // status read has to have succeeded for the snapshot to be worth anything, and both are checked.
  const statusDigest = status.kind === 'ok' ? digestOf(status.stdout) : undefined;
  const unpushedCount = unpushed.kind === 'ok' ? parseCount(unpushed.stdout) : undefined;

  return {
    readable: statusDigest !== undefined && unpushedCount !== undefined,
    head: head.kind === 'ok' && head.stdout.trim() !== '' ? head.stdout.trim() : undefined,
    statusDigest,
    unpushed: unpushedCount,
    // Not part of `readable`: whether a commit is on a remote is a *second* question, and a repository
    // whose remote-tracking refs could not be listed is still a repository whose outcome can be judged.
    onRemote: remotes.kind === 'ok' ? remotes.stdout.trim() !== '' : undefined,
  };
}

/** `rev-list --count` answers with one number, and anything else it answers with is not a count. */
function parseCount(stdout: string): number | undefined {
  const value = Number.parseInt(stdout.trim(), 10);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** What the two looks, taken together, say happened. */
export interface OutcomeJudgement {
  readonly outcome: RepositoryChangeOutcome;
  /** Whether a push is *observed* to have happened, as opposed to reported by the executor. */
  readonly pushed: boolean | undefined;
  /**
   * Whether both looks were readable at all.
   *
   * Separate from `outcome`, because "the run ended badly" and "nobody can compare the two ends" are
   * different facts and callers need both. A run that failed while git could still read the repository
   * both times *has* an answer — nothing moved — and a caller that could only see `unknown` would have
   * to file a known-unchanged repository as unreadable.
   */
  readonly readable: boolean;
}

/**
 * Compare two looks.
 *
 * A snapshot that could not be read makes the answer `unknown` — in either position, and for the
 * comparison as a whole. This is deliberate in both directions: a run whose *first* read failed never
 * established a baseline, and one whose second failed has no answer, and neither case is evidence that
 * nothing happened. §5.2 forbids collapsing them into `unchanged`, and the way that is enforced is that
 * this function has no branch that could.
 */
export function judgeOutcome(before: RepositorySnapshot, after: RepositorySnapshot): OutcomeJudgement {
  if (!before.readable || !after.readable) return { outcome: 'unknown', pushed: undefined, readable: false };

  const pushed = isPushObserved(before, after);

  if (before.head !== after.head) return { outcome: 'changed', pushed, readable: true };
  if (before.statusDigest !== after.statusDigest) return { outcome: 'changed', pushed, readable: true };

  // A push with no new commit is possible in principle — pushing an existing branch to a new remote —
  // and it is still a change to the world, so it is not folded into "nothing happened".
  return { outcome: pushed === true ? 'changed' : 'unchanged', pushed, readable: true };
}

/**
 * Whether commits that no remote had are now commits a remote has.
 *
 * Two shapes, because one of them the count cannot see:
 *
 *   · commits that already existed before the run — the count falls. Strictly falling, and not merely
 *     "zero afterwards": a run that pushed three of five commits has pushed, and a rule that required
 *     zero would file it as not having pushed.
 *   · a commit and a push *inside* the same run, starting from a repository already in sync. The count is
 *     0 before and 0 after, because the commit raised it and the push lowered it again, so a rule that
 *     only compared counts would answer "did not push" about a run that had just pushed — the one answer
 *     §8's fifth ruling exists to forbid. What is visible there is that the new commit is on a remote.
 *
 * What is deliberately *not* used is the executor's own `pushed` field, which is carried in the record
 * beside this answer rather than being it.
 */
export function isPushObserved(
  before: RepositorySnapshot,
  after: RepositorySnapshot,
): boolean | undefined {
  const countsComparable = before.unpushed !== undefined && after.unpushed !== undefined;

  if (countsComparable && after.unpushed! < before.unpushed!) return true;

  if (before.head === after.head) {
    // Nothing about the commit moved, so the only push that could have happened is one of commits the
    // count already covered. When the two counts can be compared, "not fewer than before" is an answer.
    return countsComparable ? false : undefined;
  }

  // A commit that a remote already has, where before the run HEAD was something else: within this tool
  // set — write files, commit, push, and nothing else — the only way a *new* commit reaches a remote is
  // that this run pushed it. A HEAD that did not move is not evidence of a push, which is why this asks
  // about the commit rather than about the repository. `undefined` when the remote list could not be read:
  // a push cannot be taken back, so the record says nobody knows rather than that it did not happen.
  return after.onRemote;
}

/** What a clean tree's porcelain output hashes to: nothing at all. */
const CLEAN_STATUS_DIGEST = digestOf('');

/**
 * Whether the working tree had anything uncommitted at the moment of this look.
 *
 * Compared against the digest of an *empty* report rather than "is the digest defined": a clean tree
 * has a digest too, and it is a perfectly good one. `undefined` stays a third answer — the read failed —
 * and is not reported as clean.
 */
export function isDirty(snapshot: RepositorySnapshot): boolean {
  return snapshot.statusDigest !== undefined && snapshot.statusDigest !== CLEAN_STATUS_DIGEST;
}

/** A stable digest of the porcelain output, whose newline spelling is not part of what it reports. */
function digestOf(porcelain: string): string {
  const normalized = porcelain.replace(/\r\n/gu, '\n').trim();
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}
