// The public entry point of the desktop session observation plugin.
//
// Two audiences and nothing for a third. The composition imports the plugin; a client imports the
// endpoint derivation and the wire vocabulary, so that both ends of the pipe are the owner's own
// statement of what the pipe means rather than two copies of it.
//
// `renderAssessment` is exported, and the argument is the one `judgement.ts` makes in the relevance
// plugin rather than the one the work focus's package makes. What stays inside there is the state
// transitions, because a second thing that knew how the focus set moves could disagree with the first
// about a duplicate. There is no such risk here: this rendering is a pure function of a value that is
// already public, it holds nothing and orders nothing, and a second caller cannot reach a different
// answer — it is the same function. The reason to export it anyway is that a transcription pinned
// only by tests that need a named pipe is a transcription CI does not check at all, and every line of
// it is a claim about a contract that CI can check without one.
//
// There is no Service to export, and there is nothing missing: this plugin has no callable need to
// satisfy inside the composition, so by the Contract Creation Gate it provides none.

export { observeEndpointPath } from './endpoint-path.js';
export { DesktopSessionObserveError } from './errors.js';
export { desktopSessionObservePlugin } from './plugin.js';
export type { DesktopSessionObservePluginConfig } from './plugin.js';
export { renderAssessment } from './presentation.js';
export {
  ObserveLineReader,
  decodeObserveReply,
  decodeObserveRequest,
  encodeObserveReply,
  encodeObserveRequest,
} from './protocol.js';
export type { DecodedObserveReply, DecodedObserveRequest, ObserveLineRead } from './protocol.js';
export {
  DESKTOP_SESSION_OBSERVE_PROTOCOL_VERSION,
  MAX_OBSERVE_REPLY_LINE,
  MAX_OBSERVE_REQUEST_LINE,
} from './types.js';
export type {
  DesktopSessionObserveOutcome,
  DesktopSessionObserveReply,
  DesktopSessionObserveRequest,
  DesktopSessionObserveWord,
} from './types.js';
