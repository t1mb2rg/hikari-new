import type { RepositoryCiWorldSnapshot } from '../repository-ci-world/index.js';

// `same` says only that the two reported commit strings are equal. It is not a claim that the two
// sources describe one repository, and it is not a claim that the local work tree is the thing CI
// ran against.
//
// `different` says only that the two reported commit strings are not equal. It is not a claim that
// the two sources describe different repositories, not a claim that anything diverged, and not a
// claim that CI is stale — this layer reads two strings and never walks a commit graph.
//
// `indeterminate` is not a third answer to the same question: it says the question could not be put.
// A repository with no commit yet and a source that could not be observed at all are equally unable
// to supply a string, so neither is allowed to read as `different`.
export type RepositoryCiCommitComparison = 'same' | 'different' | 'indeterminate';

// The assessment carries the snapshot it judged, unchanged and by reference. A verdict on its own
// would not say what was compared, and `indeterminate` in particular is unreadable without the two
// facets that made it so — a reader has to be able to see which fact was missing rather than be
// told only that something was.
//
// There is no `assessedAt` here. The snapshot already carries `snapshotAt`, which is when the two
// observations were put together, and `observedAt` inside each observation, which is when each
// source saw anything. A third timestamp on this layer would be a third time axis with no reader.
//
// There is also no `previous` and no history of any kind: every assessment is made from one fresh
// snapshot, so two calls in a row are two independent judgements rather than a step in a sequence.
export interface RepositoryCiCommitAssessment {
  readonly snapshot: RepositoryCiWorldSnapshot;
  readonly commitComparison: RepositoryCiCommitComparison;
}
