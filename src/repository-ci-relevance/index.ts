// The public entry point of the Repository CI relevance plugin.
//
// Two audiences and nothing for a third. The composition imports the plugin; a client imports the
// endpoint derivation and the wire vocabulary, so that both ends of the pipe are the owner's own
// statement of what the pipe means rather than two copies of it.
//
// `judgeRelevance` is exported and `renderJudgement` is not, and the line between them is the one
// the work focus draws in a different place. What stays inside there is the state transitions,
// because a second thing that knew how the focus set moves could disagree with the first about a
// duplicate, and which one a human went through would decide what they read back. There is no such
// risk here: this judgement is a pure function of two values that are both already public, it holds
// nothing and orders nothing, and a second caller of it cannot reach a different answer — it is the
// same function. The rendering stays in because it has one caller and no such argument.
//
// The reason the export is worth making is the reason the work focus's package is not the whole
// story: the frozen v1 relevance rule is a truth table over two strings, and a rule pinned only by
// tests that need a named pipe is a rule CI does not check at all. This repository has already been
// bitten by exactly that — the production roster could have lost a member with the suite green on CI
// — and a rule this narrow is better pinned everywhere than pinned where the pipes are.
//
// There is no Service to export, and there is nothing missing: this plugin has no callable need to
// satisfy inside the composition, so by the Contract Creation Gate it provides none.

export { relevanceEndpointPath } from './endpoint-path.js';
export { RepositoryCiRelevanceError } from './errors.js';
export { judgeRelevance } from './judgement.js';
export { repositoryCiRelevancePlugin } from './plugin.js';
export type { RepositoryCiRelevancePluginConfig } from './plugin.js';
export {
  RelevanceLineReader,
  decodeRelevanceReply,
  decodeRelevanceRequest,
  encodeRelevanceReply,
  encodeRelevanceRequest,
} from './protocol.js';
export type { DecodedRelevanceReply, DecodedRelevanceRequest, RelevanceLineRead } from './protocol.js';
export {
  MAX_RELEVANCE_REPLY_LINE,
  MAX_RELEVANCE_REQUEST_LINE,
  RELEVANCE_PROTOCOL_VERSION,
} from './types.js';
export type {
  RelevanceOutcome,
  RelevanceReply,
  RelevanceRequest,
  RelevanceWord,
  RepositoryCiRelevanceJudgement,
  RepositoryCiRelevanceVerdict,
} from './types.js';
