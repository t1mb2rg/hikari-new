// The public entry point of the authorization plugin.
//
// Two audiences, and nothing for a third. The composition imports the plugin and its config type; a
// client imports the endpoint derivation and the wire vocabulary, so that both ends of the pipe are the
// owner's own statement of what the pipe means rather than two copies of it.
//
// The sibling's third audience is absent here, and the absence is the same decision as the empty
// `provides`: no layer talks to a model about this domain yet, because the human's sentence is not this
// plugin's input. What this plugin holds is a directory set a human named on a command line, and there
// is nothing here for a model to phrase. When the action half arrives it will arrive through Language —
// as a `Service` call, not as text — and the words that describe *that* will be that slice's to write.
//
// What is *not* exported is as deliberate as what is. The state transitions, the endpoint listener, the
// renderer, the durable fact family and the history reader stay inside: a consumer that could import
// `applyChangeableRepositoriesRequest` would be a second thing that knows how the set moves, and the day
// those two disagree about a duplicate, the set a human reads back would depend on which one they went
// through. A consumer reads the set the way it is meant to be read — through a contract, which this
// plugin does not publish yet because it has no consumer.
//
// The history reader is inside for that same reason and one more: it is the only thing that decides what
// a persisted declaration means on the way back in, and a published reader would be a second door into
// the same question — including, on a day somebody got it wrong, a door that read an unreadable record
// as an empty authorization.

export { changeableRepositoriesPlugin } from './plugin.js';
export type { ChangeableRepositoriesPluginConfig } from './plugin.js';
export { changeableRepositoriesEndpointPath } from './endpoint-path.js';
export { ChangeableRepositoriesError } from './errors.js';
export {
  ChangeableRepositoriesLineReader,
  decodeChangeableRepositoriesReply,
  decodeChangeableRepositoriesRequest,
  encodeChangeableRepositoriesReply,
  encodeChangeableRepositoriesRequest,
} from './protocol.js';
export type {
  ChangeableRepositoriesLineRead,
  DecodedChangeableRepositoriesReply,
  DecodedChangeableRepositoriesRequest,
} from './protocol.js';
export {
  CHANGEABLE_REPOSITORIES_PROTOCOL_VERSION,
  MAX_CHANGEABLE_REPOSITORIES_REPLY_LINE,
  MAX_CHANGEABLE_REPOSITORIES_REQUEST_LINE,
} from './types.js';
export type {
  ChangeableRepositoriesOutcome,
  ChangeableRepositoriesReply,
  ChangeableRepositoriesRequest,
  ChangeableRepositoriesWord,
} from './types.js';
