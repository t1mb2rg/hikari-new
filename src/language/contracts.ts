// The one capability Language offers the composition, and the reason it did not exist until now.
//
// `index.ts` used to say, of both variants, that there was no Service to export because "nothing in the
// composition asks this plugin for anything: the one thing that does is a person, arriving over the
// endpoint." That was true, and it stopped being true when a composition member began asking. What
// changed is not the plugin's ambition but the number of callers: a decider that speaks unprompted is
// a second caller, and a second caller is what the Contract Creation Gate asks for — a real,
// already-happening cross-module interaction, not a facility built ahead of one.
//
// What this contract is *not* is a permission, and the distinction is the one this whole slice turns
// on. Providing it says Language can express something; it says nothing about whether any particular
// decider may speak, and it cannot, because a provider does not decide its consumers
// (`principles.md` §6). The authorization lives on the other side: the decider names this Service in
// its own `requires`, which is a member of the composition choosing to reach for it, and the
// composition is where a human's explicit act lands. Three separate facts — the capability exists,
// a decider is authorized to use it, a human client is connected to receive it — stay three facts.
//
// `speak` is synchronous. Nothing in the first slice calls a model: the whole of what it does is
// `renderAnswer([{ name, lines: renderOccurrence(occurrence) }], null)`, which is a pure function of a
// value the caller supplied. Returning a `Promise` for a function that cannot be pending would be
// ceremony, and worse, it would be a promise made on behalf of a model that this slice deliberately
// does not reach for.
//
// It returns lines rather than a `LanguageReply`, and that is the second deliberate narrowing.
// `types.ts` defines `answered` as "at least one capability was read, and the answer is what was
// read" — an unsolicited turn reads nothing, so filing it under `answered` would make one word mean
// two things. What the caller needs is exactly what a human will read, and that is what it gets.

import type { ServiceContract } from '../runtime/contracts.js';
import { defineService } from '../runtime/contracts.js';
import type { RepositoryCiAttentionOccurrence } from '../repository-ci-attention/types.js';

/**
 * Language's human-facing expression, offered to a composition member.
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
