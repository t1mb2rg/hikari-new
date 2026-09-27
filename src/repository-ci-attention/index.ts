// The public entry point of the Repository CI attention plugin.
//
// Three audiences, exactly as the sibling chain modules have. The composition imports the plugin; a
// test imports the two pure functions, because a rule pinned only where the pipes are is a rule CI
// does not check; and `language` imports the occurrence type and its renderer, which is the
// service-shaped side of this module and the pair of imports that makes the speaking path work.
//
// `detectNewFailure` and `renderOccurrence` are exported for the reason `repository-ci-relevance`
// gives for exporting `judgeRelevance` and `renderJudgement`, and it is the same argument in both
// halves. `detectNewFailure` is a truth table over one observation and a set of already-handled ids,
// which is precisely the kind of rule this repository has already lost once by pinning it only in a
// test that needs a named pipe. `renderOccurrence` is the owner's deterministic serialization of its
// own judgement: it decides nothing about presentation beyond the labels, and it is exported so that
// there is exactly one statement of what this domain's occurrence reads like — the alternative is
// Language writing its own copy, and the two drifting the first time either changes.
//
// What stays inside is the cadence, the handled set and the delivery policy. Those are not a rule
// but a lifetime: a second thing that held its own set of handled run ids would disagree with the
// first about whether a failure is new, and which one a human went through would decide what they
// were told. There is no such risk in the two functions above — both are pure, both hold nothing, and
// a second caller cannot reach a different answer, because it is the same function.
//
// There is no endpoint, no protocol and no wire vocabulary here, and their absence is the shape of
// this module rather than an unfinished part of it. Every other domain in this repository exports a
// client protocol because a person asks it a question; nobody asks this one anything. It only ever
// speaks, and what it says leaves through `human-delivery`.

export { detectNewFailure, renderOccurrence } from './judgement.js';
export { repositoryCiAttentionPlugin } from './plugin.js';
export type { RepositoryCiAttentionPluginConfig } from './plugin.js';
export type { RepositoryCiAttentionOccurrence } from './types.js';
