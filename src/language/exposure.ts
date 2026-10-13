// What this plugin is willing to offer a model, written out, and the whole of the list.
//
// This file holds no words about any domain, and that is the point of it. Each entry is the owner's own
// export, by reference: the work focus says what reading the work focus means, the desktop session says
// what reading the desktop means, the repository CI relevance chain says what its judgement means, the
// changeable-repositories module says what reading a declared directory means, and this file says only
// *which* of them are on offer. The same shape as the wire vocabulary every plugin's barrel exports, and
// the same argument — a consumer that restated an owner's description in its own words would be a second
// thing deciding what another domain's capability covers, and the second one is the one nobody re-reads
// when the first changes. This comment therefore names no description text either: quoting one here would
// be the same drift, one commit earlier and harder to notice.
//
// Which capabilities are offered is this plugin's decision and not the owners', and `principles.md` §6
// says why: the provider owns how the thing is done and what it means, the consumer owns the question of
// what to do with it. So the split is the owner exporting `{name, description, service}` and this file
// choosing among them. Neither half is a courtesy to the other; a surface that took the owner's words
// *and* the owner's list would have moved the exposure decision into the provider, which is the same
// mistake in the other direction.
//
// The lists are written out rather than assembled, because a v0 that discovered them would need a
// registry to discover them with. There is no lookup by name here, no registration, no iteration over
// the Runtime and no way to add an entry without editing this file — a list here is a decision somebody
// made, and it reads like one.
//
// There are two of them, and the second one is the whole shape of this slice. `LANGUAGE_EXPOSURES` is
// the base variant: the reads that need nothing beyond the Services every Language composition already
// requires. `LANGUAGE_REPOSITORY_EXPOSURES` is the repository-aware variant: the same entries, plus the
// Repository CI relevance judgement, which exists only when a resident was configured with a repository
// scope. Which of the two a given resident uses is the composition's decision — see `plugin.ts` and
// `cli/resident.ts` — and which capabilities are *in* either is still this plugin's, for the §6 reason
// above: the composition chooses a variant, it does not get to edit one.
//
// They are two literals with their first two entries repeated rather than one list plus a spread, and the
// repetition is deliberate. A shared prefix would make the base list something assembled from parts and
// the variant something derived from it, and the property this file actually needs is the one a reader
// can check by looking: each list is a fixed set, written down, in the order a model is shown it. The
// derivation would save three lines and cost the only claim either list makes. This is also not a
// master table plus a filter: there is no table, no predicate and no capability that is in one list by
// virtue of anything other than being written there.
//
// The variant mechanism is the guard on this design, and it is recorded here rather than in a note
// somewhere else because this file is where the temptation would reappear. Two named variants are
// approved for exactly one reason: base Language and repository-aware Language differ by *one*
// independently optional capability, and one optional capability has two states. A second such capability
// would make four variants, a third would make eight, and `CalendarLanguage` / `MailLanguage` /
// `RepositoryCalendarLanguage` is the shape that arrives in. If a second independently optional domain
// capability ever appears, the answer is not a third literal list here — it is a Composition Boundary
// Review of whether capability reachability should be decided at composition time at all. This slice does
// not solve that, and deliberately does not prepare for it.
//
// The two repository reads are in *both* lists, and that is the whole reason they did not have to be the
// exception just described. The test that guard implies is not "is this capability new" but "is it
// independently optional" — a capability that every composition loading this plugin can reach is part of
// the prefix both variants share, and a shared prefix does not multiply anything. `authorized_repositories_list`
// and `authorized_repository_read` are reachable wherever Language is, because `changeable-repositories`
// is an unconditional member of every resident and is activated on every host where Language activates at
// all (both are gated on the same named-pipe namespace). So the count of variants is still two, and the
// count of lists in this file is still two. Recorded here because the next capability will be read against
// whatever precedent the last one left: the question to ask is the reachability one, not a headcount.
//
// The third one arrived by that same test and is recorded the same way. A search of the declared set is
// reachable wherever the reading of it is — same plugin, same Service, an unconditional member of every
// resident — so it joins the shared prefix too, and the count of variants is still two. What it does
// disturb is the paragraph below, which said one capability declares an argument: two do now, and the
// reason they can be told apart at all is a word the owner added to one of its exports rather than a name
// this file matches on. That word is in `changeable-repositories/exposure.ts`, for the reason every other
// field lives with its owner.
//
// What *has* changed is that this file can no longer say every capability is a zero-argument read. One of
// the four below declares an argument, which means `tools.ts` stopped having a single shape to build and
// this plugin gained its first capability whose call is not fully described by its name. The declaration
// lives on the owner's export (`changeable-repositories/exposure.ts`) rather than here, for the reason
// every other field lives there: this file chooses among capabilities, it does not describe them.
//
// This is now the list a model chooses from, and the way it is consumed is what keeps that from being a
// registry. `tools.ts` maps over it to build the request's `tools` array and searches it by name to
// resolve what came back, so the set a model may pick from and the set the loop will act on are the
// same array rather than two lists that agree. Nothing is added at runtime, nothing is discovered, and
// a name that is not in this file resolves to nothing.
//
// What an entry does not carry: any permission. An exposure says a capability may be *offered*, and says
// nothing about whether a particular caller may use it or whether this particular act is allowed.
// `principles.md` §5 keeps those apart — existence, exposure, authorization and execution are four
// questions — and this slice answers exactly the second one. An entry is also not a dependency: a Service
// named below is in the corresponding variant's `requires` because that variant reads it, and being
// listed here grants no access the Runtime had not already granted. The two directions are checked
// against each other in `test/language.test.mjs`, because a list naming a Service its own variant does
// not require is a capability offered to a model that the loop could not then read.
//
// The fixed topic vocabulary this file used to coexist with is gone, and the way it went is worth
// recording because "we deleted the old one" is not the interesting part. `LANGUAGE_TOPICS` and its
// glosses named four questions this build could answer — "your work focus", "the desktop now", "the
// desktop versus last time", "everything" — and the model picked one of them, and then `answer.ts`
// dispatched that word onto a Service call. That is two routers in a row. The word was this surface's
// own invention, so the model had to be taught it and a follow-up had to be translated back out of it
// before anything could be read, and none of it was a fact about a capability — it was a fact about
// how this plugin used to be organised.
//
// Removing the first router is what this file makes possible, and it did not need anything added to do
// it. A capability's name is already the thing the model needs to write, so the topic layer had nothing
// left to translate: `work-focus` maps onto `work_focus_read`, both desktop topics map onto the single
// `desktop_context_read`, and `current-context` turned out not to be a capability at all — it was "read
// everything", which is what a loop does by reading twice. Keeping both would have meant a model picking
// a topic and then picking a capability inside it, with the second choice constrained by a word the
// first one produced.

