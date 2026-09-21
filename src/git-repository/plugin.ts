import type { PluginDefinition } from '../runtime/plugin.js';
import type { GitRepositoryAcquirer } from './acquisition.js';
import { toObservation } from './acquisition.js';
import { gitRepositoryService } from './contracts.js';
import { GitRepositoryError } from './errors.js';
import { createGitAcquirer } from './git.js';

export interface GitRepositoryPluginConfig {
  readonly repositoryRoot: string;
}

// The acquirer is injected rather than constructed here for the same reason the desktop providers
// inject theirs: the seam is what lets the lifecycle be tested without a repository on disk. It is
// also what keeps construction inside `setup` — no process handle exists until the plugin is
// activated.
export function createGitRepositoryPlugin(
  createAcquirer: (repositoryRoot: string) => GitRepositoryAcquirer,
): PluginDefinition<GitRepositoryPluginConfig> {
  return {
    id: 'git-repository',
    version: '1.0.0',
    requires: [],
    provides: [gitRepositoryService],
    config: {
      parse(input: unknown): GitRepositoryPluginConfig {
        return Object.freeze({ repositoryRoot: readRepositoryRoot(input) });
      },
    },
    setup(context, config) {
      const acquirer = createAcquirer(config.repositoryRoot);
      context.defer(() => acquirer.dispose());
      context.services.provide(
        gitRepositoryService,
        Object.freeze({ current: async () => toObservation(await acquirer.acquire()) }),
      );
    },
  };
}

// Explicit by design. There is no default and no fallback to the process's own working directory:
// choosing a repository here would make this plugin the thing that decides which repository Hikari
// looks at, and that is a decision for whoever composes the plugin.
//
// Only the shape of the value is checked. Whether a repository is actually at that path is not a
// configuration question — it is answered when an observation is taken, and answered as a failed
// observation rather than as a refused start. Refusing to start on a missing path would also make
// the plugin disagree with the repository it is pointed at the moment someone moves it.
function readRepositoryRoot(input: unknown): string {
  if (typeof input !== 'object' || input === null) {
    throw new GitRepositoryError('Git repository perception requires a config object.');
  }

  const { repositoryRoot } = input as { repositoryRoot?: unknown };
  if (typeof repositoryRoot !== 'string' || !repositoryRoot.trim()) {
    throw new GitRepositoryError('Git repository perception requires a non-empty repositoryRoot.');
  }

  return repositoryRoot;
}

export const gitRepositoryPlugin = createGitRepositoryPlugin((repositoryRoot) =>
  createGitAcquirer({ repositoryRoot }),
);
