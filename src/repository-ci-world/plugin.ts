import type { PluginDefinition } from '../runtime/plugin.js';
import { gitHubCiService } from '../github-ci/index.js';
import { gitRepositoryService } from '../git-repository/index.js';
import { repositoryCiWorldService } from './contracts.js';
import type {
  RepositoryCiGitHubCiFacet,
  RepositoryCiGitRepositoryFacet,
  RepositoryCiWorldSnapshot,
} from './types.js';

// No config, and that is a statement rather than an omission. The desktop session world takes none
// because its two sources take none; this one takes none even though both of its sources do. The
// values that establish the scope — a repository root on one side, an owner/name on the other —
// live in those sources' own configuration, and loading the two of them together with this plugin
// is what says they belong to one scope.
//
// Reading either value here would hand this layer the ability to compare them, and comparing them is
// the conclusion this layer exists to leave unstated. Whoever composes it is the owner of that
// assertion; this plugin holds two observations in one envelope and does not check the envelope.
export const repositoryCiWorldPlugin: PluginDefinition<undefined> = {
  id: 'repository-ci-world',
  version: '1.0.0',
  requires: [gitRepositoryService, gitHubCiService],
  provides: [repositoryCiWorldService],
  setup(context) {
    const gitRepository = context.services.get(gitRepositoryService);
    const githubCi = context.services.get(gitHubCiService);

    context.services.provide(
      repositoryCiWorldService,
      Object.freeze({
        current: async (): Promise<RepositoryCiWorldSnapshot> => {
          // Both sources are started in the same synchronous segment so that the snapshot covers the
          // narrowest window two independent acquisitions can offer. `Promise.resolve().then` also
          // converts a synchronous throw from a source into a rejection, so that both ways a source
          // can fail end up in the same place: this facet's availability.
          const [gitRepositoryResult, githubCiResult] = await Promise.allSettled([
            Promise.resolve().then(() => gitRepository.current()),
            Promise.resolve().then(() => githubCi.current()),
          ]);

          const gitRepositoryFacet: RepositoryCiGitRepositoryFacet =
            gitRepositoryResult.status === 'fulfilled'
              ? { kind: 'available', observation: gitRepositoryResult.value }
              : { kind: 'unavailable' };

          const githubCiFacet: RepositoryCiGitHubCiFacet =
            githubCiResult.status === 'fulfilled'
              ? { kind: 'available', observation: githubCiResult.value }
              : { kind: 'unavailable' };

          // Stamped after both facets have settled, so it describes when this snapshot was assembled
          // and never when the sources observed anything. The two source observations keep their own
          // `observedAt`, which is the only place either source's own time is stated.
          return Object.freeze({
            snapshotAt: new Date().toISOString(),
            gitRepository: Object.freeze(gitRepositoryFacet),
            githubCi: Object.freeze(githubCiFacet),
          });
        },
      }),
    );
  },
};
