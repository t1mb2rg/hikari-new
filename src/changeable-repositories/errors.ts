// What this plugin refuses to do as a plugin, as opposed to what it refuses to do as a domain.
//
// The distinction is the one `work-focus/errors.ts` draws: a refusal a human reads is an answer with a
// reason in `lines`, while this error means the plugin cannot carry its capability on this host or was
// configured with something that is not a configuration. Those end the activation, because a plugin
// that cannot reach the surface it exists for has nothing to be active about.

export class ChangeableRepositoriesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChangeableRepositoriesError';
  }
}
