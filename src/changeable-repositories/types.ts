/** The only version this build speaks. A mismatch is refused, never guessed at. */
export const CHANGEABLE_REPOSITORIES_PROTOCOL_VERSION = 1;

/**
 * The four words, and they are the same four `hikari focus` uses, with the same meanings.
 *
 * `declare` is a union, `replace` is a replacement, `clear` empties, `status` asks. Reusing the
 * sibling plugin's vocabulary is deliberate: a human who has learned one of these has learned both,
 * and a second set of words for the same three acts would be a second thing to keep in step.
 */
export type ChangeableRepositoriesWord = 'declare' | 'replace' | 'clear' | 'status';

/**
 * A request carries the directories themselves.
 *
 * `declare` and `replace` take the *same* shape — a list — and differ only in whether the set that
 * was already there survives. `hikari focus` gives those two words different shapes because a work
 * focus is one piece of text; here the member is a directory and more than one arriving at once is
 * the ordinary case, so the asymmetry would be a distinction without a difference.
 */
export type ChangeableRepositoriesRequest =
  | { readonly word: 'declare'; readonly repositories: readonly string[] }
  | { readonly word: 'replace'; readonly repositories: readonly string[] }
  | { readonly word: 'clear' }
  | { readonly word: 'status' };

/**
 * Two words, not four.
 *
 * An earlier version of this module's boundary freeze named four — `changed`, `unchanged`,
 * `refused`, `failed` — and three of them were inert: nothing the human reads or does changes with
 * them. Whether the set moved is what `lines` already shows (the answer to every write is the set it
 * left behind), and "refused" and "failed" differ only in whether Hikari declined or could not, which
 * is a distinction the reason line already carries. A word nothing branches on is a taxonomy with
 * members nothing reads, so this speaks the two words its sibling speaks.
 */
export interface ChangeableRepositoriesReply {
  readonly outcome: 'ok' | 'failed';
  readonly lines: readonly string[];
}

/**
 * The answer to a request, in the same three shapes the control channel and the sibling plugin use.
 *
 * This is the client's vocabulary rather than the wire's: `answered` is a reply that arrived and was
 * readable, `absent` is nothing listening, and `unavailable` is everything else. The three are kept
 * apart because the human is told something different by each, and because folding the last two into
 * "nothing there" would tell them there is nothing to find while something is there but broken.
 */
export type ChangeableRepositoriesOutcome =
  | {
      readonly kind: 'answered';
      readonly outcome: 'ok' | 'failed';
      readonly lines: readonly string[];
    }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unavailable'; readonly detail: string };

// The bounds, for the same reason `hikari focus` has them and at the same sizes: what a human may
// name is not this module's business to shorten, but whoever is on the other end of the pipe does not
// get to choose how much this process buffers. A reply echoes the whole set back, so it is at least
// as large as the request that produced it, and the slack says "at least as large" rather than
// pretending to know the envelope to the byte.
export const MAX_CHANGEABLE_REPOSITORIES_REQUEST_LINE = 64 * 1024;
export const MAX_CHANGEABLE_REPOSITORIES_REPLY_LINE = MAX_CHANGEABLE_REPOSITORIES_REQUEST_LINE + 4096;
