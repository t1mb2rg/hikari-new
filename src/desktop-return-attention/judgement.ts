// The rule that decides whether a return just happened, and what it reads like.
//
// Three pure functions and a literal, all exported and all tested on every platform, for the reason
// `repository-ci-attention/judgement.ts` gives at length: a rule pinned only by a test that needs
// Windows is a rule CI never checks, and CI runs on `ubuntu-latest`. Everything that actually runs on
// a cadence lives in `plugin.ts`; nothing here holds state or reaches a Runtime.
//
// The whole of the arithmetic is one subtraction, and it is legal for exactly one reason: both ticks
// are readings of the same 32-bit millisecond counter, taken in the same acquisition. `observedAt` is
// a UTC wall timestamp off a different clock, and `observedAt - lastInputTick` is not a duration. It
// appears nowhere in this repository and must not: one term is ~1.7e12 and the other is under 4.3e9.
//
// The `>>> 0` is not decoration. The counter is 32 bits and wraps every 49.7 days, so the difference
// can be negative, and the unsigned wrap is what turns that case into the answer that is actually
// right: with the last input at `V` before the wrap and the counter now at `C` past it, the true
// elapsed time is `2^32 - V + C`, which is exactly what `(C - V) >>> 0` computes. So the difference is
// exact for any silence shorter than 49.7 days, and for a longer one it is wrong in the safe
// direction. Nothing here distinguishes a wrap from a reboot, and nothing needs to: both show up as
// the counter going backwards between two observations, which is the one case this file refuses to
// judge (see the guard in `stepReturn`).
//
// What this file is not allowed to ask: whether the silence was long *enough* to matter, whether the
// human would want to be told, whether this is a good moment. The threshold it compares against is
// the operator's, handed in by the caller; the rest is the salience judgement this slice is explicit
// that it does not build.

import type { InputActivityObservation } from '../input-activity/index.js';
import { oneLine } from '../terminal-text/index.js';

import type { DesktopReturnOccurrence } from './types.js';

/**
 * What this activation carries between observations.
 *
 * Two fields, and the second is the one that does the work: `silence !== undefined` means this
 * activation has observed an input-free span at or above the threshold and has not yet seen it end —
 * which is the whole of the state a return waits in. The duplicate rule is not enforced anywhere,
 * because it cannot be violated: `silence` goes back to `undefined` in the same step that produces an
 * occurrence, so the next one requires the counter to produce a *fresh* span at or above the
 * threshold before the human's next input can end it. There is no set of ids here and no dedup
 * utility, and their absence is the point rather than a saving (`repository-ci-attention` needs one
 * because a run id is a fact about GitHub; a silence is a fact about this activation's own history).
 *
 * `observedTick` is the previous observation's counter reading, and it exists for the guard alone.
 */
export interface DesktopReturnWatch {
  readonly observedTick: number | undefined;
  readonly silence: number | undefined;
}

export const INITIAL_DESKTOP_RETURN_WATCH: DesktopReturnWatch = Object.freeze({
  observedTick: undefined,
  silence: undefined,
});

/** One observation folded into the state it leaves behind, plus whatever it ended. */
export interface DesktopReturnStep {
  /** What the next observation is judged against. Always this function's output, never its input. */
  readonly watch: DesktopReturnWatch;
  /** The silence this observation ended, or `undefined` if it ended none. */
  readonly endedSilenceMs: number | undefined;
}

/**
 * One observation, against what this activation already knows, at the operator's threshold.
 *
 * The cases, in the order they are decided, and each is a different reason to say nothing:
 *
 *   counter went backwards   a reboot or a 32-bit wrap — this activation cannot tell which, and it
 *                            does not try. It forgets any silence and judges nothing this cycle, so
 *                            a discontinuity can never be read as a return.
 *   silence at threshold     a silence is real and observed; wait for it to end. This is also the
 *                            arming step: nothing is said until the human comes back.
 *   silence under threshold  either no silence was being watched — the baseline case at activation,
 *                            or continuous input, or a pause too short to count — or the input just
 *                            happened that ended one. `watch.silence` is what tells the two apart.
 *
 * The third case needs one property to be sound, and it is worth stating because it is what makes the
 * rule correct rather than plausible: while the last input is unchanged, `observedTick - lastInputTick`
 * only grows, so a difference that came out *under* the threshold after having been at or above it
 * means the last input moved — a new input occurred. Nothing else can lower it. (The guard runs first
 * so that a counter that went backwards cannot masquerade as a very large silence, and the threshold
 * is at least 1, which is why a just-arrived input always lands in this case rather than the one above.)
 *
 * The recorded silence is the latest one rather than the largest, because within a stretch of the
 * second case the value only grows — so the last reading is the maximum, and taking a maximum would be
 * bookkeeping that pretends to guard against something the arithmetic already forbids.
 */
