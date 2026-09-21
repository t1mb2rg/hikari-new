/**
 * Everything this plugin refuses at its own boundary, and nothing it learns while running.
 *
 * The name is the point. A `WorkFocusError` says the plugin was handed something it will not accept
 * — a config it cannot use, a host it cannot serve. It is not an observation failure, because this
 * plugin observes nothing: it holds what a human told it and answers questions about that.
 */
export class WorkFocusError extends Error {}
