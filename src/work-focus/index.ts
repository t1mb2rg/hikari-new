// The public entry point of the work focus plugin.
//
// Three audiences, and nothing for a fourth. The composition imports the plugin and its config type; a
// client imports the endpoint derivation and the wire vocabulary, so that both ends of the pipe are
// the owner's own statement of what the pipe means rather than two copies of it; and a layer that talks
// to a model imports the agent-facing exposure, for the same reason and against the same failure — the
// words that describe this domain's capability are this domain's to write.
//
// What is *not* exported is as deliberate as what is. The state transitions, the endpoint listener,
// the renderer and the durable fact family stay inside: a consumer that could import
// `applyWorkFocusRequest` would be a second thing that knows how the set moves, and the day those two
// disagree about a duplicate, the set a human reads back would depend on which one they went through.
// A consumer reads the set the same way everybody else does — through `workFocusCurrentService`, which
// is exported below.
//
// The fact family is inside for that same reason and one more. The three type names are this owner's
// statement about its own occurrences, and they travel in exactly one direction: this plugin writes
// them into Chronicle. Nothing reads them back — not this module, which starts empty in a new Runtime
// regardless of what the history holds, and not any other, since there is still no reader that asks
// what this plugin's durable history says. Exporting the names would publish a vocabulary ahead of the
// need for it, which is the shape `plugin-design-spec.md` §16 exists to refuse.

export { workFocusCurrentService } from './contracts.js';
export type { WorkFocusCurrentService } from './contracts.js';
export { workFocusReadExposure } from './exposure.js';
export type { WorkFocusReadExposure } from './exposure.js';
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
