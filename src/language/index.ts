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
// The exposure set and the derivation from it are exported for the same reason. `toModelTools` is what
// turns `LANGUAGE_EXPOSURES` into the wire list, and `findExposure`/`readArguments` are the closed-set
// lookup and the argument rule — the three things a test has to be able to name in order to check that
// what a model is offered and what the loop will act on are the same set. `exposure.ts` used to be
// imported by path in tests with a note saying it had no reader in `src` yet; it has one now, so it has
// a barrel entry.
//
// The renderers are *not* exported, and that is the same argument read the other way. A test reaches
// every one of them through the answerer, which is the only way a question reaches them in production;
// exporting the pieces separately would be publishing an entry point no caller has, which is exactly
// what the Contract Creation Gate refuses. Wording that a test wants to pin is pinned by asking a
// question and reading the lines that came back. `renderFocus` is exported from its own module because
// `read.ts` calls it, which is a caller inside this package and not a public entry point.
//
// There is no Service to export. Nothing in the composition asks this plugin for anything: the one thing
// that does is a person, arriving over the endpoint. See `plugin.ts`.

export { createAnswerer } from './answer.js';
export type { Answerer, LanguageDependencies } from './answer.js';
export { languageEndpointPath } from './endpoint-path.js';
export { LanguageError } from './errors.js';
export { createLanguagePlugin, languagePlugin } from './plugin.js';
export type { LanguagePluginConfig } from './plugin.js';
export {
  decodeLanguageReply,
  decodeLanguageRequest,
  encodeLanguageReply,
  encodeLanguageRequest,
  LanguageLineReader,
} from './protocol.js';
export type { DecodedLanguageReply, DecodedLanguageRequest, LanguageLineRead } from './protocol.js';
// The closed set, and the three functions that consume it. A test reads these to check that what a
// model is offered, what the loop will act on, and what the plugin's `requires` names are one set
// rather than three that agree today.
export { LANGUAGE_EXPOSURES } from './exposure.js';
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
