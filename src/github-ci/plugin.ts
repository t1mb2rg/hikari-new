import type { PluginDefinition } from '../runtime/plugin.js';
import type { GitHubCiAcquirer } from './acquisition.js';
import { toObservation } from './acquisition.js';
import { gitHubCiService } from './contracts.js';
import { GitHubCiError } from './errors.js';
import { createGitHubCiAcquirer } from './github.js';

export interface GitHubCiPluginConfig {
  readonly repository: string;
}

export interface GitHubCiReference {
  readonly owner: string;
  readonly name: string;
}

// The acquirer is injected rather than constructed here for the same reason the git repository
// provider injects its own: the seam is what lets the lifecycle be tested without a network. It is
// also what keeps construction inside `setup` — no request handle exists until the plugin is
// activated.
export function createGitHubCiPlugin(
  createAcquirer: (reference: GitHubCiReference) => GitHubCiAcquirer,
): PluginDefinition<GitHubCiPluginConfig> {
  return {
    id: 'github-ci',
    version: '1.0.0',
    requires: [],
    provides: [gitHubCiService],
    config: {
      parse(input: unknown): GitHubCiPluginConfig {
        return Object.freeze({ repository: readRepository(input) });
      },
    },
    setup(context, config) {
      const acquirer = createAcquirer(parseReference(config.repository));
      context.defer(() => acquirer.dispose());
      context.services.provide(
        gitHubCiService,
        Object.freeze({ current: async () => toObservation(await acquirer.acquire()) }),
      );
    },
  };
}

// A GitHub owner is alphanumeric with interior hyphens, and a repository name additionally allows
// dots and underscores. The pattern checks that shape and nothing else — in particular it refuses a
// URL, a trailing slash and whitespace, all of which are ways of writing something that is not a
// name.
const REPOSITORY_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/;

// Explicit by design, and for two reasons rather than one. There is no default, because a default
// owner would be an assumption about whose account this is; and there is no derivation from the
// local git repository, because inferring which GitHub repository a checkout corresponds to is a
// correspondence between two sources, and that is exactly the judgement neither source is allowed
// to make. What this plugin can be told is a reference; what it reports back is the name that
// reference resolved to.
//
// No host either. This speaks to GitHub, and there is one GitHub: a configurable base URL would be
// a knob nobody needs, and the seam for tests lives in the acquirer's own options instead.
//
// Only the shape is checked. Whether that repository exists, and whether it is visible to an
// unauthenticated caller, are not configuration questions — they are answered when an observation is
// taken, and answered as a failed observation rather than as a refused start.
function readRepository(input: unknown): string {
  if (typeof input !== 'object' || input === null) {
    throw new GitHubCiError('GitHub CI perception requires a config object.');
  }

  const { repository } = input as { repository?: unknown };
  if (typeof repository !== 'string' || !REPOSITORY_PATTERN.test(repository)) {
    throw new GitHubCiError('GitHub CI perception requires a repository written as "owner/name".');
  }

  return repository;
}

// The pattern above guarantees one slash with a non-empty part on each side, so this split is total
// for anything that reached `parse`. The check is here so that a future loosening of the pattern
// cannot quietly turn into a request for the wrong repository.
function parseReference(repository: string): GitHubCiReference {
  const parts = repository.split('/');
  const owner = parts[0];
  const name = parts[1];

  if (owner === undefined || name === undefined || parts.length !== 2) {
    throw new GitHubCiError('GitHub CI perception requires a repository written as "owner/name".');
  }

  return Object.freeze({ owner, name });
}

export const gitHubCiPlugin = createGitHubCiPlugin((reference) => createGitHubCiAcquirer(reference));
