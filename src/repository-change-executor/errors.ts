// The one error type this package raises instead of answering.
//
// Everything the executor decides is an answer — a halt, a refusal, a line of prose — because a person is
// waiting and "something threw" is not something to tell them. What is left over is activation: a plugin
// whose endpoint cannot exist on this host, or whose model was never wired. Those are not answers to a
// question nobody asked yet; they are the plugin saying it cannot be what it is, which is what a `setup`
// throwing means.

export class RepositoryChangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RepositoryChangeError';
  }
}
