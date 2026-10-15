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
}

/** Read all three numbers. Every failure inside is folded into `readable: false`, not thrown. */
export async function readSnapshot(
  root: string,
  budgets?: GitBudgets,
  signal?: AbortSignal,
): Promise<RepositorySnapshot> {
  const [head, status, unpushed] = await Promise.all([
    runGit(root, ['rev-parse', 'HEAD'], budgets, signal),
    runGit(root, ['status', '--porcelain'], budgets, signal),
    runGit(root, ['rev-list', '--count', '--branches', '--not', '--remotes'], budgets, signal),
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
  readonly pushed: boolean;
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
  if (!before.readable || !after.readable) return { outcome: 'unknown', pushed: false };

  const pushed = isPushObserved(before, after);

  if (before.head !== after.head) return { outcome: 'changed', pushed };
  if (before.statusDigest !== after.statusDigest) return { outcome: 'changed', pushed };

  // A push with no new commit is possible in principle — pushing an existing branch to a new remote —
  // and it is still a change to the world, so it is not folded into "nothing happened".
  return { outcome: pushed ? 'changed' : 'unchanged', pushed };
}

/**
 * Whether commits that no remote had are now commits a remote has.
 *
 * Strictly falling, and not merely "zero afterwards": a run that pushed three of five commits has
 * pushed, and a rule that required zero would file it as not having pushed. What is deliberately *not*
 * used is the executor's own `pushed` field, which is carried in the record beside this answer rather
 * than being it.
 */
export function isPushObserved(before: RepositorySnapshot, after: RepositorySnapshot): boolean {
  if (before.unpushed === undefined || after.unpushed === undefined) return false;
  return after.unpushed < before.unpushed;
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
