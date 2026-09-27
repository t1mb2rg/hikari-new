// What this plugin noticed, as a value another module can be handed.
//
// This is the material of the one proactive path in the repository: the thing Attention produces and
// Language is asked to say out loud. Its shape is therefore load-bearing in a way a private type would
// not be, and the load it carries is this — it holds *facts*, and it holds no words.
//
// There is deliberately no `lines` field, and no `text`, and no `message`. A material that carried the
// words would let whoever built it decide what Hikari says, which is the hole `speak(string)` was
// refused for; wrapping that string in a struct closes nothing. Because this type carries only facts,
// the worst a caller can do is hand over a false occurrence — it cannot make Hikari speak a sentence
// the caller chose. The words are produced by this module's own renderer, on the far side of the
// contract, and the caller never gets to see them before Language does.
//
// The fields are the run's own, flattened out of `GitHubCiRun` rather than nesting it. That is not
// tidiness: an occurrence exists only because this module already judged the run to be a completed,
// reported failure, so carrying `GitHubCiRun` would carry a `status` that is always `'completed'` and
// a `GitHubCiConclusion` whose `absent` arm this module has already excluded. A type that can express
// states its constructor cannot produce is a type every reader of it has to re-derive that fact from.
// `conclusion` is a plain string for the matching reason: the judgement has been made, and what is
// carried afterwards is GitHub's own word for it, verbatim.

/**
 * One CI failure this activation had not handled before.
 *
 * Everything here is a field of the observation that carried it — `repository` and `observedAt` off the
 * observation, the rest off the run it reported — so rendering it is transcription and nothing else.
 * `conclusion` is GitHub's own vocabulary, not a set closed here: the check in `judgement.ts` is what
 * decides which words qualify, and it decides before this value exists.
 */
export interface RepositoryCiAttentionOccurrence {
  /** GitHub's own `owner/name` spelling, exactly as `github-ci` reported it. */
  readonly repository: string;
  readonly runId: number;
  readonly workflow: string;
  readonly headBranch: string;
  readonly headSha: string;
  /** The conclusion GitHub reported, verbatim. Never translated, never mapped onto a set of ours. */
  readonly conclusion: string;
  readonly observedAt: string;
}
