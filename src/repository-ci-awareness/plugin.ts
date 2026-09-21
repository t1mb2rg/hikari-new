import type { PluginDefinition } from '../runtime/plugin.js';
import { repositoryCiWorldService } from '../repository-ci-world/index.js';
import type { RepositoryCiWorldSnapshot } from '../repository-ci-world/index.js';
import { repositoryCiAwarenessService } from './contracts.js';
import type { RepositoryCiCommitAssessment, RepositoryCiCommitComparison } from './types.js';

function compareCommits(world: RepositoryCiWorldSnapshot): RepositoryCiCommitComparison {
  const { gitRepository, githubCi } = world;

  // A source that could not be observed supplies no commit string, exactly as a source that had none
  // to report does. Neither leaves the question answered in the negative, so neither may read as
  // `different`: there is no second string here that anything could be called different from.
  if (gitRepository.kind !== 'available' || githubCi.kind !== 'available') return 'indeterminate';

  // A repository with no commit yet reports no commit — not one it failed to read, one that does not
  // exist. There is nothing to compare it against.
  const head = gitRepository.observation.head;
  if (head.kind === 'unborn') return 'indeterminate';

  // A repository whose current CI state is that no run exists reports no run. Same absence, same
  // consequence.
  const latestRun = githubCi.observation.latestRun;
  if (latestRun.kind === 'none') return 'indeterminate';

  // Compared exactly as reported: no trimming, no case folding, no prefix or length matching. Every
  // one of those would be this layer deciding that two different reports denote the same commit —
  // a reading of the two sources rather than a comparison of them. A representation difference
  // therefore lands in `different`, which is honest: the two reports really do differ.
  //
  // This is the whole of the judgement. Nothing outside these two strings is read, so nothing
  // outside them can influence the verdict — not the work tree either side describes, not the
  // names either side is configured under, and not how far apart the two commits might sit in
  // any history neither source was asked about.
  return head.commit === latestRun.run.headSha ? 'same' : 'different';
}

export const repositoryCiAwarenessPlugin: PluginDefinition<undefined> = {
  id: 'repository-ci-awareness',
  version: '1.0.0',
  requires: [repositoryCiWorldService],
  provides: [repositoryCiAwarenessService],
  setup(context) {
    const world = context.services.get(repositoryCiWorldService);

    // Nothing is captured in this closure, and that is the one structural difference from its
    // desktop counterpart: this judgement is put to a single snapshot and needs no history, so
    // there is no baseline to keep and no state for a later call to be measured against. Two calls
    // in a row are two independent judgements, not two steps of a sequence.
    context.services.provide(
      repositoryCiAwarenessService,
      Object.freeze({
        current: async (): Promise<RepositoryCiCommitAssessment> => {
          // No try/catch: a world that could not be assembled is not this layer's to reinterpret,
          // and the World reports its sources' failures as facets rather than by rejecting.
          const snapshot = await world.current();

          return Object.freeze({
            snapshot,
            commitComparison: compareCommits(snapshot),
          });
        },
      }),
    );
  },
};
