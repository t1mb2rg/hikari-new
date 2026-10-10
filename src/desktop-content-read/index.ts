// The public entry point of the desktop content read plugin.
//
// Two audiences and nothing for a third. The composition imports the plugin; a client imports the
// endpoint derivation and the wire vocabulary, so that both ends of the pipe are the owner's own
// statement of what the pipe means rather than two copies of it.
//
// `renderContentRead` and `decideContentRead` are exported, on the argument `judgement.ts` makes in the
// relevance plugin rather than the one the work focus's package makes. What stays inside the work focus
// is its state transitions, because a second thing that knew how a focus set moves could disagree with
// the first about a duplicate. Neither of these has that shape: both are pure functions of values that
// are already public, they hold nothing and order nothing, and a second caller cannot reach a
// different answer — they are the same functions. The reason to export them anyway is the reason the
// sibling endpoint exports its renderer: a decision or a transcription pinned only by tests that need a
// named pipe is one CI does not check at all, and this machine's pipes are the one thing CI cannot
// give every platform.
//
// `isAdmissibleSample` / `latestAdmissibleSample` / `toWindowIdentity` are exported for the same
// reason and are the most valuable of the set: the attribution rule is the part of this slice a
// reviewer has to be able to check, and it is pure precisely so that they can check it anywhere.
//
// There is no Service to export, and there is nothing missing: by the Contract Creation Gate this
// plugin provides none, because nothing inside the composition calls it. Its one input arrives as an
// occurrence it subscribes to, and its one output leaves through a named pipe.

export { contentReadEndpointPath } from './endpoint-path.js';
export { DesktopContentReadError } from './errors.js';
export { createDesktopContentReadPlugin, desktopContentReadPlugin } from './plugin.js';
export type { DesktopContentReadPluginConfig } from './plugin.js';
export { renderContentRead } from './presentation.js';
export {
  ContentReadLineReader,
  decodeContentReadReply,
  decodeContentReadRequest,
  encodeContentReadReply,
  encodeContentReadRequest,
} from './protocol.js';
export type {
  ContentReadLineRead,
  DecodedContentReadReply,
  DecodedContentReadRequest,
} from './protocol.js';
export {
  CONTENT_READ_WINDOW_SOURCE,
  isAdmissibleSample,
  latestAdmissibleSample,
  toWindowIdentity,
} from './target.js';
export type { WindowSample } from './target.js';
export { decideContentRead, isWalkTimeout, WALKER } from './uia.js';
export type { ContentReadWalk, WalkCounts } from './uia.js';
export {
  DESKTOP_CONTENT_READ_PROTOCOL_VERSION,
  MAX_CONTENT_READ_REPLY_LINE,
  MAX_CONTENT_READ_REQUEST_LINE,
  READ_MAX_CHARS,
  READ_MAX_DEPTH,
  READ_MAX_NODES,
} from './types.js';
export type {
  ContentChannel,
  ContentNode,
  ContentRead,
  ContentReadBounds,
  ContentReadTruncatedBy,
  ContentReadWindowSource,
  DesktopContentReadOutcome,
  DesktopContentReadReply,
  DesktopContentReadRequest,
  DesktopContentReadWord,
  NotVisibleBecause,
  Region,
  ViewportRelation,
  WindowIdentity,
} from './types.js';
