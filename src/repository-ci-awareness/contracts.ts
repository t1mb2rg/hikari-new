import { defineService } from '../runtime/contracts.js';
import type { RepositoryCiCommitAssessment } from './types.js';

// A service and not an event, for the reason the desktop session awareness is one: an assessment is
// asked for when somebody wants one. An event would mean this layer deciding when a verdict is worth
// announcing, which is a judgement about significance and not the judgement this layer makes.
//
// Pull-only. Nothing here observes on its own, and nothing is remembered between calls.
export interface RepositoryCiAwarenessService {
  current(): Promise<RepositoryCiCommitAssessment>;
}

export const repositoryCiAwarenessService = defineService<RepositoryCiAwarenessService>(
  'repository-ci-awareness.current',
  1,
);
