// The durable fact family of Repository CI attention, and the reader this owner uses on itself.
//
// Only the semantic owner of a concern admits a fact about it, and only the proposition that owner is
// entitled to assert. This module is that owner, and it admits exactly one proposition:
//
//     on this date, Hikari successfully delivered an announcement about this CI failure.
//
// Three things that proposition is not, each of which the code below has to keep out:
//
//   · It is not "a human was told". `human-delivery` reports `delivered` when the bytes were written,
//     which is the smallest claim that can be made honestly, and this family inherits exactly that
//     strength and no more.
//   · It is not "Hikari noticed this failure". Noticing is what `handledFailures` records, inside one
//     activation, whatever the transport said. That set and this one answer different questions and
//     both still exist.
//   · It is not a snapshot of attention state. A baseline — "the last thing I looked at" — is a value
//     that gets overwritten on every poll, and Chronicle has no update, delete or supersession, so
//     such a value cannot be expressed in it. The Repository CI Attention review rejected storing one
//     for exactly that reason. A delivered-announcement fact never needs revising, which is why it is
//     the shape that fits and the baseline is the shape that does not.
//
// What is deliberately absent is anything a fact might be *judged* by — no importance, no salience,
// no confidence, no relation to another fact, no reading of whether the failure mattered. Chronicle
// stores what happened. It does not explain what it means.

import type { DurableFact, FactDraft } from '../chronicle/types.js';
import type { RepositoryCiAttentionOccurrence } from './types.js';

/** The only version this family speaks. A reader that meets another one must not guess at it. */
const DELIVERED_FACT_VERSION = 1;

/**
 * The type, and it carries the whole of the claim.
 *
 * That a fact of this type exists *is* the assertion that the delivery succeeded, because the only
 * code that writes one is the branch where `deliver` answered `delivered`. There is deliberately no
 * `delivered: true` in the payload: a field that can only ever hold one value is a field that says
 * nothing, and `work-focus/facts.ts` already made this call for the same reason.
 */
const DELIVERED_FACT_TYPE = 'repository-ci-attention.delivered';

/**
 * What is provable about where this fact came from.
 *
 * Not `human` — the ingress has no authentication, and `durable-fact-admission-v0.md` forbids that
 * kind outright. Not `github` either: GitHub never told anyone an announcement was delivered, and a
 * source naming it would be attributing this plugin's own act to a party that did not perform it.
 * What is provable is that the delivery reached the transport and came back `delivered`, and that is
 * what this says.
 */
const DELIVERY_SOURCE_KIND = 'repository-ci-attention.delivery';

/**
 * What "the same failure" means, and there is exactly one answer in this module.
 *
 * Both the activation-local handled set and the restored delivered set are keyed by this, and that
 * they share a key is the point: "have I already handled this" and "have I already delivered this"
 * are different questions about the same subject, and two identity rules would let them disagree
 * about which subject they are talking about.
 *
 * It is a composite because a run id is unique within a repository, not across them. GitHub numbers
 * runs per repository, so `t1mb2rg/hikari-new` run 41 and `t1mb2rg/other` run 41 are two unrelated
 * failures — and the Chronicle this history is read out of belongs to *Hikari*, not to any one
 * repository, so histories from several repositories accumulate in the same file. Keying on the run
 * id alone would silently drop one of them.
 *
 * The separator is `#`, which cannot occur in a repository name: GitHub allows `[A-Za-z0-9._-]` in
 * each of the `owner/name` halves. So the repository contains no `#`, the first one is the only one,
 * and the encoding is injective — no pair can collide with another. The assumption is stated here
 * rather than assumed quietly, because this function is exported and a test pins the pair that would
 * expose it.
 */
export function failureKey(repository: string, runId: number): string {
  return `${repository}#${runId}`;
}

/**
 * The draft a successful delivery admits.
 *
 * `occurredAt` is read from the clock here, at the moment the delivery has been confirmed, rather
 * than taken from `occurrence.observedAt`. The two are different events — the observation is when CI
 * was looked at, this is when the announcement got out — and the proposition above is about the
 * second. `work-focus/facts.ts` reads its clock the same way and for the same reason.
 *
 * The payload is identity and nothing else. The workflow, branch, sha and conclusion are all in the
 * occurrence, and copying them here would make this fact a second record of the failure rather than a
 * record of the delivery — two copies of the same fields, drifting the first time either changes.
 * A reader of this family asks one question, "has this failure been delivered", and the key answers it.
 */
export function deliveryFactDraft(occurrence: RepositoryCiAttentionOccurrence): FactDraft {
  return {
    type: DELIVERED_FACT_TYPE,
    version: DELIVERED_FACT_VERSION,
    occurredAt: new Date().toISOString(),
    source: { kind: DELIVERY_SOURCE_KIND },
    payload: { repository: occurrence.repository, runId: occurrence.runId },
  };
}

/**
 * The failures this owner has already delivered an announcement about, read out of its own history.
 *
 * Everything this function does not recognise, it skips — and that is the whole of its failure
 * policy, so it is worth saying why each skip is there rather than being defensive noise:
 *
 *   a fact of another type      the store is shared. `work-focus` writes to the same file, and a
 *                               reader that threw on a sibling's fact would break the moment another
 *                               owner admitted anything.
 *   a version that is not 1     `fact.ts` checks that a version is a positive integer and does not
 *                               reject an unknown one, so refusing to guess at a shape this code has
 *                               never seen is the reader's job. A future version 2 is not this shape.
 *   a payload that is not the   the store is a file, and a file can be edited. A payload that is not
 *   object this family writes   `{ repository: string, runId: integer }` is not evidence of a
 *                               delivery, and reading a run id out of it would be inventing one.
 *
 * Nothing here throws, and nothing here guesses. The caller gets the set of keys it can stand behind,
 * which may be empty; it does not get an error and it does not get a claim it cannot support. The
 * caller is the one that decides what an empty set means, and the one answer it must not take from it
 * is "nothing was ever announced" — see `plugin.ts`.
 *
 * The return is a `Set<string>` and not the facts, deliberately: the caller's whole need is membership,
 * and handing back the objects would invite a caller to start reading payloads this owner's vocabulary
 * does not cover.
 */
export function readDeliveredFailures(facts: readonly DurableFact[]): ReadonlySet<string> {
  const delivered = new Set<string>();

  for (const fact of facts) {
    if (fact.type !== DELIVERED_FACT_TYPE) continue;
    if (fact.version !== DELIVERED_FACT_VERSION) continue;

    const payload: unknown = fact.payload;
    if (typeof payload !== 'object' || payload === null) continue;

    // An array reaches here as an object whose named fields are absent, so it falls out on the two
    // checks below rather than needing a third one. What matters is that no shape is *assumed* to be
    // this family's on the strength of its type alone.
    const fields = payload as { readonly repository?: unknown; readonly runId?: unknown };
    const { repository, runId } = fields;

    if (typeof repository !== 'string') continue;
    if (typeof runId !== 'number' || !Number.isSafeInteger(runId)) continue;

    delivered.add(failureKey(repository, runId));
  }

  return delivered;
}
