/**
 * Everything this plugin refuses at its own boundary, and nothing it learns while running.
 *
 * A `LanguageError` says the plugin was handed something it will not start with — a config it cannot
 * use, a credential variable that was named and has no value, a host with no pipe namespace. It is
 * not a question going wrong. A model that could not be reached, or a contract that rejected on the
 * way to an answer, is a `failed` reply this plugin *gives*; it is caught at the endpoint and never
 * thrown past it.
 *
 * The distinction is worth the class being near-empty, and it is sharper here than in the sibling
 * plugins. An error thrown from here reaches the Runtime, which fails the plugin and takes its
 * endpoint down with it — so a resident with a broken model configuration fails to start, loudly,
 * rather than starting and then failing every question a human asks. A model that is down, by
 * contrast, must leave the endpoint standing, because the next question is still a question.
 */
export class LanguageError extends Error {}
