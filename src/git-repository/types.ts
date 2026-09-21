// Everything here is a fact git reports about a work tree it was pointed at. Nothing in this file
// says which repository this is, who owns it, or whether it matters — a work tree is not a project,
// and the same repository can be checked out in more than one of them.

export type GitRepositorySource = 'git-repository';

export interface GitRepositoryOnBranch {
  readonly kind: 'branch';
  readonly name: string;
  readonly commit: string;
}

export interface GitRepositoryDetachedHead {
  readonly kind: 'detached';
  readonly commit: string;
}

// A repository that exists and has no commit yet. There is no commit id to report — not one that
// could not be read, but one that does not exist — so this is a state of the repository rather than
// a failure to observe it, and it carries no commit field at all rather than a null.
export interface GitRepositoryUnbornHead {
  readonly kind: 'unborn';
}

export type GitRepositoryHead =
  | GitRepositoryOnBranch
  | GitRepositoryDetachedHead
  | GitRepositoryUnbornHead;

export interface GitRepositoryUnchangedWorkTree {
  readonly kind: 'unchanged';
}

export interface GitRepositoryChangedWorkTree {
  readonly kind: 'changed';
}

// `changed` means git listed at least one entry: a path that differs from HEAD, an unmerged path,
// or an untracked file or directory. `unchanged` means it listed none. Ignored files are never
// listed, and submodule contents are not inspected — both are git's own defaults, stated here
// because a reader who assumed otherwise would read `unchanged` as a stronger claim than it is.
export type GitRepositoryWorkTree = GitRepositoryUnchangedWorkTree | GitRepositoryChangedWorkTree;

export interface GitRepositoryObservation {
  readonly observedAt: string;
  readonly source: GitRepositorySource;
  // The top level of the work tree git found, rendered by git with forward slashes. It is not the
  // configured root: git searches upwards, so a configured subdirectory resolves to its ancestor.
  readonly workTreeRoot: string;
  readonly head: GitRepositoryHead;
  readonly workTree: GitRepositoryWorkTree;
  // The configured remote names, in the order git reports them. Empty is a legal repository state,
  // not an absence of information. Names only: a URL is configuration, and no name is privileged —
  // git has no concept of "the" remote, and this command never touches the network.
  readonly remotes: readonly string[];
}
