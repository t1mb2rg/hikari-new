// The durable fact family of the executor, and the two propositions it is entitled to assert.
//
// This module owns one concern and records two things about it, both of which are statements about
// *this build* rather than about the world:
//
//     on this date, a human asked for this repository to be changed, in these words.
//     on this date, a run ended with this outcome and this evidence.
//
// §5.1 of the boundary review names the six fields the family must carry — the mandate unwritten-to,
// the repository, the executor's identity, the three-state outcome, the evidence, and `occurredAt` —
// and it names one thing the family must not carry: Hikari's interpretation of the result. That is not
// an omission to be filled in later; meaning is what Awareness is for, and a fact that explained itself
// would be a judgement wearing a record's clothes.
//
// Why the mandate is written *before* the run: a run that dies still has to leave behind what was asked
// for. A record that only existed when a run completed would lose exactly the cases where the question
// "what were you told to do" matters most. The two facts are therefore written at two moments and are
// not one fact with an optional half.
//
// Neither payload contains a field that can only ever hold one value. `work-focus/facts.ts` and
// `repository-ci-attention/facts.ts` both made that call and for the same reason: a constant in a
// payload says nothing, and a reader cannot tell it apart from a field that was meant to vary.

import type { FactDraft } from '../chronicle/types.js';

import type { RepositoryChangeEvidence, RepositoryChangeHalt, RepositoryChangeOutcome } from './types.js';

/** The only versions this family speaks. A reader meeting another one must not guess at its shape. */
const MANDATE_FACT_VERSION = 1;
const RESULT_FACT_VERSION = 1;

/**
 * That a mandate fact exists *is* the assertion that a human asked for this.
 *
 * The type is not `…requested` or `…intended`: what is provable is that a word arrived carrying this
 * sentence, and the sentence is the mandate (§2 of the review). Naming the fact after the thing that
 * arrived keeps the claim at the strength of the evidence for it.
 */
const MANDATE_FACT_TYPE = 'repository-change-executor.mandate';
const RESULT_FACT_TYPE = 'repository-change-executor.result';

/**
 * What is provable about where each fact came from.
 *
 * Not `human`: the ingress has no authentication, and `durable-fact-admission-v0.md` forbids that kind
 * outright. What is provable is that a word arrived on this owner's own endpoint, which is what the
 * mandate's source says, and that this owner's executor returned, which is what the result's says. The
 * second is deliberately *not* phrased as a statement about the repository — the repository's own story
 * is in the evidence, told by git.
 */
const MANDATE_SOURCE_KIND = 'repository-change-executor.mandate-ingress';
const RESULT_SOURCE_KIND = 'repository-change-executor.run';

/**
 * The executor's identity, as it is written into the record.
 *
 * A name and a version rather than a model name: what the record can stand behind is *which
 * implementation* ran, and the model that implementation used is configuration rather than identity.
 * §5.1 asks for an executor identifier and this is the smallest one that is true for every run.
 */
export const EXECUTOR_IDENTITY = 'repository-change-executor@1';

export interface MandateFactInput {
  readonly repository: string;
  readonly mandate: string;
}

/**
 * The draft written before anything can happen.
 *
 * The mandate is copied verbatim, and `verbatim` is the operative word: no trimming here, because the
 * trimming already happened at the request boundary where it was decided what the mandate is. A second
 * trim would be a second definition of the same sentence.
 */
export function mandateFactDraft(input: MandateFactInput): FactDraft {
  return {
    type: MANDATE_FACT_TYPE,
    version: MANDATE_FACT_VERSION,
    occurredAt: new Date().toISOString(),
    source: { kind: MANDATE_SOURCE_KIND },
    payload: {
      repository: input.repository,
      mandate: input.mandate,
      executor: EXECUTOR_IDENTITY,
    },
  };
}

export interface ResultFactInput {
  readonly repository: string;
  readonly outcome: RepositoryChangeOutcome;
  readonly halt: RepositoryChangeHalt | undefined;
  readonly evidence: RepositoryChangeEvidence;
}

/**
 * The draft written when a run has ended, whatever it ended as.
 *
 * `halt` is written only when there is one, and the absent field is the assertion that there was not —
 * the same shape the read half's `RepositoryRead` uses for its own absences. The evidence is copied
 * field by field rather than spread, so that a field added to the evidence type shows up here as a
 * compile error instead of silently entering the record.
 */
export function resultFactDraft(input: ResultFactInput): FactDraft {
  const { evidence } = input;

  return {
    type: RESULT_FACT_TYPE,
    version: RESULT_FACT_VERSION,
    occurredAt: new Date().toISOString(),
    source: { kind: RESULT_SOURCE_KIND },
    payload: {
      repository: input.repository,
      executor: EXECUTOR_IDENTITY,
      outcome: input.outcome,
      ...(input.halt === undefined ? {} : { halt: input.halt }),
      headBefore: evidence.headBefore ?? null,
      headAfter: evidence.headAfter ?? null,
      dirtyBefore: evidence.dirtyBefore ?? null,
      dirtyAfter: evidence.dirtyAfter ?? null,
      // `null` and not `false` when the comparison could not be made: the field says the question was not
      // answered, rather than answering it in the direction that hides a push that cannot be taken back.
      pushed: evidence.pushed ?? null,
      ciRunId: evidence.ciRunId ?? null,
      ciChecked: evidence.ciChecked,
    },
  };
}

/** The two type names, exported so a test can pin them and a reader can find them. */
export const REPOSITORY_CHANGE_FACT_TYPES: Readonly<Record<'mandate' | 'result', string>> = Object.freeze({
  mandate: MANDATE_FACT_TYPE,
  result: RESULT_FACT_TYPE,
});
