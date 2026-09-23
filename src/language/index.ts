// The public entry point of the language plugin.
//
// Three audiences and nothing for a fourth. The composition imports the plugin; a client imports the
// endpoint derivation and the wire vocabulary, so that both ends of the pipe are the owner's own
// statement of what the pipe means rather than two copies of it; and a test imports the pipeline.
//
// `createAnswerer` is exported, and the argument is the one `desktop-session-observe` makes for
// `renderAssessment` rather than the one the work focus's package makes. What stays inside there is the
// dialogue turn's lifetime, because a second thing that held its own turn could answer a follow-up
// against a different referent than the one Hikari answered. There is no such risk here: the answerer
// takes its three dependencies as arguments and holds nothing but the turn the caller's own construction
// created, so a test's answerer and the plugin's answerer cannot disagree about anything except what the
// test deliberately chose. The reason to export it anyway is the reason CI is the audience — this
// repository's tests run on `ubuntu-latest`, where there are no named pipes, so every behaviour reached
// only through the endpoint is a behaviour CI skips. "The model's tool name must survive a closed-set
// lookup" is the central claim of this slice and it is checked here, without a pipe, or it is not
// checked at all — and now that the claim is about a *sequence* of steps, a test that could only reach
// the pipeline through a pipe would be unable to write the sequence down.
//
// The exposure sets and the derivation from them are exported for the same reason. `toModelTools` is
// what turns a list into the wire list, and `findExposure`/`readArguments` are the closed-set lookup and
// the argument rule — the things a test has to be able to name in order to check that what a model is
// offered and what the loop will act on are the same set. `exposure.ts` used to be imported by path in
// tests with a note saying it had no reader in `src` yet; it has one now, so it has a barrel entry.
//
// There are two lists now, and both are exported because a test has to be able to name either one: the
// base set is what a resident without a repository scope offers, and the repository set is what a
// resident with one offers. Neither is exported in order to be assembled from — nothing outside
// `exposure.ts` builds a list, and both plugin factories take theirs whole.
//
// The renderers are *not* exported, and that is the same argument read the other way. A test reaches
// every one of them through the answerer, which is the only way a question reaches them in production;
// exporting the pieces separately would be publishing an entry point no caller has, which is exactly
// what the Contract Creation Gate refuses. Wording that a test wants to pin is pinned by asking a
// question and reading the lines that came back. `renderFocus` is exported from its own module because
// `read.ts` calls it, which is a caller inside this package and not a public entry point.
//
// There are two plugin exports now rather than one, and the difference between them is a requirement
// rather than a mode. `languagePlugin` is the base variant every model-bearing resident loads;
// `repositoryLanguagePlugin` additionally requires `repository-ci-relevance.current@1` and offers the
// judgement as a third read. Only ever one of the two is loaded, and which one is the composition's
// decision — see `cli/resident.ts`.
//
// There is still no Service to export, in either variant. Offering a capability to a model is the
// opposite direction from providing one to the composition, and nothing in the composition asks this
// plugin for anything: the one thing that does is a person, arriving over the endpoint. See `plugin.ts`.

export { createAnswerer } from './answer.js';
export type { Answerer, LanguageDependencies } from './answer.js';
export { languageEndpointPath } from './endpoint-path.js';
export { LanguageError } from './errors.js';
// The transport's own per-call bound, for the reason the endpoint derivation is exported: a client
// asking a question has to wait longer than the server can legitimately take, and `cli/ask.ts` cannot
// size its wait against a number it would otherwise have to copy. It is the owner's number, so it
// travels from the owner.
export { MODEL_TIMEOUT_MS } from './model.js';
export {
  createLanguagePlugin,
  createRepositoryLanguagePlugin,
  languagePlugin,
  repositoryLanguagePlugin,
} from './plugin.js';
export type { LanguagePluginConfig } from './plugin.js';
export {
  decodeLanguageReply,
  decodeLanguageRequest,
  encodeLanguageReply,
  encodeLanguageRequest,
  LanguageLineReader,
} from './protocol.js';
export type { DecodedLanguageReply, DecodedLanguageRequest, LanguageLineRead } from './protocol.js';
// The closed sets, and the functions that consume them. A test reads these to check that what a model
// is offered, what the loop will act on, and what the variant's `requires` names are one set rather
// than three that agree today — and that the base set is still exactly the two entries it always was.
export { LANGUAGE_EXPOSURES, LANGUAGE_REPOSITORY_EXPOSURES } from './exposure.js';
export type { LanguageExposure } from './exposure.js';
export { findExposure, readArguments, toModelTools } from './tools.js';
export type { ArgumentReading } from './tools.js';
export {
  LANGUAGE_PROTOCOL_VERSION,
  MAX_LANGUAGE_REPLY_LINE,
  MAX_LANGUAGE_REQUEST_LINE,
  MAX_LANGUAGE_TEXT_LENGTH,
} from './types.js';
export type {
  LanguageOutcome,
  LanguageReply,
  LanguageRequest,
  LanguageWord,
} from './types.js';
