export { gitRepositoryService } from './contracts.js';
export type { GitRepositoryService } from './contracts.js';
export { GitRepositoryError, GitRepositoryObservationError } from './errors.js';
export { gitRepositoryPlugin } from './plugin.js';
export type { GitRepositoryPluginConfig } from './plugin.js';
export type {
  GitRepositoryHead,
  GitRepositoryObservation,
  GitRepositoryWorkTree,
} from './types.js';

// `GitRepositorySource` is deliberately absent, as it is from the desktop providers: the literal is
// the observation's own way of saying where it came from, and a caller that needs to branch on the
// source of an observation is a caller with more than one source, which does not exist yet.
