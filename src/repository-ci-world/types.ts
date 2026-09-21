import type { GitHubCiObservation } from '../github-ci/index.js';
import type { GitRepositoryObservation } from '../git-repository/index.js';

// Facets are named after the sources that fill them, not after the roles they might be read as
// playing. `gitRepository` and `githubCi` are two names for two observations; "local" and "remote",
// or "code" and "ci", would each be a reading of what those observations mean, and this layer does
// not read them.
export type RepositoryCiGitRepositoryFacet =
  | {
      readonly kind: 'available';
      readonly observation: GitRepositoryObservation;
    }
  | {
      readonly kind: 'unavailable';
    };

export type RepositoryCiGitHubCiFacet =
  | {
      readonly kind: 'available';
      readonly observation: GitHubCiObservation;
    }
  | {
      readonly kind: 'unavailable';
    };

// What one snapshot holds is what each source said, side by side, and nothing that follows from
// holding them together.
//
// There is no scope identifier here, and its absence is the point. A snapshot does not name the
// repository it is about, does not carry a root path or an owner/name, and does not say whether the
// two facets describe the same repository. The World cannot answer that last question without
// comparing facts that belong to its sources, and comparing them is the judgement whose inputs this
// layer is meant to present rather than perform. Whoever reads both facets can see for themselves;
// the World is not entitled to reach the conclusion first and hand it over as a fact.
//
// This is also why the module never sees either source's configuration. The scope exists because
// one composition loaded one git repository source and one GitHub CI source together, and the
// composing code is the thing asserting they belong together. The World is blind to whether that
// assertion holds, by construction rather than by discipline.
//
// `unavailable` deliberately carries no reason: the World does not own the failure taxonomy of the
// sources it composes, so a transport detail must not become part of this contract. A caller that
// needs to know why a source failed asks that source.
export interface RepositoryCiWorldSnapshot {
  readonly snapshotAt: string;
  readonly gitRepository: RepositoryCiGitRepositoryFacet;
  readonly githubCi: RepositoryCiGitHubCiFacet;
}
