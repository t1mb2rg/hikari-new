import type { GitHubCiObservation, GitHubCiSource } from './types.js';

// What one acquisition produced, before it is labelled and frozen into an observation. GitHub
// reports the observation time in its own response headers, but that is the time GitHub answered a
// request, not the time this module decided to look — so `observedAt` is stamped here, as it is for
// the git source.
export type GitHubCiAcquisition = Omit<GitHubCiObservation, 'source'>;

export interface GitHubCiAcquirer {
  acquire(): Promise<GitHubCiAcquisition>;
  dispose(): Promise<void>;
}

const OBSERVATION_SOURCE: GitHubCiSource = 'github-ci';

export function toObservation(acquisition: GitHubCiAcquisition): GitHubCiObservation {
  const latestRun =
    acquisition.latestRun.kind === 'reported'
      ? Object.freeze({
          kind: 'reported' as const,
          run: Object.freeze({
            ...acquisition.latestRun.run,
            conclusion: Object.freeze({ ...acquisition.latestRun.run.conclusion }),
          }),
        })
      : Object.freeze({ kind: 'none' as const });

  return Object.freeze({
    observedAt: acquisition.observedAt,
    source: OBSERVATION_SOURCE,
    repository: acquisition.repository,
    latestRun,
  });
}
