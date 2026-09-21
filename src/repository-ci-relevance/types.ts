/** The only version this build speaks. A mismatch is refused, never guessed at. */
export const RELEVANCE_PROTOCOL_VERSION = 1;

/**
 * The one question this endpoint answers.
 *
 * There is one word rather than none because a request that carries no word has no way to be wrong:
 * anything well-formed would be answered, and "this build does not know that request" would stop
 * being sayable. A closed vocabulary of one is still a closed vocabulary.
 */
export type RelevanceWord = 'status';

/**
 * The whole of the verdict, and the two words are the point.
 *
 * `relevant` says a declared designation and a reported repository string are the same characters. It
 * does not say the repository matters, that the CI state is good or bad, that anyone should act, or
 * that the human's declaration was about this repository in any sense. `unknown` says the judgement
 * completed and no such equality was established — nothing more.
 *
 * There is deliberately no `unrelated`. Saying two things are unrelated is a claim about the world;
 * this layer only ever has two strings and a comparison, and "these are not the same characters" is
 * not the same sentence as "these have nothing to do with each other".
 */
export type RepositoryCiRelevanceVerdict = 'relevant' | 'unknown';

/**
 * The judgement, with the equality that produced it when there was one.
 *
 * `relevant` carries the designation that matched, and the union is what makes it impossible to
 * report `relevant` without one. There is at most one: the set a human declared holds no duplicates,
 * so at most one member can equal a single string.
 */
export type RepositoryCiRelevanceJudgement =
  | { readonly verdict: 'relevant'; readonly designation: string }
  | { readonly verdict: 'unknown' };

/** A request carries its word and nothing else. There is no payload and no field reserved for one. */
export type RelevanceRequest = { readonly word: RelevanceWord };

/**
 * The answer, in the two shapes the endpoint can give.
 *
 * `failed` is not a verdict. It is the endpoint saying the judgement could not be completed — a
 * dependency that rejected, an acquisition that threw. Keeping it a separate outcome rather than
 * folding it into `unknown` is the whole reason the two shapes exist: a human who is told `unknown`
 * is entitled to believe a judgement happened.
 */
export type RelevanceReply =
  | {
      readonly outcome: 'ok';
      readonly verdict: RepositoryCiRelevanceVerdict;
      readonly lines: readonly string[];
    }
  | { readonly outcome: 'failed'; readonly lines: readonly string[] };

/**
 * The answer to a query, in the four shapes the client has to tell apart.
 *
 * `unconfigured` and `absent` are different facts and the difference is the point. `absent` is "no
 * resident is serving this data directory". `unconfigured` is "a resident is running and this
 * composition does not have the Repository CI capability" — which is not a judgement that came out
 * `unknown`, it is a judgement that does not exist here at all, and reporting the one as the other
 * would tell a human their declaration was compared when nothing compared it.
 */
export type RelevanceOutcome =
  | { readonly kind: 'answered'; readonly reply: RelevanceReply }
  | { readonly kind: 'unconfigured' }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unavailable'; readonly detail: string };

// Bounds on the decoded text, not on wire bytes. Both sides are ours and the vocabulary is one word
// about forty characters long, so these are generous by three orders of magnitude. They exist so that
// neither side can be made to buffer without limit by whoever is on the other end of the pipe.
export const MAX_RELEVANCE_REQUEST_LINE = 1024;
export const MAX_RELEVANCE_REPLY_LINE = 64 * 1024;
