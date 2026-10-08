// The conversational continuity this plugin is allowed to have: one durable fact family, the bounded
// read that gets it back, and the act that writes one down.
//
// ## What is stored, and what the storing is not
//
// This family admits exactly one proposition:
//
//     on this date, a person explicitly confirmed this statement through Hikari's own language ingress.
//
// Three things that proposition is not, each of which the code below has to keep out:
//
//   · It is not "a human said this". The ingress has no authentication: anything on this host that can
//     open the pipe can send a `confirm`. What this plugin can prove is that the confirmation arrived
//     through its own endpoint, and that is what `source.kind` says — the same narrower claim
//     `work-focus/facts.ts` makes for its own ingress, and for the same reason. `human` is not written
//     here, and the fact that `FactSource.kind` is a free string is exactly why it must not be: the type
//     would not stop it and the runtime would not either. (`durable-fact-admission-v0.md` item J.)
//   · It is not "Hikari believes this". Nothing here is checked against anything. The statement is not
//     compared with a reading, not reconciled with another statement, and not marked true or false. It
//     is the person's sentence, kept because they said to keep it.
//   · It is not a permission. Nothing in this repository reads this family to decide whether something
//     may happen — no gate, no authorization, no work focus restored, no source turned on. The only
//     consumer of a decision in this build is the prompt builder, and a prompt is not an authority.
//
// ## Why Chronicle, and why this is not the command audit it resembles
//
// A durable fact records a semantic state transition, not the arrival of a command at an endpoint
// (`durable-fact-admission-v0.md`). The transition here is the confirmation itself: before it, this
// statement is not something Hikari keeps; after it, it is. That is the same shape as the work focus's
// `declare`, and the same rule applies to both — the word that only asks produces no fact at all. `ask`
// never writes, so a conversation that was never confirmed leaves this family empty, and "not confirmed"
// is therefore not a state that has to be represented: it is the absence of the record.
//
// The payload carries the proposition and nothing else. There is no field saying a command arrived, no
// caller, no argument echo, no `confirmed: true` — a field that can only hold one value says nothing,
// and the existence of a fact of this type *is* the assertion. For the same reason there is no
// confidence, importance, salience or relation here: the trust level is carried by the type name and by
// the source kind, which is a noun rather than a score. `readConfirmedDecisions` is what turns that back
// into material, and it is deliberately the only reader.

import type { DurableFact, FactDraft } from '../chronicle/types.js';
import {
  confirmFailureLines,
  describe,
  emptyStatementLines,
  longStatementLines,
  recordedLines,
} from './express.js';
import type { LanguageReply } from './types.js';
import { MAX_LANGUAGE_TEXT_LENGTH } from './types.js';

// The type, and it carries the whole of the claim.
//
// Named for the *act* rather than for the content, because the act is what this owner is entitled to
// assert. `language.decision` would claim a decision exists; `language.decision-confirmed` says the one
// thing that was observed, which is that somebody confirmed it.
//
// Not exported, and neither is the source kind below. `work-focus/facts.ts` and
// `repository-ci-attention/facts.ts` keep theirs private for the same reason, and the reason is not
// tidiness: these two strings are the record's identity in a store that outlives this process, and a
// test that asserted them by importing them would follow them wherever they were changed to. Written
// out as a literal in the test, the string is a contract value with one statement of it in `src` and
// one in the check that it still says what it said.
const LANGUAGE_CONTINUITY_FACT_TYPE = 'language.decision-confirmed';

/** The only version this family speaks. A reader that meets another one must not guess at it. */
const LANGUAGE_CONTINUITY_FACT_VERSION = 1;

// What is provable about where this fact came from, and it is less than "a human".
//
// The same claim `work-focus.endpoint` makes, arriving through a second ingress that has the same
// absence of authentication. A fact claiming `human` would assert an identity nothing here established,
// and it would do it about the one surface where being wrong matters most: the whole point of keeping
// this material apart from the session's own words is that Hikari never confuses "somebody typed this"
// with "this person, verified, said this".
const LANGUAGE_CONTINUITY_SOURCE_KIND = 'language.endpoint';

