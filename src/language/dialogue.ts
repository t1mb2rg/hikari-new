// The short-term state a follow-up needs, and the whole of it: either the capabilities the last
// grounded answer read, or nothing.
//
// A human says "那刚才那个呢？" and the sentence has no subject. Something has to hold the subject, and
// the smallest thing that can is what the previous turn actually read. That is what is here — a list of
// capability names and the moment it was recorded, and nothing else. There is no transcript, no turn
// list, no summary, no entity graph, no topic stack, no participant model and no durable store. A
// second turn does not append to the first; it replaces it, because a human asking "刚才那个" means the
// last thing and not the conversation.
//
// The subject used to be a topic — one of four words this surface chose for the human. It is a list of
// capability names now, and that is a smaller thing to hold rather than a larger one. A topic was this
// surface's own vocabulary, so the model had to be taught it and a follow-up had to be translated back
// out of it before anything could be read. A capability name is what the model already writes when it
// wants something, so the referent is now expressible directly: "接着读上一轮读过的那两个" is a sentence
// the model can act on, with no translation step and nothing new for it to learn.
//
// Why this is not Memory, stated as a property rather than a promise. Memory is durable, carries
// provenance, confidence and revision, and anything reading it is entitled to treat what it finds as a
// fact Hikari established. This holds none of those and is none of those: it lives in one plugin's
// activation closure, it is gone when that activation ends, and what it carries is not a fact about
// the world but a note about what a human was just asking about. The two must not be merged, and the
// structural reason they cannot be is that nothing here outlives a process — there is no file, no
// store and no Chronicle entry behind it, so there is nothing that could survive to be mistaken for
// one.
//
// The expiry is the reset boundary, and it is one bound rather than two mechanisms. "刚才" is a word
// about the recent past, so a referent from long enough ago is not what the human is pointing at, and
// lending it the authority of the present would be this layer answering a question the human did not
// ask. Past that bound the context is not "stale but usable" — it is absent, and a follow-up then
// comes back refused like any other sentence this build cannot place.
//
// A turn is recorded only when a question was actually answered *and* the answer was grounded in a
// reading. That second half is new, and it is what keeps the referent meaning something. A chat reply
// read nothing, so it has no subject to lend — advancing on it would make "刚才那个" point at a turn in
// which Hikari established nothing, and the next question would be answered against an empty set. It
// also does not clear what is there: a human who says "ayobro" between two questions about their screen
// has not changed the subject, so the previous reading stays the referent until something grounded
// replaces it or it ages out. A refusal never understood the question and a failure never reached the
// model; neither advances, and neither clears, for the same reason as before.
//
// Known limit, recorded rather than solved: the state belongs to the plugin activation and is shared
// by every client that reaches it, so two terminals asking at once share one referent. Making it
// per-client would need a session identity this build has no other use for, and inventing one here
// would be a session framework built for a five-minute pointer. v1 has no such surface and does not
// pretend otherwise.

/** The capabilities the last grounded answer read, and when it read them. */
export interface DialogueTurn {
  /** Exposure names, in the order they were read. Never empty: an empty set is `null`, not a turn. */
  readonly reads: readonly string[];
  /** ISO 8601, as the endpoint's own clock wrote it. */
  readonly at: string;
}

/**
 * How long a turn stays usable as a referent.
 *
 * Five minutes is not a measurement of human memory; it is the point past which "刚才" would be a
 * word the human did not use. A longer bound would let a reading from earlier in the day answer a
 * question about now, which is the failure this bound exists to prevent rather than a convenience it
 * gives up.
 */
export const DIALOGUE_CONTEXT_TTL_MS = 5 * 60 * 1000;

/**
 * Record what a grounded answer read.
 *
 * The array is frozen alongside the object. A referent that a later turn could append to would be a
 * transcript forming one push at a time, and the freeze is what makes that impossible rather than
 * discouraged.
 */
export function advanceDialogue(reads: readonly string[], at: string): DialogueTurn {
  return Object.freeze({ reads: Object.freeze([...reads]), at });
}

/**
 * The turn a follow-up may be answered against, or `null` if there is none to use.
 *
 * `null` is one answer with several causes and they are deliberately not distinguished: never having
 * answered anything, a turn that aged out, and a clock that moved backwards all leave the model with
 * nothing to be shown, and a caller that could tell them apart would be a caller with a reason to say
 * something different to a human about each. A wall clock that went backwards is treated as expired
 * rather than trusted, because two timestamps that disagree about which came first cannot be compared
 * and the conservative reading of "not comparable" is "not usable".
 */
export function usableDialogueTurn(turn: DialogueTurn | null, now: string): DialogueTurn | null {
  if (turn === null) return null;

  const elapsed = Date.parse(now) - Date.parse(turn.at);
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > DIALOGUE_CONTEXT_TTL_MS) return null;
  return turn;
}