import type {
  AuthorizedRepositoriesListExposure,
  AuthorizedRepositoryReadExposure,
  AuthorizedRepositorySearchExposure,
} from '../changeable-repositories/index.js';
import {
  authorizedRepositoriesListExposure,
  authorizedRepositoryReadExposure,
  authorizedRepositorySearchExposure,
} from '../changeable-repositories/index.js';
import type { DesktopContextReadExposure } from '../desktop-session-awareness/index.js';
import { desktopContextReadExposure } from '../desktop-session-awareness/index.js';
import type { RepositoryCiRelevanceReadExposure } from '../repository-ci-relevance/index.js';
import { repositoryCiRelevanceReadExposure } from '../repository-ci-relevance/index.js';
import type { WorkFocusReadExposure } from '../work-focus/index.js';
import { workFocusReadExposure } from '../work-focus/index.js';

/**
 * One entry of any list: whichever owner's export it is.
 *
 * The union is written from the owners' own types rather than as a structural `{name, description,
 * service}`, so an entry that stopped carrying a field an owner's type requires would fail to compile
 * here instead of being silently accepted into a list. What the shapes have in common is a coincidence of
 * owners agreeing, not a shape this file declares and asks them to satisfy — and since one of them now
 * carries a field the others do not, that is no longer a figure of speech: `tools.ts` has to ask which
 * declaration an entry makes before it can build a tool from it, and it can only ask that of a union.
 */
export type LanguageExposure =
  | AuthorizedRepositoriesListExposure
  | AuthorizedRepositoryReadExposure
  | AuthorizedRepositorySearchExposure
  | WorkFocusReadExposure
  | DesktopContextReadExposure
  | RepositoryCiRelevanceReadExposure;

/**
 * The capabilities the base variant offers, in the order a model would be shown them.
 *
 * Every entry is the owner's export rather than an equal-looking copy of it, and a test asserts the
 * identity rather than the content — a description that matched by coincidence would still be a second
 * copy of it, and would still be the copy that goes stale.
 *
 * This list is the one a resident without a repository scope uses. It is no longer *only* the list this
 * plugin offered before the repository-aware variant existed: the two repository reads joined it, because
 * the capability they expose is reachable in every composition rather than in a configured one. Adding a
 * Service to the composition still does not add a capability here — see the guard above, and the test that
 * pins this list's length and members as a fixed set rather than as a subset of anything.
 */
export const LANGUAGE_EXPOSURES = Object.freeze([
  workFocusReadExposure,
  desktopContextReadExposure,
  authorizedRepositoriesListExposure,
  authorizedRepositoryReadExposure,
  authorizedRepositorySearchExposure,
]);

/**
 * The capabilities the repository-aware variant offers: the same entries, then the relevance judgement.
 *
 * The shared prefix is written out again rather than referenced, for the reason the header gives, and the
 * relevance judgement sits last in both this list and a model's reading order: it is the one entry here
 * that a resident may not have at all, it is the one that is about a *repository's continuous integration*
 * rather than about a repository, and putting it after the two reads that apply to any declared directory
 * keeps the common prefix common by inspection. It is also the entry backed by the Service that is not
 * always present — `repositoryCiRelevanceService` is in this variant's `requires`, so this list is only
 * ever reached by a composition that has already established the contract exists.
 */
export const LANGUAGE_REPOSITORY_EXPOSURES = Object.freeze([
  workFocusReadExposure,
  desktopContextReadExposure,
  authorizedRepositoriesListExposure,
  authorizedRepositoryReadExposure,
  authorizedRepositorySearchExposure,
  repositoryCiRelevanceReadExposure,
]);
