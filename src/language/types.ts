// The wire vocabulary of the language endpoint, owned by the module whose semantics it carries.
//
// `ask` is the first word in this repository that carries text a human composed. It is still a word,
// and it is still the whole of what a request says: the request is `{ word, text }` and there is no
// third field, no field reserved for one, and no shape in which a request without a word would be
// legal. A request that carries no word has no way to be wrong — anything well-formed would be
// answered, and "this build does not know that request" would stop being sayable — which is the same
// argument `desktop-session-observe/types.ts` and `work-focus/types.ts` make for their own words.
//
// The reply has three outcomes, and the whole point of this slice is that they stay three.
//
//   answered   this build understood the question, read the facts it is grounded in, and answered.
//   refused    this build understood the *request* and will not answer *that*: the question is empty,
//              it is longer than any question needs to be, or the model did not place it in one of the
//              closed topics this build knows how to answer.
//   failed     this build itself did not get to a verdict — the model could not be reached, or a
//              contract the answer is grounded in rejected on the way.
//
// `refused` and `failed` are not two spellings of "no". A refusal is Hikari saying it does not answer
// this; a failure is Hikari saying it did not finish. Folding them together would tell a human their
// question was out of scope when in fact the model was down, and the repair for the two is different:
// one is "ask something else", the other is "come back".

/** The only version this build speaks. A mismatch is refused, never guessed at. */
export const LANGUAGE_PROTOCOL_VERSION = 1;

/**
 * The one word this endpoint answers.
 *
 * It carries a payload, which is the structural difference from the other endpoints' words: what a
 * human asks cannot be enumerated in advance, so it travels with the word. That is also why this is a
 * word rather than a payload with no vocabulary around it — the envelope stays closed even though the
 * content cannot be.
 */
export type LanguageWord = 'ask';

/**
 * A request carries its word and the sentence a human typed, and nothing else.
 *
 * The field is typed by `LanguageWord` rather than by the literal, for the reason
 * `desktop-session-observe/types.ts` gives: the two spellings of the one word are the same word, and a
 * build that grew a second one should have to change the union in one place rather than find a literal
 * written out beside it.
 */
export interface LanguageRequest {
  readonly word: LanguageWord;
  readonly text: string;
}

/**
 * The answer, in the three shapes the plugin can give, named as the mandate names them.
 *
 * All three are lines and there is deliberately no machine-readable verdict beside them, for the
 * reason the observe endpoint gives: any field rich enough to carry what was asked and what was read
 * would be a second encoding of facts that already have owners. What a client has to tell apart is
 * which of the three happened, and `outcome` says exactly that.
 */
export type LanguageReply =
  | { readonly outcome: 'answered'; readonly lines: readonly string[] }
  | { readonly outcome: 'refused'; readonly lines: readonly string[] }
  | { readonly outcome: 'failed'; readonly lines: readonly string[] };

/**
 * The answer to a question, in the three shapes the *client* has to tell apart.
 *
 * `replied` rather than the observe client's `answered`, and the difference is not cosmetic: the
 * observe reply has two outcomes and its `answered` can only ever mean one of them, so calling the
 * envelope and the reply by the same word costs nothing there. Here the reply has an outcome literally
 * named `answered`, and an envelope field of the same name would make `answer.kind === 'answered'`
 * and `answer.reply.outcome === 'answered'` two different claims wearing one word. This one is about
 * the *endpoint* — it served the request — and the reply's own outcome says what Hikari said.
 *
 * There is no fourth `unconfigured`, and its absence is the same statement `desktop-session-observe`
 * makes: whether a resident has Language is not something this client can probe, and reaching for the
 * Resident's control vocabulary to explain a domain plugin's absence would be the first step toward
 * asking it domain questions. The resident prints its model configuration in `status` instead, which
 * is where an operator who did not configure one will look.
 */
export type LanguageOutcome =
  | { readonly kind: 'replied'; readonly reply: LanguageReply }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unavailable'; readonly detail: string };

/**
 * The longest question this plugin will answer, in characters of decoded text.
 *
 * A question is a sentence. This bound is roughly a thousand sentences, so it is not a limit on what a
 * human may ask — it is the point past which the thing arriving is not a question, and the honest
 * answer is a refusal rather than a model call. It is enforced by the owner and not only by the client,
 * because the client is not the only thing that can speak this protocol; a CLI that also checked it
 * would be a second copy of a rule whose owner already states it.
 */
export const MAX_LANGUAGE_TEXT_LENGTH = 8 * 1024;

// The framing bounds, on decoded text rather than wire bytes.
//
// The request line is generous over `MAX_LANGUAGE_TEXT_LENGTH` because the text on the wire is JSON
// and a character may escape to six bytes; the reply line is that plus slack, for the reason
// `work-focus/types.ts` gives. Neither is a statement about what the plugin will answer — the text
// bound above is that — they are what keeps whoever is on the other end of the pipe from choosing how
// much this process buffers.
export const MAX_LANGUAGE_REQUEST_LINE = 64 * 1024;
export const MAX_LANGUAGE_REPLY_LINE = MAX_LANGUAGE_REQUEST_LINE + 4096;