/**
 * One statement a person confirmed, as this plugin reads its own history back.
 *
 * `at` is the fact's own `occurredAt` — when the confirmation happened — and it travels with the
 * statement rather than being looked up later, so that a reader never has to ask a second question
 * about a record it is already holding.
 */
export interface ConfirmedDecision {
  readonly statement: string;
  readonly at: string;
}

/**
 * The draft a confirmation admits.
 *
 * `occurredAt` is read from the clock by the caller at the moment the confirmation happened and passed
 * in, rather than read here: this function is a pure statement of shape, and `work-focus/facts.ts` reads
 * its clock the same way for the same reason — one reading, at the moment being recorded, so it cannot
 * disagree with itself.
 */
export function decisionFactDraft(statement: string, occurredAt: string): FactDraft {
  return {
    type: LANGUAGE_CONTINUITY_FACT_TYPE,
    version: LANGUAGE_CONTINUITY_FACT_VERSION,
    occurredAt,
    source: { kind: LANGUAGE_CONTINUITY_SOURCE_KIND },
    payload: { statement },
  };
}

/**
 * The statements this owner has kept, read out of its own history, oldest first.
 *
 * Everything this function does not recognise, it skips — the failure policy
 * `repository-ci-attention/facts.ts` established, applied to a second family for the same reasons:
 *
 *   a fact of another type      the store is shared, and a reader that threw on a sibling's fact would
 *                               break the moment another owner admitted anything.
 *   a version that is not 1     `fact.ts` validates that a version is a positive integer and does not
 *                               reject an unknown one, so refusing to guess at a shape this code has
 *                               never seen is the reader's job.
 *   a payload that is not the   the store is a file, and a file can be edited. A payload without a
 *   object this family writes   `statement` string is not evidence of a confirmation, and inventing a
 *                               statement out of it would be the worst possible failure here: this
 *                               material ends up in a prompt.
 *
 * Nothing here throws and nothing here guesses. The caller gets the records it can stand behind, which
 * may be empty; it does not get an error and it does not get a claim it cannot support. The caller is
 * the one that decides what an empty list means, and the one answer it must not take from it is
 * "nothing was ever confirmed" — see `plugin.ts`, where a failed read and an empty history are the same
 * value and are both handled by saying nothing rather than by asserting anything.
 *
 * Oldest first, which is the order the store holds them in: Chronicle has no sequence number and no
 * hash chain, so position in the file *is* the order of occurrence. Selecting from the other end is
 * `selectConfirmedDecisions`'s job, and it is a rule about a prompt budget rather than about history.
 */
export function readConfirmedDecisions(facts: readonly DurableFact[]): readonly ConfirmedDecision[] {
  const decisions: ConfirmedDecision[] = [];

  for (const fact of facts) {
    if (fact.type !== LANGUAGE_CONTINUITY_FACT_TYPE) continue;
    if (fact.version !== LANGUAGE_CONTINUITY_FACT_VERSION) continue;

    const payload: unknown = fact.payload;
    if (typeof payload !== 'object' || payload === null) continue;

    const fields = payload as { readonly statement?: unknown };
    if (typeof fields.statement !== 'string') continue;

    decisions.push({ statement: fields.statement, at: fact.occurredAt });
  }

  return decisions;
}

/**
 * As many of the most recent records as fit in a budget of characters, plus how many were left out.
 *
 * The rule is a contiguous tail and nothing else. There is no ranking, no filtering by subject, no
 * relevance to the question being asked and no scoring of any kind — those would each be this plugin
 * deciding which of a person's own statements matters, which is a judgement nothing here is entitled to
 * make and which the model is the only thing in the loop already positioned to make. Position in the
 * store is not a judgement either: it is the order things happened in, which is a fact about the store
 * rather than a verdict about the statements.
 *
 * Contiguity is what keeps the rule statable: the function walks back from the newest and stops at the
 * first record that does not fit. A shorter record older than a longer one that did not fit is not
 * reached — reordering to fit more of them would be this function arranging a person's history, and the
 * count it returns is what makes the omission visible instead.
 *
 * `dropped` is returned rather than computed by the caller, because "we left some out" is a fact about
 * this decision and the caller has no way to recover it once the slice is taken.
 */
