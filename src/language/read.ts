// Reading a capability, and the whole of what this plugin does with one.
//
// An exposure names a Service; this file is the step that turns that name into the lines a model is
// shown. It is the adapter `principles.md` §6 puts on the consumer's side — the provider owns how the
// thing is done and what it means, the consumer owns the question of what to do with the result — and
// it is deliberately the smallest one that can exist: one branch per exposure, no new result type, and no
// domain word written here.
//
// Every branch ends in a renderer that already existed. The desktop half is `renderAssessment` from
// `desktop-session-observe`, which `hikari observe desktop-session status` also calls. The focus half is
// `renderFocus` from `express.ts`, which is this surface's own statement about the focus reading and was
// already what a human read. The relevance half is `renderJudgement` from `repository-ci-relevance`,
// which is the endpoint's own answer to the same question. So a model is handed the owner's own rendering
// of a reading rather than a second view of it — the same function the human's path calls — and that is
// the point rather than a convenience: a model shown a *different* view of the same reading would be a
// second statement of it, and since these lines are also what the final answer contains, the two could not
// come apart without the model having been told something the human was not.
//
// "The owner's rendering" is the claim, and it is deliberately not "byte for byte": this file applies one
// transformation to every branch, `lineSafe` below, because an owner that hands raw bytes hands whoever
// prints them the ability to forge a line — and a model reading two lines where the owner wrote one cannot
// tell which of them Hikari said. `renderAssessment` already escapes its own output, so the call is a
// no-op on the desktop branch; the relevance endpoint's caller prints its lines as they are, so the two
// readers of that rendering differ by exactly this escaping and by nothing else.
//
// That last half is why the owner had to export its renderer rather than this file writing one. The
// judgement is a verdict word and a designation, and a formatting of it written here would read the same
// today and drift the first time the owner changed a line — with the drift invisible, because a model
// shown the old words and a human shown the new ones are never in the same room to disagree. The
// relevance capability is offered to a model as a reading of Hikari, so it travels as Hikari's own text.
//
// There are two readers rather than one, and the split is the variant split. `createExposureReader`
// handles the two reads every variant performs; `createRepositoryExposureReader` handles those plus the
// one only the repository-aware variant offers, by falling through to the first. The base reader is
// still the whole of what a base variant can do, and it still throws on an exposure it was not built to
// read — see the last branch, which is where a capability this build was never handed lands.
//
// What is *not* here: the raw contract values. `DesktopSessionAwarenessAssessment` is a union of nested
// snapshots with facet verdicts, and handing that to a model would be handing it a tree to interpret —
// the inferences the exposure's own description says Hikari never drew. The renderer has already
// flattened it into labelled lines, and those are what travel. Same for the focus: the model gets the
// designations as they will be printed, not a structure it could count, sort or weigh.
//
// Matching on `exposure.service` rather than on `exposure.name` is the one thing here worth defending.
// The name is a string, and a string is a thing two places can disagree about; the contract object is
// the same object `LANGUAGE_EXPOSURES` holds and the same one this plugin's `requires` names, so a
// capability whose Service this build was not handed reaches the last branch rather than the wrong
// branch. That branch throws, which becomes `failed`: a read this build cannot perform is not a reading
// that came back empty, and collapsing the two would report a broken wiring as an empty fact.

import type { DesktopSessionAwarenessAssessment } from '../desktop-session-awareness/index.js';
import { desktopSessionAwarenessPeekService } from '../desktop-session-awareness/index.js';
import { renderAssessment } from '../desktop-session-observe/index.js';
import { renderJudgement, repositoryCiRelevanceService } from '../repository-ci-relevance/index.js';
import type { RepositoryCiRelevanceJudgement } from '../repository-ci-relevance/index.js';
import { oneLine } from '../terminal-text/index.js';
import { workFocusCurrentService } from '../work-focus/index.js';

import { LanguageError } from './errors.js';
import type { LanguageExposure } from './exposure.js';
import { renderFocus } from './express.js';

/**
 * What this plugin needs in order to perform a read.
 *
 * Two functions, both already on the plugin before this file existed, named by what they return rather
 * than by which contract they came from. The dispatch below is what knows which is which, and keeping
 * that knowledge in one place is why this is not two separate dependency objects.
 */
export interface ExposureDependencies {
  readonly readFocus: () => Promise<readonly string[]>;
  readonly peek: () => Promise<DesktopSessionAwarenessAssessment>;
}

/** Perform one exposure's read and render it. Throws when the exposure is not one this build can read. */
export type ExposureReader = (exposure: LanguageExposure) => Promise<readonly string[]>;

export function createExposureReader(dependencies: ExposureDependencies): ExposureReader {
  return async function read(exposure: LanguageExposure): Promise<readonly string[]> {
    if (exposure.service === workFocusCurrentService) {
      return lineSafe(renderFocus(await dependencies.readFocus()));
    }
    if (exposure.service === desktopSessionAwarenessPeekService) {
      return lineSafe(renderAssessment(await dependencies.peek()));
    }
    throw new LanguageError(`能力 ${exposure.name} 指向的服务不是这个构建能读取的服务。`);
  };
}

/**
 * What the repository-aware variant needs: the base two, plus the judgement.
 *
 * It extends rather than replaces, because that variant offers the base two as well. A reader that took
 * only the third would be a second reader with an almost identical body, and the two would be free to
 * disagree about what a base exposure reads.
 */
export interface RepositoryExposureDependencies extends ExposureDependencies {
  readonly readRelevance: () => Promise<RepositoryCiRelevanceJudgement>;
}

/**
 * The base reader, plus the one branch only the repository-aware variant can reach.
 *
 * The extra branch renders through the owner's `renderJudgement` rather than formatting the verdict
 * here, which is the same rule both base branches follow and the reason the owner exports it. Everything
 * else falls through to `createExposureReader`, so an exposure this build cannot read is refused by the
 * same branch and with the same message as before — the repository variant does not grow a second way to
 * fail at an unknown capability.
 */
export function createRepositoryExposureReader(
  dependencies: RepositoryExposureDependencies,
): ExposureReader {
  const readBase = createExposureReader(dependencies);

  return async function read(exposure: LanguageExposure): Promise<readonly string[]> {
    if (exposure.service === repositoryCiRelevanceService) {
      return lineSafe(renderJudgement(await dependencies.readRelevance()));
    }
    return readBase(exposure);
  };
}

/**
 * Make "one element is one line" true of what this file returns.
 *
 * A work focus designation is text a human typed, and one carrying a line break would otherwise reach
 * the model as two lines — the second shaped exactly like a line Hikari wrote. That is the forgery
 * `oneLine` exists to refuse, and until this function existed it was refused on the way to the terminal
 * and not on the way to the model, which is the one reader this slice promised would see the same bytes.
 * `renderAssessment` escapes its own lines on the way out, so the call is a no-op for the desktop half;
 * it is applied to both because the claim being established is a property of a *reading* — the model's
 * view and the human's view are this one array, and it is line-safe — and a property established on one
 * branch is a rule somebody has to remember to apply to the next one.
 *
 * Escaping here rather than at the point the model is handed the lines is what keeps the two readers
 * reading the same value. `renderAnswer` escapes these lines again on their way to a human; `oneLine`
 * leaves a backslash alone, so running it twice is running it once, and the second pass costs nothing.
 */
function lineSafe(lines: readonly string[]): readonly string[] {
  return lines.map(oneLine);
}
