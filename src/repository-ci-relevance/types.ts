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
 * `relevant` says one of the human's own declarations names the repository the observation is about.
 * There are exactly two ways it can be established, and `RepositoryCiRelevanceMatch` says which one
 * happened. It does not say the repository matters, that the CI state is good or bad, that anyone
 * should act, or that the human's declaration was about this repository in any further sense.
 * `unknown` says the judgement completed and neither way established that — nothing more.
 *
 * There is deliberately no `unrelated`. Saying two things are unrelated is a claim about the world;
 * this layer only ever has strings and comparisons, and "these are not the same characters" is not
 * the same sentence as "these have nothing to do with each other".
 */
export type RepositoryCiRelevanceVerdict = 'relevant' | 'unknown';

/**
 * A pairing the human wrote down: one local root and one GitHub `owner/name`, given together.
 *
 * It is what `--repository-root` and `--repository` are, and it appears here as a shape because the
 * judgement quotes it rather than deriving anything from it. The two strings are never compared with
 * each other in this package — what gets compared is a designation against `localRoot` and an
 * observed repository against `githubRepository`, each character for character.
 */
export type DeclaredRepositoryPairing = {
  readonly localRoot: string;
  readonly githubRepository: string;
};

/**
 * Which rule produced a `relevant`, carried with it.
 *
 * Naming the rule in the type is what makes it impossible to report `relevant` without saying how it
 * was reached — the same argument that puts `designation` in the union rather than beside it.
 *
 * `verbatim` is the two strings being equal. `declaration` is them *not* being equal: a designation
 * that equals the local root of a pairing the human wrote, and an observation that equals the GitHub
 * name from that same pairing. The bridge between the two spellings is the human's own sentence, and
 * this arm carries both halves of it so that nothing downstream has to reconstruct which was quoted.
 */
export type RepositoryCiRelevanceMatch =
  | { readonly kind: 'verbatim' }
  | {
      readonly kind: 'declaration';
      readonly localRoot: string;
      readonly githubRepository: string;
    };

/**
 * The judgement, with the equality that produced it when there was one.
 *
 * `relevant` carries the designation that matched and the rule that matched it; the union is what
 * makes it impossible to report `relevant` without either. There is at most one designation: the set
 * a human declared holds no duplicates, so at most one member can equal a single string.
 */
export type RepositoryCiRelevanceJudgement =
  | {
      readonly verdict: 'relevant';
      readonly designation: string;
      readonly via: RepositoryCiRelevanceMatch;
    }
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
