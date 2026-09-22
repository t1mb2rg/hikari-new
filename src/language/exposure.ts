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
// decision somebody made, and it reads like one. Nothing in this file is reachable from a
// model yet: this slice builds the foundation and stops, and the slice that consumes it is the one that
// brings the selection loop.
//
// What an entry does not carry: any permission. An exposure says a capability may be *offered*, and says
// nothing about whether a particular caller may use it or whether this particular act is allowed.
// `principles.md` §5 keeps those apart — existence, exposure, authorization and execution are four
// questions — and this slice answers exactly the second one. An entry is also not a dependency: the two
// Services below are in this plugin's `requires` because it reads them, which it did before this file
// existed, and being listed here grants no access that the Runtime had not already granted.
//
// `LANGUAGE_TOPICS` in `topics.ts` is a different list and stays where it is. That one is the closed set
// this build's understanding step currently chooses between, and it is what `answer.ts` dispatches on
// today. This one is the material a model-driven selection loop will choose between later. They coexist
// deliberately and neither derives from the other; the slice that migrates the first onto the second is
// the slice that gets to decide how, and doing it here would be the double router this round refused.

import { desktopContextReadExposure } from '../desktop-session-awareness/index.js';
import { workFocusReadExposure } from '../work-focus/index.js';

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
