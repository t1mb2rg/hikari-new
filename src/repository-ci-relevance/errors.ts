/**
 * Everything this plugin refuses at its own boundary, and nothing it learns while running.
 *
 * A `RepositoryCiRelevanceError` says the plugin was handed something it will not accept — a config it
 * cannot use, a host it cannot serve. It is not a judgement going wrong: a judgement that cannot be
 * completed is an answer this plugin gives (`outcome: 'failed'`), not an exception it throws, and a
 * dependency rejecting on the way to an answer is caught at the endpoint and reported the same way.
 *
 * That distinction is worth the class being near-empty. An error thrown from here reaches the Runtime,
 * which fails the plugin and takes the endpoint down with it; a judgement that did not complete must
 * leave the endpoint standing so the next question can still be asked.
 */
export class RepositoryCiRelevanceError extends Error {}
