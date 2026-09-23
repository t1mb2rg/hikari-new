// Reading a capability, and the whole of what this plugin does with one.
//
// An exposure names a Service; this file is the step that turns that name into the lines a model is
// shown. It is the adapter `principles.md` §6 puts on the consumer's side — the provider owns how the
// thing is done and what it means, the consumer owns the question of what to do with the result — and
// it is deliberately the smallest one that can exist: two branches, no new result type, and no domain
// word written here.
//
// Both branches end in a renderer that already existed. The desktop half is `renderAssessment` from
// `desktop-session-observe`, which `hikari observe desktop-session status` also calls. The focus half is
// `renderFocus` from `express.ts`, which is this surface's own statement about the focus reading and was
// already what a human read. So the lines a model is handed are the lines a human is handed, byte for
// byte, and that is the point rather than a convenience: a model shown a *different* view of the same
// reading would be a second statement of it, and since these lines are also what the final answer
// contains, the two could not come apart without the model having been told something the human was not.
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