export function stepReturn(
  observation: InputActivityObservation,
  watch: DesktopReturnWatch,
  afterMs: number,
): DesktopReturnStep {
  const { observedTick, lastInputTick } = observation;

  if (watch.observedTick !== undefined && observedTick < watch.observedTick) {
    return { watch: { observedTick, silence: undefined }, endedSilenceMs: undefined };
  }

  const silence = (observedTick - lastInputTick) >>> 0;

  if (silence >= afterMs) {
    return { watch: { observedTick, silence }, endedSilenceMs: undefined };
  }

  return { watch: { observedTick, silence: undefined }, endedSilenceMs: watch.silence };
}

/**
 * The occurrence, if there is anything to say it about.
 *
 * The empty-designation case is the whole reason this is a function rather than an object literal at
 * the call site. A Work Focus is what the human explicitly declared, and a return is only worth
 * telling them about when there is something they declared to be told about; with none, Hikari has
 * been asked to watch for a return and has nothing to say when one happens, so no occurrence is
 * formed and the path ends here rather than at the transport.
 *
 * That refusal lives here, next to the shape, rather than in `plugin.ts`, so that it is checkable
 * without a cadence and a Windows host. What is *not* here is any judgement about the designations
 * themselves — how many, how important, whether they are still current. They were read once, at the
 * moment of the judgement, which is what makes them the focus as of the return rather than as of
 * whenever someone got round to rendering.
 *
 * The designations are copied rather than carried by reference. The Service that produced them hands
 * back an array it has already frozen, so this is not a defence against mutation in fact — it is that
 * an occurrence should own the facts it states, and a copied array cannot become a second live view of
 * a set the human may have replaced since.
 */
export function formOccurrence(
  observedAt: string,
  silentForMs: number,
  designations: readonly string[],
): DesktopReturnOccurrence | undefined {
  if (designations.length === 0) return undefined;

  return Object.freeze({
    observedAt,
    silentForMs,
    designations: Object.freeze([...designations]),
  });
}

// The judgement's own name, as a header — the same shape `renderJudgement` and `renderOccurrence` use,
// and for the same reason: it names the surface that formed the judgement rather than saying anything
// about the facts below it.
const HEADER = 'Desktop return attention：';

/**
 * The occurrence, said out loud, and nothing else.
 *
 * Every word is either the header, a label, or a field of the occurrence printed verbatim. No line
 * says what the return *means* — not that the human was away, not that they came back, not that any
 * interval of time passed in their life. The claim this surface makes is the one the evidence
 * supports: that a silence of at least this long was observed, and that input was observed again.
 * `presentation.ts` in `desktop-session-observe` refuses to turn a tick into "3 秒前" for the same
 * reason this file prints milliseconds with the unit attached and converts nothing.
 *
 * The floor is stated rather than hidden. `silentForMs` is a lower bound, and a label that read as an
 * exact measurement would be this file overstating what it was given — the difference between the two
 * is a cadence, which is not this file's to know.
 *
 * The designations are printed under a label that says *when* they were read, because that is the
 * property the occurrence actually has. It is not the focus now, and a line saying "你当前明确关注"
 * would be claiming a currency this file cannot see: the human may have declared something else in the
 * seconds since. They are printed under a header of this file's own rather than through Language's
 * `renderFocus`, which is that surface's statement about a question it read and not this one's answer
 * to an occurrence nobody asked about.
 *
 * `oneLine` is applied to the whole return value for the reason `repository-ci-attention/judgement.ts`
 * gives: "one element is one line" becomes a property of *this* value rather than a hope about its
 * inputs, so a designation containing a newline cannot forge a Hikari line.
 */
export function renderOccurrence(occurrence: DesktopReturnOccurrence): readonly string[] {
  return [
    HEADER,
    `  观察时间：${occurrence.observedAt}`,
    `  已观测到的无输入时长（下界）：${occurrence.silentForMs} ms`,
    '  触发时的关注对象：',
    ...occurrence.designations.map((designation) => `    ${designation}`),
  ].map(oneLine);
}
