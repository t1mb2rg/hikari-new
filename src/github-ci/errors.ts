// Two classes and no reason code. A caller distinguishes them with `instanceof`, and a message is
// for a human reading a log. The base class covers this module refusing to operate as asked; the
// subclass covers an observation that was attempted and did not produce one.
export class GitHubCiError extends Error {}

export class GitHubCiObservationError extends GitHubCiError {
  constructor(reason: string) {
    super(`GitHub CI observation failed: ${reason}.`);
  }
}
