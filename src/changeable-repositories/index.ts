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
// That paragraph is kept where it was written, because it named the trigger exactly and half of the
// trigger has now fired. The *action* half has not arrived and was left `BLOCKED` by the composition
// boundary review; the *read* half has, and it arrived the way the sentence predicted — through Language,
// as a `Service` call. So there is a third audience now: this barrel publishes
// `changeable-repositories.read@1`, its two renderers, and the two exposures Language offers a model. The
// pointer is here rather than in a rewrite of the paragraph above for the reason the architecture notes
// give about superseded records: a paragraph that was right about the mechanism should not be edited into
// one that is wrong about the tense.
//
// What is *not* exported is as deliberate as what is. The state transitions, the endpoint listener, the
// durable fact family and the history reader stay inside: a consumer that could import
// `applyChangeableRepositoriesRequest` would be a second thing that knows how the set moves, and the day
// those two disagree about a duplicate, the set a human reads back would depend on which one they went
// through. A consumer reads the set the way it is meant to be read — through the contract below, which
// this plugin publishes now that it has one.
//
// The one renderer that stays inside is `renderChangeableRepositories`, and the read half reaches it
// rather than re-exporting it: a model has to be shown the same list a human reads on a command line, and
// the way to guarantee that is for both surfaces to call one function, not for two barrels to export the
// same symbol. What *is* exported is `renderRepositoryRead`, because an answer's frame is the owner's to
// write and the consumer's only job with it is to escape each line — see `read.ts`.
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
  MAX_REPOSITORY_DIRECTORY_ENTRIES,
  MAX_REPOSITORY_READ_BYTES,
  changeableRepositoriesReadService,
  createChangeableRepositoriesRead,
  renderAuthorizedRepositories,
  renderRepositoryRead,
} from './read.js';
export type {
  ChangeableRepositoriesReadService,
  RepositoryRead,
  RepositoryReadForm,
} from './read.js';
export { authorizedRepositoriesListExposure, authorizedRepositoryReadExposure } from './exposure.js';
export type {
  AuthorizedRepositoriesListExposure,
  AuthorizedRepositoryReadExposure,
} from './exposure.js';
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
