// What this plugin is willing to offer a model, written out, and the whole of the list.
//
// This file holds no words about any domain, and that is the point of it. Each entry is the owner's own
// export, by reference: the work focus says what reading the work focus means, the desktop session says
// what reading the desktop means, and this file says only *which* of them are on offer. The same shape
// as the wire vocabulary every plugin's barrel exports, and the same argument — a consumer that restated
// an owner's description in its own words would be a second thing deciding what another domain's
// capability covers, and the second one is the one nobody re-reads when the first changes. This comment
// therefore names no description text either: quoting one here would be the same drift, one commit
// earlier and harder to notice.
//
// Which capabilities are offered is this plugin's decision and not the owners', and `principles.md` §6
// says why: the provider owns how the thing is done and what it means, the consumer owns the question of
// what to do with it. So the split is the owner exporting `{name, description, service}` and this file
// choosing among them. Neither half is a courtesy to the other; a surface that took the owner's words
// *and* the owner's list would have moved the exposure decision into the provider, which is the same
// mistake in the other direction.
//
// The list is written out rather than assembled, because there are two and a v0 that discovered them
// would need a registry to discover them with. There is no lookup by name here, no registration, no
// iteration over the Runtime and no way to add an entry without editing this file — the list is a
// decision somebody made, and it reads like one.
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
// questions — and this slice answers exactly the second one. An entry is also not a dependency: the two
// Services below are in this plugin's `requires` because it reads them, which it did before this file
// existed, and being listed here grants no access that the Runtime had not already granted.
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
// left to translate: `work-focus` maps onto `work_focus.read`, both desktop topics map onto the single
// `desktop_context.read`, and `current-context` turned out not to be a capability at all — it was "read
// everything", which is what a loop does by reading twice. Keeping both would have meant a model picking
// a topic and then picking a capability inside it, with the second choice constrained by a word the
// first one produced.

import type { DesktopContextReadExposure } from '../desktop-session-awareness/index.js';
import { desktopContextReadExposure } from '../desktop-session-awareness/index.js';
import type { WorkFocusReadExposure } from '../work-focus/index.js';
import { workFocusReadExposure } from '../work-focus/index.js';

/**
 * One entry of the list: whichever owner's export it is.
 *
 * The union is written from the owners' own types rather than as a structural `{name, description,
 * service}`, so an entry that stopped carrying a field an owner's type requires would fail to compile
 * here instead of being silently accepted into the list. What the two shapes have in common is a
 * coincidence of two owners agreeing, not a shape this file declares and asks them to satisfy.
 */
export type LanguageExposure = WorkFocusReadExposure | DesktopContextReadExposure;

/**
 * The capabilities this plugin offers, in the order a model would be shown them.
 *
 * Both entries are the owners' exports rather than equal-looking copies of them, and a test asserts the
 * identity rather than the content — a description that matched by coincidence would still be a second
 * copy of it, and would still be the copy that goes stale.
 */
export const LANGUAGE_EXPOSURES = Object.freeze([
  workFocusReadExposure,
  desktopContextReadExposure,
]);
