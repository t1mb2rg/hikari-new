// The wire vocabulary of the language endpoint, owned by the module whose semantics it carries.
//
// `ask` is the first word in this repository that carries text a human composed. It is still a word,
// and it is still the whole of what a request says: the request is `{ word, text }` and there is no
// third field, no field reserved for one, and no shape in which a request without a word would be
// legal. A request that carries no word has no way to be wrong — anything well-formed would be
// answered, and "this build does not know that request" would stop being sayable — which is the same
// argument `desktop-session-observe/types.ts` and `work-focus/types.ts` make for their own words.
//
// The reply has five outcomes, and each of the last three arrived separately because it was a different
// thing wearing the same spelling.
//
//   chatted    nothing was read. The model talked to the human and that conversation is the answer.
//   answered   at least one capability was read, and the answer is what was read.
//   recorded   a statement the human explicitly confirmed was written down. Nothing was read and no
//              model was asked anything; the act *was* the writing.
//   refused    this build understood the *request* and will not answer *that*: the question is empty,
//              it is longer than any question needs to be, or the model produced nothing this build
//              could act on — no reading it could perform, no usable reply.
//   failed     this build itself did not get to a verdict — the model could not be reached, or a
//              contract the answer is grounded in rejected on the way.
//
// `chatted` is not folded into `answered`, and the reason is the whole reason it exists. An answer that
// quotes Hikari's own observations and an answer that is the model making conversation are different
// kinds of thing, and only one of them is entitled to be believed about the machine. A `answered` reply
// is a reading; a `chatted` one is a sentence, and a client that had to guess which it was holding would
// be guessing about exactly the distinction this surface exists to keep. The separation is enforced
// upstream rather than here: the loop only produces `chatted` when it read nothing at all, so the
// outcome cannot be chosen independently of what happened.
//
// `recorded` is not folded into either of those, and for a sharper reason than tidiness: it is the one
// outcome under which this plugin *wrote something durable*, and the other four all report that nothing
// was written. A client that read `recorded` as a variant of `answered` would be reading "Hikari looked
// something up" out of "Hikari now remembers what you told it", which is the second statement this whole
// surface exists to keep out of the first. It also has no line a model wrote and no line an owner
// rendered — both of the other success paths are made of one of those two, and this one is made of
// neither, so `recorded` is the outcome a client can least afford to guess at.
//
// `refused` and `failed` are not two spellings of "no". A refusal is Hikari saying it does not answer
// this; a failure is Hikari saying it did not finish. Folding them together would tell a human their
// question was out of scope when in fact the model was down, and the repair for the two is different:
// one is "ask something else", the other is "come back".

/** The only version this build speaks. A mismatch is refused, never guessed at. */
export const LANGUAGE_PROTOCOL_VERSION = 1;

/**
 * The two words this endpoint answers, and there are two rather than one because one of them writes.
 *
 * `ask` never writes anything. `confirm` writes one durable record, and that record is the whole of what
 * it does — which is why it could not be folded into `ask` as a flag or a mode. A single word covering
 * both would make "nothing was recorded" and "something was recorded" two readings of the same request,
 * and the property this surface has to be able to state is exactly that they are not: a person who only
 * asked has not confirmed anything, and no arrangement of flags should be able to blur that.
 *
 * Both carry a payload, which is the structural difference from the other endpoints' words: what a human
 * asks, and what a human confirms, cannot be enumerated in advance, so each travels with the word. That
 * is also why these are words rather than payloads with no vocabulary around them — the envelope stays
 * closed even though the content cannot be.
 *
 * Two words is the whole vocabulary and it is meant to stay small. Each one is a different act by the
 * person at the other end — asking Hikari something, and telling Hikari to keep something they said —
 * and a third would have to be a third act rather than a third spelling of one of these.
 */
export type LanguageWord = 'ask' | 'confirm';

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
 * The answer, in the five shapes the plugin can give, named as the mandate names them.
 *
 * All five are lines and there is deliberately no machine-readable verdict beside them, for the reason
 * the observe endpoint gives: any field rich enough to carry what was asked and what was read would be
 * a second encoding of facts that already have owners. What a client has to tell apart is which of the
 * five happened, and `outcome` says exactly that.
 *
 * Which lines belong to which outcome is the load-bearing part. A `chatted` reply's lines are model
 * prose and nothing else; an `answered` reply's lines are owner-rendered readings and contain no model
 * prose at all, not even a joining sentence. A `recorded` reply's lines are neither — they are this
 * plugin's own fixed words about what it did with what it was given, the same kind of line `refused` and
 * `failed` carry. There is no outcome under which model prose and a reading are mixed, and that is by
 * construction rather than by convention — see the one-way door in `answer.ts`.
 *
 * No outcome carries the recorded statement back. A `recorded` reply says the writing happened and says
 * nothing else; a client that wanted to show the human what was kept has the text it just sent.
 */
export type LanguageReply =
  | { readonly outcome: 'chatted'; readonly lines: readonly string[] }
  | { readonly outcome: 'answered'; readonly lines: readonly string[] }
  | { readonly outcome: 'recorded'; readonly lines: readonly string[] }
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
