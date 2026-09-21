import { defineService } from '../runtime/contracts.js';
import type { GitRepositoryObservation } from './types.js';

// The id carries no platform name: what this capability is depends on a git executable on PATH, a
// filesystem path and a child process, none of which is a property of an operating system. The
// plugin id below is equally free of one.
export interface GitRepositoryService {
  current(): Promise<GitRepositoryObservation>;
}

export const gitRepositoryService = defineService<GitRepositoryService>('git-repository.current', 1);
