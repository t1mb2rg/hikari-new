/** The only version this build speaks. A mismatch is refused, never guessed at. */
export const DESKTOP_SESSION_OBSERVE_PROTOCOL_VERSION = 1;

/**
 * The one question this endpoint answers.
 *
 * There is one word rather than none because a request that carries no word has no way to be wrong:
 * anything well-formed would be answered, and "this build does not know that request" would stop
 * being sayable. A closed vocabulary of one is still a closed vocabulary.
 *
 * `status` here means "read the composition's current desktop-session assessment out loud". It
 * carries no payload for the same reason the other two endpoints' words do not: the question is
 * about what this Hikari already holds, and a client that could name a facet, a field or a moment in
 * the request would be asking a different question than the one this surface was built to answer.
 */
export type DesktopSessionObserveWord = 'status';

/** A request carries its word and nothing else. There is no payload and no field reserved for one. */
export interface DesktopSessionObserveRequest {
  readonly word: DesktopSessionObserveWord;
}

/**
 * The answer, in the two shapes the endpoint can give.
 *
 * Both shapes are lines, and there is deliberately no machine-readable verdict beside them. The
 * sibling relevance endpoint carries one because its answer *is* a two-word verdict; this answer is
 * an assessment, and any field rich enough to carry an assessment would be a second encoding of
 * `DesktopSessionAwarenessAssessment` on the wire — a second statement of a contract that already
 * has an owner, and free to drift from the one in `desktop-session-awareness/types.ts`. The only
 * thing the client has to tell apart is whether the assessment was produced, and `outcome` says
 * exactly that, which is why the two shapes differ in that field and in nothing else.
 *
 * `failed` is not an observation. It is the endpoint saying the assessment could not be produced — a
 * dependency that rejected, an acquisition that threw. Keeping it a separate outcome rather than
 * folding it into an `ok` whose facets read `unavailable` is the whole reason the two shapes exist:
 * an `unavailable` facet is something the World reported, and a human who reads it is entitled to
 * believe an observation was attempted and came back that way.
 */
export type DesktopSessionObserveReply =
  | { readonly outcome: 'ok'; readonly lines: readonly string[] }
  | { readonly outcome: 'failed'; readonly lines: readonly string[] };

/**
 * The answer to a query, in the three shapes the client has to tell apart.
 *
 * There are three rather than the relevance client's four because `unconfigured` has no meaning
 * here. The Repository CI chain is loaded only when an operator asked for it, so "nothing is
 * listening" there is two different facts that only the Resident's control channel can separate.
 * This plugin is a member of the base composition, so a resident either has it or is not running.
 *
 * `absent` is therefore still not quite one fact, and it is the same second fact the work focus
 * client faces: a Resident stopping unloads plugins in reverse load order, so every domain endpoint is
 * gone while the process is still alive and its control channel still answering. This plugin loads
 * before `work-focus`, so reverse unload takes it down after it, which makes the window in which
 * `absent` can also mean "a resident is stopping" narrower here than in `focus.ts` rather than wider —
 * but it is the same window, and it is still not one fact. That is handled by wording rather than by a
 * fourth case, exactly as it is in `src/cli/focus.ts`, and for the reason recorded there.
 */
export type DesktopSessionObserveOutcome =
  | { readonly kind: 'answered'; readonly reply: DesktopSessionObserveReply }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unavailable'; readonly detail: string };

// Bounds on the decoded text, not on wire bytes. Both sides are ours and the vocabulary is one word
// about forty characters long, so these are generous by three orders of magnitude. They exist so that
// neither side can be made to buffer without limit by whoever is on the other end of the pipe. The
// reply bound is the control channel's rather than the request's because an assessment renders to
// more lines than any other answer in this repository — and it is still a fixed, known ceiling,
// because nothing in an assessment grows with anything a client can send.
export const MAX_OBSERVE_REQUEST_LINE = 1024;
export const MAX_OBSERVE_REPLY_LINE = 64 * 1024;
