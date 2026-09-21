// Everything here is a fact GitHub reports about one repository it was asked about. Nothing in this
// file says whether that repository is the one checked out on this machine, whether it is the same
// project as any other repository, or whether its state matters. A repository is not a project, and
// two sources naming the same project is a question for whoever reads both — not for either source.

export type GitHubCiSource = 'github-ci';

// A run that has not finished carries no conclusion at all: GitHub omits the field rather than
// sending an empty one. Reported as a state rather than as `undefined`, so that "GitHub said
// nothing" stays distinguishable from "this module failed to read what GitHub said".
export type GitHubCiConclusion =
  | { readonly kind: 'reported'; readonly value: string }
  | { readonly kind: 'absent' };

export interface GitHubCiRun {
  readonly id: number;
  // The workflow's name, as GitHub reports it on the run.
  //
  // The run reported is the repository's most recent across every workflow it has, unfiltered: which
  // workflow matters is a question about intent, and this module has none. On a repository with one
  // workflow that is a harmless detail. On a repository with several it is the whole difference
  // between "CI failed" and "the docs job ran last", which is why the name travels with the run
  // rather than being dropped as decoration.
  readonly workflow: string;
  readonly headBranch: string;
  readonly headSha: string;
  // GitHub's own word, passed through rather than mapped onto a set closed here. `queued`,
  // `in_progress` and `completed` are what it says today; a status it adds later is still a status
  // it reported, and a union invented in this file would turn it into a parse failure instead.
  readonly status: string;
  readonly conclusion: GitHubCiConclusion;
}

// A repository GitHub reports no runs for. Not a failure and not an absence of information: a
// repository with no runs has a CI state, and this is that state.
export interface GitHubCiNoRun {
  readonly kind: 'none';
}

export interface GitHubCiReportedRun {
  readonly kind: 'reported';
  readonly run: GitHubCiRun;
}

export type GitHubCiLatestRun = GitHubCiNoRun | GitHubCiReportedRun;

export interface GitHubCiObservation {
  readonly observedAt: string;
  readonly source: GitHubCiSource;
  // The name GitHub itself uses for this repository, not the name it was asked about. GitHub
  // resolves owner and name case-insensitively and answers with its own spelling, so these two
  // differ whenever the configured one does — the same way a configured work tree path differs
  // from the work tree root git resolves.
  readonly repository: string;
  readonly latestRun: GitHubCiLatestRun;
}
