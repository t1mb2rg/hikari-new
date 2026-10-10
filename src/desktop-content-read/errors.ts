/**
 * Everything this plugin refuses at its own boundary, and nothing it learns while running.
 *
 * The same class, and the same distinction, as `desktop-session-observe`: a `DesktopContentReadError`
 * says the plugin was handed something it will not accept — a config it cannot use, a host it cannot
 * serve. A read that could not be produced is not an exception; it is one of the five values in
 * `types.ts`, and "there is no window this read can be attributed to" is the endpoint's `failed`
 * outcome.
 *
 * That matters more here than there, because a throw from this module reaches the Runtime and fails
 * the plugin, which takes the endpoint down with it. A read that failed must leave the endpoint
 * standing, or a human who asks about a window that has since closed loses the ability to ask again.
 */
export class DesktopContentReadError extends Error {}
