// Two classes and no reason code. A caller distinguishes them with `instanceof`, and a message is
// for a human reading a log. The base class covers this module refusing to operate as asked; the
// subclass covers an observation that was attempted and did not produce one.
export class GitRepositoryError extends Error {}

export class GitRepositoryObservationError extends GitRepositoryError {
  constructor(reason: string) {
    super(`Git repository observation failed: ${reason}.`);
  }
}
