export { gitHubCiService } from './contracts.js';
export type { GitHubCiService } from './contracts.js';
export { GitHubCiError, GitHubCiObservationError } from './errors.js';
export { gitHubCiPlugin } from './plugin.js';
export type { GitHubCiPluginConfig } from './plugin.js';
export type { GitHubCiLatestRun, GitHubCiObservation, GitHubCiRun } from './types.js';

// `GitHubCiSource` is deliberately absent, as it is from the git repository provider and the desktop
// providers: the literal is the observation's own way of saying where it came from, and a caller
// that needs to branch on the source of an observation is a caller with more than one source, which
// does not exist yet.
//
// `GitHubCiConclusion` is absent for a different reason: it is reachable as `run.conclusion`, and a
// caller holding a run has no reason to name its type.
