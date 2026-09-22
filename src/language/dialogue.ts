// The short-term state a follow-up needs, and the whole of it: either one topic, or nothing.
//
// A human says "那刚才那个呢？" and the sentence has no subject. Something has to hold the subject, and
// the smallest thing that can is the topic the last accepted question was understood as. That is what
// is here — one topic and the moment it was understood, and nothing else. There is no transcript, no
// turn list, no summary, no entity graph, no topic stack, no participant model and no durable store.
// A second turn does not append to the first; it replaces it, because a human asking "刚才那个" means
// the last thing and not the conversation.
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
// about the recent past, so a topic from long enough ago is not what the human is pointing at, and
// lending it the authority of the present would be this layer answering a question the human did not
// ask. Past that bound the context is not "stale but usable" — it is absent, and a follow-up then
// comes back refused like any other sentence this build cannot place.
//
// A turn is recorded only when a question was actually answered. A refusal did not understand the
// question, and a failure did not reach the model at all; letting either become the new referent
// would mean the next "刚才那个" pointed at a question Hikari never answered.
//
// Known limit, recorded rather than solved: the state belongs to the plugin activation and is shared
// by every client that reaches it, so two terminals asking at once share one referent. Making it
// per-client would need a session identity this build has no other use for, and inventing one here
// would be a session framework built for a five-minute pointer. v1 has no such surface and does not
// pretend otherwise.

import type { LanguageTopic } from './topics.js';

/** What the last accepted question asked about, and when it was accepted. */
export interface DialogueTurn {
  readonly topic: LanguageTopic;
  /** ISO 8601, as the endpoint's own clock wrote it. */
  readonly at: string;
}

/**
 * How long a turn stays usable as a referent.
 *
 * Five minutes is not a measurement of human memory; it is the point past which "刚才" would be a
 * word the human did not use. A longer bound would let a topic from earlier in the day answer a
 * question about now, which is the failure this bound exists to prevent rather than a convenience it
 * gives up.
 */
export const DIALOGUE_CONTEXT_TTL_MS = 5 * 60 * 1000;

export function advanceDialogue(topic: LanguageTopic, at: string): DialogueTurn {
  return Object.freeze({ topic, at });
}

/**
 * The turn a follow-up may be understood against, or `null` if there is none to use.
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
