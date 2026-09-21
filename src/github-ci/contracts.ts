import { defineService } from '../runtime/contracts.js';
import type { GitHubCiObservation } from './types.js';

// A service and not an event: the only real need observed so far is a caller asking what a
// repository's CI state is right now, which is a question asked when it is asked. Making this an
// event would mean this module deciding when CI state is worth announcing, which is a judgement and
// not a perception.
export interface GitHubCiService {
  current(): Promise<GitHubCiObservation>;
}

export const gitHubCiService = defineService<GitHubCiService>('github-ci.current', 1);
