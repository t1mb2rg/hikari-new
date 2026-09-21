import type {
  GitRepositoryHead,
  GitRepositoryObservation,
  GitRepositorySource,
  GitRepositoryWorkTree,
} from './types.js';

// What one acquisition produced, before it is labelled and frozen into an observation. `observedAt`
// is stamped by whoever ran the acquisition: git cannot stamp a run of its own, so unlike the
// desktop sources this one has no producer-side clock to pass through.
export interface GitRepositoryAcquisition {
  readonly observedAt: string;
  readonly workTreeRoot: string;
  readonly head: GitRepositoryHead;
  readonly workTree: GitRepositoryWorkTree;
  readonly remotes: readonly string[];
}

export interface GitRepositoryAcquirer {
  acquire(): Promise<GitRepositoryAcquisition>;
  dispose(): Promise<void>;
}

const OBSERVATION_SOURCE: GitRepositorySource = 'git-repository';

export function toObservation(acquisition: GitRepositoryAcquisition): GitRepositoryObservation {
  return Object.freeze({
    observedAt: acquisition.observedAt,
    source: OBSERVATION_SOURCE,
    workTreeRoot: acquisition.workTreeRoot,
    head: Object.freeze(acquisition.head),
    workTree: Object.freeze(acquisition.workTree),
    remotes: Object.freeze([...acquisition.remotes]),
  });
}
