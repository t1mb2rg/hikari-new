import { execFile } from 'node:child_process';
import type { ChildProcess, ExecFileException } from 'node:child_process';

import type { GitRepositoryAcquirer, GitRepositoryAcquisition } from './acquisition.js';
import { GitRepositoryObservationError } from './errors.js';
import type { GitRepositoryHead, GitRepositoryWorkTree } from './types.js';

const GIT_EXECUTABLE = 'git';
const ACQUISITION_TIMEOUT_MS = 10_000;

// Sized by how dirty a working tree can be rather than by how large one observation is: git lists a
// line per changed path, so the desktop modules' 256 KiB — enough for one window title — would hold
// only a few thousand entries here. `-unormal` below reports an untracked directory as one entry
// instead of one per file, which keeps the listing proportional to the tree's shape rather than its
// contents.
const MAX_ACQUISITION_OUTPUT_BYTES = 4 * 1024 * 1024;

// The two spellings git uses in place of a commit id or a branch name. They are compared literally
// because they are what git puts in the header, not because this module is naming the states —
// `unborn` and `detached` are the names this module gives them.
const DETACHED_HEAD = '(detached)';
const UNBORN_HEAD = '(initial)';

// 40 hex for SHA-1, 64 for SHA-256. A repository can be created with either, so both are accepted
// and nothing shorter or longer is: an id that is neither a full object id nor the unborn marker
// means git answered with something this observation cannot state.
const OBJECT_ID = /^[0-9a-f]{40,64}$/;

const BRANCH_OID_HEADER = '# branch.oid ';
const BRANCH_HEAD_HEADER = '# branch.head ';

export interface GitInvocation {
  // What running this command is meant to establish. Used only to describe a failure, so that a
  // message says which of the three questions went unanswered rather than reporting a bare code.
  readonly establishes: string;
  readonly args: readonly string[];
}

export type GitRunner = (invocation: GitInvocation) => Promise<string>;

// `-unormal` is passed rather than left to configuration. Without it, `status.showUntrackedFiles`
// decides whether an untracked file is something the working tree reports, and a fact that changes
// with a reader's config is not a fact this observation can state. `--porcelain=v2 --branch` is
// used because git defines it as the stable machine-readable form, and because it answers the
// branch question in the same process as the working tree question.
const WORK_TREE_STATE: GitInvocation = {
  establishes: 'the working tree state',
  args: ['status', '--porcelain=v2', '--branch', '-unormal'],
};

// Asked only when `# branch.head` reported the detached spelling, because that header is the one
// place git writes the same bytes for two different states — see `resolveHead`. Prints the current
// branch name, and nothing at all when HEAD is really detached. The exit code is 0 either way: here
// the answer is the output, not the code.
const CURRENT_BRANCH: GitInvocation = {
  establishes: 'the current branch name',
  args: ['branch', '--show-current'],
};

// Names only. A URL is configuration rather than a fact about the repository, and reachability is
// not a fact about the repository at all — this command never touches the network.
const CONFIGURED_REMOTES: GitInvocation = {
  establishes: 'the configured remotes',
  args: ['remote'],
};

// The top level of the work tree git found. git searches upwards from where it is pointed, so this
// can be an ancestor of the configured root.
const WORK_TREE_ROOT: GitInvocation = {
  establishes: 'the work tree root',
  args: ['rev-parse', '--show-toplevel'],
};

export interface GitAcquirerOptions {
  readonly repositoryRoot: string;
  // Replaced in tests to cover outputs and failures git itself does not produce on demand. Nothing
  // in production passes it.
  readonly runGit?: GitRunner;
}

export function createGitAcquirer(options: GitAcquirerOptions): GitRepositoryAcquirer {
  const { repositoryRoot } = options;
  const inflight = new Set<ChildProcess>();
  let disposed = false;

  const rawRun = options.runGit ?? createGitSpawner(repositoryRoot, inflight);

  // Describing a failure lives here rather than in the spawner, so that it describes every command
  // that failed — including one run by an injected runner — and so that the spawner does nothing
  // but start a process and hand back what it wrote.
  const runGit: GitRunner = async (invocation) => {
    try {
      return await rawRun(invocation);
    } catch (error) {
      // Checked before classifying, so an unload that lands mid-acquisition is reported as what it
      // is rather than as whatever the killed process looked like from outside.
      if (disposed) {
        throw new GitRepositoryObservationError('the acquirer was disposed mid-observation');
      }
      throw new GitRepositoryObservationError(describeFailure(invocation, error as ExecFileException));
    }
  };

  return {
    async acquire(): Promise<GitRepositoryAcquisition> {
      if (disposed) {
        throw new GitRepositoryObservationError('the acquirer has already been disposed');
      }

      // Three commands, three processes, sequential — four only when the head needs disambiguating.
      // git offers no transaction spanning them, so a repository that changes while they run is
      // reported as what each command saw rather than as one instant. Nothing here narrows that
      // window; nothing here claims it is narrow.
      const status = readStatus(await runGit(WORK_TREE_STATE));
      const head = await resolveHead(status.head, runGit);
      const remotes = readRemotes(await runGit(CONFIGURED_REMOTES));
      const workTreeRoot = readWorkTreeRoot(await runGit(WORK_TREE_ROOT));

      return Object.freeze({
        // Stamped once, after every command has settled, so it describes when this observation was
        // assembled and not when the repository was in any of the states reported. No git command
        // stamps it: git cannot mark a run of its own, and the timestamps it can print describe
        // commits, which is a different question.
        observedAt: new Date().toISOString(),
        workTreeRoot,
        head,
        workTree: status.workTree,
        remotes,
      });
    },

    async dispose(): Promise<void> {
      disposed = true;
      const pending = [...inflight];
      inflight.clear();
      await Promise.all(pending.map(terminate));
    },
  };
}

