// The public entry point of the work focus plugin.
//
// Two audiences, and nothing for a third. The composition imports the plugin and its config type; a
// client imports the endpoint derivation and the wire vocabulary, so that both ends of the pipe are
// the owner's own statement of what the pipe means rather than two copies of it.
//
// What is *not* exported is as deliberate as what is. The state transitions, the endpoint listener
// and the renderer stay inside: a consumer that could import `applyWorkFocusRequest` would be a
// second thing that knows how the set moves, and the day those two disagree about a duplicate, the
// set a human reads back would depend on which one they went through. There is no Service contract
// here either — see `plugin.ts` for why the absence is the design rather than a gap.

export { workFocusPlugin } from './plugin.js';
export type { WorkFocusPluginConfig } from './plugin.js';
export { workFocusEndpointPath } from './endpoint-path.js';
export { WorkFocusError } from './errors.js';
export {
  WorkFocusLineReader,
  decodeWorkFocusReply,
  decodeWorkFocusRequest,
  encodeWorkFocusReply,
  encodeWorkFocusRequest,
} from './protocol.js';
export type { DecodedWorkFocusReply, DecodedWorkFocusRequest, WorkFocusLineRead } from './protocol.js';
export {
  MAX_WORK_FOCUS_REPLY_LINE,
  MAX_WORK_FOCUS_REQUEST_LINE,
  WORK_FOCUS_PROTOCOL_VERSION,
} from './types.js';
export type { WorkFocusOutcome, WorkFocusReply, WorkFocusRequest, WorkFocusWord } from './types.js';