export interface SelectedDecisions {
  readonly decisions: readonly ConfirmedDecision[];
  /** How many older records were left out. Zero means this is the whole history. */
  readonly dropped: number;
}

export function selectConfirmedDecisions(
  decisions: readonly ConfirmedDecision[],
  budget: number,
): SelectedDecisions {
  let used = 0;
  let first = decisions.length;

  for (let index = decisions.length - 1; index >= 0; index -= 1) {
    const decision = decisions[index];
    if (decision === undefined) continue;

    const next = used + decision.statement.length;
    if (next > budget) break;

    used = next;
    first = index;
  }

  return { decisions: decisions.slice(first), dropped: first };
}

/**
 * The confirmation as this activation holds it: what is already known, and the one act that adds to it.
 *
 * The list is the activation's, seeded from one read at `setup` and never re-read. A second read would
 * be a way for the file to change under a running plugin — an edited store would silently become new
 * material mid-conversation — and the only writer of this family is this same activation, so there is
 * nothing a re-read could tell it that it does not already have.
 *
 * `confirm` writes before it records, and that order is the whole of its failure semantics. The append
 * *is* the act: if it rejects, nothing happened, and the caller must not be told otherwise. That is the
 * opposite of `work-focus/session.ts`, where the state change is real and independent of the write, so
 * a failed append there can be reported as a successful change with an unconfirmed record. There is no
 * such split here, and copying that outcome word would produce a line saying the statement was kept
 * when it was not.
 */
export interface DecisionContinuity {
  /** Everything known now, oldest first. A live view of this activation's own list. */
  current(): readonly ConfirmedDecision[];
  /** Keep one statement. Rejects when nothing was kept. */
  confirm(statement: string): Promise<ConfirmedDecision>;
}

export function createDecisionContinuity(dependencies: {
  readonly append: (draft: FactDraft) => Promise<DurableFact>;
  readonly now: () => string;
  readonly initial: readonly ConfirmedDecision[];
}): DecisionContinuity {
  const decisions: ConfirmedDecision[] = [...dependencies.initial];

  return {
    current: () => decisions,
    async confirm(statement: string): Promise<ConfirmedDecision> {
      const at = dependencies.now();
      await dependencies.append(decisionFactDraft(statement, at));

      // Pushed only after the append resolved. The order is the whole of the guarantee: a statement
      // that failed to be written is not in this list, so the rest of this activation cannot answer
      // from a record that does not exist.
      const decided: ConfirmedDecision = { statement, at };
      decisions.push(decided);
      return decided;
    },
  };
}

/**
 * The `confirm` word: a person telling Hikari to keep something they said.
 *
 * The two bounds are the `ask` path's two bounds, checked in the same order and for the same reasons —
 * `answer.ts` states them at length. They are checked here as well rather than shared, because the
 * refusal a person gets has to name the act they performed: `longQuestionLines` says the sentence is
 * not a question, which would be a statement about a `confirm` that was never made.
 *
 * The length is the *decoded* text's, and it is checked before anything is written, so an oversize
 * statement leaves no trace. The emptiness test trims and the stored statement does not: what is kept
 * is the text byte for byte as it arrived, which is what "this is what they said" has to mean.
 */
export async function confirmDecision(
  continuity: DecisionContinuity,
  text: string,
): Promise<LanguageReply> {
  if (text.trim() === '') return { outcome: 'refused', lines: emptyStatementLines() };
  if (text.length > MAX_LANGUAGE_TEXT_LENGTH) {
    return { outcome: 'refused', lines: longStatementLines(MAX_LANGUAGE_TEXT_LENGTH) };
  }

  try {
    await continuity.confirm(text);
  } catch (error) {
    // `failed` and not a refusal, and not the work focus's `ok`-with-a-caveat either. The write was the
    // request, so a write that did not happen is this build not reaching a verdict — the same word the
    // loop uses when a contract it depends on rejects on the way. Nothing is claimed to have been kept.
    return { outcome: 'failed', lines: confirmFailureLines(describe(error)) };
  }

  return { outcome: 'recorded', lines: recordedLines() };
}
