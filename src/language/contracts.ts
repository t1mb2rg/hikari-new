// The capabilities Language offers the composition, and why there are two.
//
// There were none until a composition member began asking. `index.ts` used to say, of both variants,
// that there was no Service to export because "nothing in the composition asks this plugin for
// anything: the one thing that does is a person, arriving over the endpoint." That was true, and it
// stopped being true when a decider with something to say and no way to say it arrived. What changed
// is not the plugin's ambition but the number of callers: a decider that speaks unprompted is a
// caller, and a caller is what the Contract Creation Gate asks for — a real, already-happening
// cross-module interaction, not a facility built ahead of one.
//
// Two contracts and not one, for the reason `desktop-session-awareness/contracts.ts` gives for
// `current` and `peek`: what a caller can reach should be a property of the capability it was handed
// rather than a rule it is asked to keep. The alternative shapes were considered and each is worse
// here. One Service with two methods (`speakRepositoryCi` and `speakDesktopReturn`) would make
// `requires: [languageSpeakingService]` grant *both* owners' speaking authority at once — the very
// coupling this split exists to remove. One Service taking a closed union of the two occurrence types
// cannot be written safely: neither occurrence carries a discriminant, so narrowing them would be a
// structural guess about two shapes that are free to drift toward each other. And a union is not what
// "there is a second consumer now" implies — a second consumer is evidence that a second *capability*
// is wanted, which is what the Gate asks a caller to demonstrate.
//
// The cost of two is a naming asymmetry: `language.speaking@1` is the Repository CI one and its name
// does not say so. That is recorded rather than repaired. Renaming a contract that is already being
// served, so that a pair of names reads more evenly, is churn charged to a consumer that did nothing
// wrong — and the same asymmetry is already in the renderers (`renderSpokenOccurrence` beside
// `renderSpokenReturn`), for the same reason.
//
// What neither contract is, is a permission, and the distinction is the one this whole slice turns
// on. Providing one says Language can express something; it says nothing about whether any particular
// decider may speak, and it cannot, because a provider does not decide its consumers
// (`principles.md` §6). The authorization lives on the other side: the decider names the Service in
// its own `requires`, which is a member of the composition choosing to reach for it, and the
// composition is where a human's explicit act lands. Three separate facts — the capability exists,
// a decider is authorized to use it, a human client is connected to receive it — stay three facts.
//
// `speak` is synchronous on both. Nothing here calls a model: the whole of what each does is
// `renderAnswer([{ name, lines: renderOccurrence(occurrence) }], null)`, which is a pure function of a
// value the caller supplied. Returning a `Promise` for a function that cannot be pending would be
// ceremony, and worse, it would be a promise made on behalf of a model that these slices deliberately
// do not reach for.
//
// They return lines rather than a `LanguageReply`, and that is the second deliberate narrowing.
// `types.ts` defines `answered` as "at least one capability was read, and the answer is what was
// read" — an unsolicited turn reads nothing, so filing it under `answered` would make one word mean
// two things. What the caller needs is exactly what a human will read, and that is what it gets.

import type { ServiceContract } from '../runtime/contracts.js';
import { defineService } from '../runtime/contracts.js';
import type { DesktopReturnOccurrence } from '../desktop-return-attention/types.js';
import type { RepositoryCiAttentionOccurrence } from '../repository-ci-attention/types.js';

/**
 * Language's human-facing expression of a Repository CI failure, offered to a composition member.
 *
 * The argument is the owner's own occurrence type and not a `GroundedBlock`, and the difference is the
 * whole reason this contract is safe to offer. A caller that supplied the lines could make Hikari say
 * anything — that is `speak(string)` with a wrapper around it. A caller that supplies *facts* can lie
 * about the facts, but it cannot choose Hikari's words: the renderer is the owner's, it is called on
 * the far side of this boundary, and the caller never sees its output before the human does.
 *
 * The coupling this creates — Language naming a repository-specific type — is the same coupling
 * `read.ts` already has to `renderJudgement` and `express.ts` to `renderAssessment`. In all three, what
 * Language imports is an owner's fact type and an owner's pure renderer, never the ability to judge
 * anything about them: this plugin does not decide whether a failure matters, whether a repository is
 * relevant, or whether an occurrence is a duplicate.
 */
export interface LanguageSpeakingService {
  /** The occurrence, as the lines a human reads. Never rejects; a pure function of its argument. */
  speak(occurrence: RepositoryCiAttentionOccurrence): readonly string[];
}

export const languageSpeakingService: ServiceContract<LanguageSpeakingService> = defineService<
  LanguageSpeakingService
>('language.speaking', 1);

/**
 * Language's human-facing expression of a Desktop Return, offered to a composition member.
 *
 * Same shape, same guarantees, different owner — and the argument above about supplying facts is why
 * this is safe for the same reasons rather than by analogy. What is added here is the reverse
 * direction of the same rule: neither owner's occurrence type is accepted by the other's entry point,
 * so a caller holding this Service cannot make Language speak about a CI failure, and a caller holding
 * the other cannot make it speak about a return.
 *
 * This contract does not know what a return *means*. It is handed a value that says "a silence of at
 * least this long ended at this moment, and this is what the human had declared they were focused on",
 * and it hands back the owner's rendering of it. Whether that silence was long enough, whether there
 * is anything worth saying, and whether this had been said before were all settled before the value
 * existed, by the module that owns them.
 */
export interface LanguageDesktopReturnSpeakingService {
  /** The occurrence, as the lines a human reads. Never rejects; a pure function of its argument. */
  speak(occurrence: DesktopReturnOccurrence): readonly string[];
}

export const languageDesktopReturnSpeakingService: ServiceContract<LanguageDesktopReturnSpeakingService> =
  defineService<LanguageDesktopReturnSpeakingService>('language.desktop-return-speaking', 1);
