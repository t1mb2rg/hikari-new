// Express: facts that already have owners, arranged into something a person can read, by rules that
// cannot disagree with the owners.
//
// Three things this file is not allowed to do, and they are the same three.
//
// It does not judge. Nothing here decides whether a window title looks like an editor, whether a
// change mattered, whether a source's silence means a guess, or what a verdict means — every one of
// those is a judgement that already has an owner, and a second one formed here would be a second
// answer to a question that has one. What this file does with `changed` and `stable` is print them.
// A topic name is not translated into a human phrase and a verdict is not softened into a sentence,
// because the moment one of them is paraphrased there are two statements of it and the human can no
// longer tell which one Hikari stands behind.
//
// It does not re-render. The desktop block below is not written here at all: it is
// `renderAssessment` from `desktop-session-observe`, called on the assessment the peek contract
// returned. That module's barrel exports its renderer for exactly this second caller — "a pure
// function of a value that is already public … a second caller cannot reach a different answer" — and
// using it is the difference between one statement of what a desktop assessment reads like and two
// that a reader has to hope agree. `hikari ask "桌面现在怎么样？"` and `hikari observe desktop-session
// status` therefore print the same block, which is not a coincidence to be tidied away later: it is
// the strongest available evidence that neither is inventing anything.
//
// It does not add. Every line is a fixed label and values taken from a contract verbatim, and the
// only free text that reaches a line is text a human wrote (a work focus designation) or text an
// owner already rendered. Nothing is summarized, rounded, reordered or joined into a new claim.
//
// What is left is a lead-in, in this surface's own frozen words, saying what the question was
// understood as — and that word is the whole of the natural-language surface here. It is worth being
// plain about why nothing more is composed. The mandate allows a sentence like "你当前明确关注
// hikari-new，前台窗口是 VS Code", and the composition is refused, not overlooked: this repository
// does not report "VS Code". It reports a process name and a window title, and choosing which of the
// two is "the window", or reading a product name out of a title, is exactly the judgement about a
// foreground title that this slice is forbidden to make. A composed sentence would therefore have to
// be built out of a guess dressed as a value. The lead-in carries the same information and claims
// nothing: it says what was asked, and the block below it says what Hikari established.

import type { DesktopSessionAwarenessAssessment } from '../desktop-session-awareness/index.js';
import { renderAssessment } from '../desktop-session-observe/index.js';
import { oneLine } from '../terminal-text/index.js';

import type { DialogueTurn } from './dialogue.js';
import { LANGUAGE_TOPICS, TOPIC_GLOSS, type LanguageTopic } from './topics.js';

/**
 * One answer's worth of grounded facts, with the topic they are grounded for.
 *
 * The topic is the discriminant, so the shapes that would be wrong cannot be written down: a
 * `desktop-state` answer cannot be built without an assessment and a `work-focus` answer cannot be
 * built with one, and there is no arrangement in which a caller passes facts for a question that was
 * not asked. What reads them is `plugin.ts`, which is also the only thing that reads them.
 */
export type GroundedAnswer =
  | { readonly topic: 'work-focus'; readonly designations: readonly string[] }
  | { readonly topic: 'desktop-state'; readonly assessment: DesktopSessionAwarenessAssessment }
  | { readonly topic: 'desktop-change'; readonly assessment: DesktopSessionAwarenessAssessment }
  | {
      readonly topic: 'current-context';
      readonly designations: readonly string[];
      readonly assessment: DesktopSessionAwarenessAssessment;
    };

// Each lead-in names the question that was understood, in this surface's own words, and nothing else.
// None of them says what the answer will be: a lead-in that anticipated its own findings would be a
// claim made before the facts were read.
const LEAD: Readonly<Record<LanguageTopic, string>> = Object.freeze({
  'current-context': '你问的是 Hikari 现在掌握的情况。',
  'work-focus': '你问的是 Hikari 当前被明确声明的关注对象。',
  'desktop-state': '你问的是桌面现在是什么状态。',
  'desktop-change': '你问的是桌面和上一次快照相比有没有变化。',
});

const FOCUS_HEADER = '你当前明确关注：';
const FOCUS_NONE = '你当前还没有明确声明任何关注对象。';

/**
 * The answer, as lines a human reads.
 *
 * `contextUsed` is the turn the question was understood against, when there was one, and naming it is
 * the whole of how a follow-up is checkable: without that line a human cannot tell whether "那刚才那
 * 个呢" was answered about the thing they meant or about something Hikari decided they meant. It is
 * printed last so the answer leads, and it carries the moment as well as the topic, because a
 * referent whose age is invisible is not a fact a reader can weigh.
 */
