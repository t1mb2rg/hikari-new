import { defineService } from '../runtime/contracts.js';
import type { GitHubCiRunMaterials, GitHubCiRunMaterialsQuery } from './materials.js';
import type { GitHubCiObservation } from './types.js';

// A service and not an event: the only real need observed so far is a caller asking what a
// repository's CI state is right now, which is a question asked when it is asked. Making this an
// event would mean this module deciding when CI state is worth announcing, which is a judgement and
// not a perception.
export interface GitHubCiService {
  current(): Promise<GitHubCiObservation>;
}

export const gitHubCiService = defineService<GitHubCiService>('github-ci.current', 1);

// A second service rather than a field on the first, and the separation is the point: an observation
// is a fresh fact about the repository, a material is a fixed fact about one run that was already
// observed. A caller that can only ask `current()` cannot accidentally turn a material read into a
// change of what the repository looks like, and a material that cannot be read leaves the observation
// exactly where it was.
//
// The name is the candidate the review wrote down and has not been frozen; the semantics it carries
// have been (`docs/architecture/ci-diagnosis-model-supplement-v0-boundary-review.md` §12.1-§12.4).
export interface GitHubCiRunMaterialsService {
  getRunMaterials(query: GitHubCiRunMaterialsQuery): Promise<GitHubCiRunMaterials>;
}

export const gitHubCiRunMaterialsService = defineService<GitHubCiRunMaterialsService>(
  'github-ci.run-materials',
  1,
);
