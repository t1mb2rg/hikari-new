// A return, as values and without a word of prose of its own.
//
// The same doctrine `repository-ci-attention/types.ts` states for its occurrence, and the same reason:
// this type is what a judgement produced, it carries facts and no sentences, and every line a human
// reads about it is formed from these fields by that owner's own renderer. It flattens, and it imports
// nothing — the temporal facts come from `input-activity` and the designations come from `work-focus`,
// and carrying them by value rather than by reference is what keeps a value that has already been
// judged from changing underneath the sentence about it.
//
// There is no discriminant field and no `kind`. An occurrence exists only when a return happened; a
// type that could also describe the not-having-happened case would be a type whose constructor can
// produce states its producer never makes.
//
// `silentForMs` is a **floor**, and the name does not say so — the comment here is where that is
// recorded, because the field cannot carry the qualification itself. It is the input-free span
// measured at the last observation that confirmed a silence, in the counter's own milliseconds.
//
// Two qualifications, and the second is the one worth stating because it is not obvious from the
// field. First, the absence it measures ran *at least* that long: the counter only ever grows while
// the last input is unchanged, so a later reading of the same absence is a larger number. Second, and
// this is the part a reader could get wrong, it is a floor on an absence Hikari observed rather than
// necessarily the length of the absence that just ended. Sampling is discrete, so the gap between the
// observation that confirmed a silence and the observation that ended the watch can contain more than
// one input event — and with it more than one absence. When that happens the value reported is the
// one measured at the confirm, which is a true floor on that earlier absence, while the absence
// immediately before this observation was shorter and was never seen at all. What the value is not,
// under any reading, is a reconstruction of when the human left: no clock here could produce one.
//
// `designations` is never empty. The refusal of the empty case is not here but in `formOccurrence`,
// which returns `undefined` rather than an occurrence — because "there was nothing to say" is a
// decision about whether this value exists, not a fourth thing for it to mean.
export interface DesktopReturnOccurrence {
  readonly observedAt: string;
  readonly silentForMs: number;
  readonly designations: readonly string[];
}
