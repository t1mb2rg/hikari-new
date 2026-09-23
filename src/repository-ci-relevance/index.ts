// The public entry point of the Repository CI relevance plugin.
//
// Three audiences and nothing for a fourth. The composition imports the plugin; a client imports the
// endpoint derivation and the wire vocabulary, so that both ends of the pipe are the owner's own
// statement of what the pipe means rather than two copies of it; and a consumer imports the contract and
// the exposure, which is the service-shaped side of the same plugin.
//
// `judgeRelevance` and `renderJudgement` are both exported, and the line between what leaves this package
// and what stays is the one the work focus draws in a different place. What stays inside there is the
// state transitions, because a second thing that knew how the focus set moves could disagree with the
// first about a duplicate, and which one a human went through would decide what they read back. There is
// no such risk here: this judgement is a pure function of two values that are both already public, it
// holds nothing and orders nothing, and a second caller of it cannot reach a different answer — it is the
// same function.
//
// The reason the export of `judgeRelevance` is worth making is the reason the work focus's package is not
// the whole story: the frozen v1 relevance rule is a truth table over two strings, and a rule pinned only
// by tests that need a named pipe is a rule CI does not check at all. This repository has already been
// bitten by exactly that — the production roster could have lost a member with the suite green on CI —
// and a rule this narrow is better pinned everywhere than pinned where the pipes are.
//
// `renderJudgement` was held back under the argument that it had one caller and there was no case for a
// second. There is one now, and the argument is `desktop-session-observe`'s for exporting
// `renderAssessment`: Language offers this judgement to a model as a capability, and the lines a model is
// shown have to be the lines a human is shown, byte for byte. A consumer that formatted the judgement
// itself — even into the same words — would be a second, unowned statement of what this domain's verdict
// reads like, and the two would be free to drift the moment either changed. The renderer is the owner's
// deterministic serialization of its own judgement, it decides nothing about presentation beyond that,
// and it is exported so that there is exactly one of it.
//
// There was no Service to export, and now there is one, because the reason for its absence went away.
// This plugin's contract is `repository-ci-relevance.current@1`, its consumer is the repository-aware
// Language variant, and both appear here for the same reason the endpoint vocabulary does: the owner
// states what it means, and the consumer does not restate it.

export { relevanceEndpointPath } from './endpoint-path.js';
export { RepositoryCiRelevanceError } from './errors.js';
export { judgeRelevance, renderJudgement } from './judgement.js';
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
export { repositoryCiRelevanceService } from './contracts.js';
export type { RepositoryCiRelevanceService } from './contracts.js';
export { repositoryCiRelevanceReadExposure } from './exposure.js';
export type { RepositoryCiRelevanceReadExposure } from './exposure.js';