export function renderAnswer(grounded: GroundedAnswer, contextUsed: DialogueTurn | null): readonly string[] {
  const lines: string[] = [LEAD[grounded.topic]];

  if (grounded.topic === 'work-focus' || grounded.topic === 'current-context') {
    lines.push(...renderFocus(grounded.designations));
  }
  if (grounded.topic !== 'work-focus') {
    lines.push(...renderAssessment(grounded.assessment));
  }
  if (contextUsed !== null) {
    lines.push(`（这一轮是按上一轮的主题理解的：${contextUsed.topic}，它记于 ${contextUsed.at}）`);
  }

  // Applied to the whole answer rather than to the one field that needs it today. The work focus
  // designations are text a human typed and reach this file unescaped, and a designation carrying a
  // line break could otherwise print a second line that reads like something Hikari said. The
  // desktop block already went through this on its own way out; it is idempotent, and running it here
  // is what makes "one element is one line" a property of this return value rather than a list of
  // fields somebody has to keep up to date.
  return lines.map(oneLine);
}

// One designation per line rather than joined with a separator. A designation is free text and may
// contain any character, so a separator would let one designation print as though it were two — the
// same forged structure `oneLine` refuses, arriving through the layout instead of through a control
// character.
//
// The header and the empty case are this file's words and not the work focus plugin's. Its renderer is
// deliberately not exported (see `work-focus/index.ts`: the set is read through the contract), and
// what a *language* answer says about the focus is this surface's statement about a question it
// understood, not the focus surface's answer to `hikari focus status`.
function renderFocus(designations: readonly string[]): readonly string[] {
  if (designations.length === 0) return [FOCUS_NONE];
  return [FOCUS_HEADER, ...designations.map((designation) => `  ${designation}`)];
}

/**
 * What a human is told when the model did not put their question in the closed set.
 *
 * It says what this build can be asked, using the same glosses the model was shown, so that a person
 * who asks out of scope learns the range rather than a second list that could disagree with it.
 *
 * It never quotes what the model wrote, and that is not a formatting choice. The model's sentence is
 * not evidence about Hikari, and showing it to a human would put the model's words on the wire that
 * this whole slice exists to keep them off — a refusal that quoted the model would be the prose
 * channel reopened from the other end. It is also the reason the wording is fixed: a refusal that
 * varied with what the model said would be a second, unowned rendering of the model's output.
 */
export function unclassifiedLines(): readonly string[] {
  return [
    '这句话我没有听懂它在问哪一件事，所以没有回答。',
    '这个构建能问的是：',
    ...LANGUAGE_TOPICS.map((topic) => `  ${TOPIC_GLOSS[topic]}`),
  ];
}

export function emptyQuestionLines(): readonly string[] {
  return ['这句话是空的，没有可以理解的内容。'];
}

export function longQuestionLines(limit: number): readonly string[] {
  return [`这句话超过了 ${limit} 个字符，不是一句问话。`];
}

/**
 * What a human is told when the model itself could not be reached.
 *
 * Deliberately not the refusal above, and deliberately sharing no words with it. "我没有听懂" and "我
 * 没能问到" are different facts with different repairs — ask something else, versus come back — and a
 * surface that said the first while meaning the second would be telling a human their question was
 * out of scope when the model was simply down.
 */
export function modelFailureLines(detail: string): readonly string[] {
  return ['模型没有答上来，所以这个问题没有被理解，也没有被回答。', detailLine(detail)];
}

/** What a human is told when the question was understood and the facts it needs were not readable. */
export function groundingFailureLines(detail: string): readonly string[] {
  return ['问题理解了，但 Hikari 没能读到回答它需要的事实。', detailLine(detail)];
}

// The reason, escaped where it is interpolated, and this is the one line in the file that needs it.
//
// `renderAnswer` applies `oneLine` to a whole answer, but these two constructors never pass through it:
// they *are* the answer, returned to the caller as-is. Their `detail` is also the only text in this
// file that this repository did not write — it arrives from an error raised somewhere else, by the
// transport or by a contract — so it is exactly the text a renderer cannot vouch for. Escaping at the
// interpolation rather than wrapping the return value keeps the rule visible at the one place it
// applies, instead of making every future line in this file pay for it.
function detailLine(detail: string): string {
  return `  细节：${oneLine(detail)}`;
}