function createGitSpawner(repositoryRoot: string, inflight: Set<ChildProcess>): GitRunner {
  return (invocation) =>
    new Promise<string>((resolve, reject) => {
      const child = execFile(
        GIT_EXECUTABLE,
        // `-C` rather than the spawn `cwd`: with `cwd`, a repositoryRoot that does not exist fails
        // the spawn itself and becomes indistinguishable from a missing git executable.
        ['-C', repositoryRoot, ...invocation.args],
        {
          windowsHide: true,
          timeout: ACQUISITION_TIMEOUT_MS,
          maxBuffer: MAX_ACQUISITION_OUTPUT_BYTES,
        },
        (error: ExecFileException | null, stdout: string) => {
          inflight.delete(child);
          if (error) {
            reject(error);
            return;
          }
          resolve(stdout);
        },
      );
      inflight.add(child);
    });
}

interface GitStatusReading {
  readonly head: GitRepositoryHead;
  readonly workTree: GitRepositoryWorkTree;
}

function readStatus(output: string): GitStatusReading {
  let branchOid: string | undefined;
  let branchHead: string | undefined;
  let listed = false;

  for (const raw of output.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;

    if (line.startsWith(BRANCH_OID_HEADER)) {
      branchOid = line.slice(BRANCH_OID_HEADER.length);
      continue;
    }
    if (line.startsWith(BRANCH_HEAD_HEADER)) {
      branchHead = line.slice(BRANCH_HEAD_HEADER.length);
      continue;
    }
    // Every other header states something v1 does not report — the upstream, the ahead/behind
    // counts, the stash size. Skipped, not parsed.
    if (line.startsWith('#')) continue;

    if (line.length > 0) listed = true;
  }

  if (branchHead === undefined || branchOid === undefined || branchHead.length === 0) {
    throw new GitRepositoryObservationError('git reported no branch state');
  }

  const workTree: GitRepositoryWorkTree = Object.freeze(
    listed ? { kind: 'changed' as const } : { kind: 'unchanged' as const },
  );

  if (branchOid === UNBORN_HEAD) {
    // A repository that exists and has no commit yet. Its HEAD resolves to nothing, and that is a
    // fact about the repository rather than a failure to read it: reporting it as an error would
    // turn a state git reports into an absence this module invented.
    return { head: Object.freeze({ kind: 'unborn' as const }), workTree };
  }

  if (!OBJECT_ID.test(branchOid)) {
    throw new GitRepositoryObservationError('git reported no usable commit id');
  }

  if (branchHead === DETACHED_HEAD) {
    return { head: Object.freeze({ kind: 'detached' as const, commit: branchOid }), workTree };
  }

  return {
    head: Object.freeze({ kind: 'branch' as const, name: branchHead, commit: branchOid }),
    workTree,
  };
}

// `# branch.head` is the one header git writes identically for two different states: a HEAD that is
// genuinely detached, and a HEAD on a branch literally named `(detached)`. When that is what it
// said, ask the question that separates them. Only this case pays for the extra process — the
// ordinary branch case is already unambiguous and does not ask again.
async function resolveHead(head: GitRepositoryHead, runGit: GitRunner): Promise<GitRepositoryHead> {
  if (head.kind !== 'detached') return head;

  const name = (await runGit(CURRENT_BRANCH)).trim();
  if (name.length === 0) return head;

  return Object.freeze({ kind: 'branch' as const, name, commit: head.commit });
}

function readRemotes(output: string): readonly string[] {
  const names: string[] = [];
  for (const raw of output.split('\n')) {
    const name = (raw.endsWith('\r') ? raw.slice(0, -1) : raw).trim();
    if (name.length > 0) names.push(name);
  }
  return Object.freeze(names);
}

function readWorkTreeRoot(output: string): string {
  const root = output.trim();
  if (root.length === 0) {
    throw new GitRepositoryObservationError('git reported no work tree root');
  }
  return root;
}

function describeFailure(invocation: GitInvocation, error: ExecFileException): string {
  if (error.killed) return 'the acquisition process did not finish in time';

  // The two kinds of `code` are different failures and are not collapsed here: a number is git
  // having run and exited, a string ('ENOENT') is git never having started. Which exit codes mean
  // what is each command's own question — git uses 128 for a whole family of them, and 1 is a
  // legitimate answer to some commands — so the code is reported as a code, against the question
  // that was being asked, and this file keeps no table mapping codes to meanings.
  if (typeof error.code === 'number') {
    return `${invocation.establishes} could not be read (git exited with code ${error.code})`;
  }

  return 'the git executable could not be started';
}

async function terminate(child: ChildProcess): Promise<void> {
  await new Promise<void>((resolve) => {
    child.once('close', () => resolve());
    child.kill();
  });
}
