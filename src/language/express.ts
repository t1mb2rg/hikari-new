// Express: facts that already have owners, arranged into something a person can read, by rules that
// cannot disagree with the owners.
//
// Three things this file is not allowed to do, and they are the same three.
//
// It does not judge. Nothing here decides whether a window title looks like an editor, whether a
// change mattered, whether a source's silence means a guess, or what a verdict means — every one of
// those is a judgement that already has an owner, and a second one formed here would be a second
// answer to a question that has one. Verdicts are printed, not paraphrased.
//
// It does not re-render. The desktop block is not written here at all: it is `renderAssessment` from
// `desktop-session-observe`, called on the assessment the peek contract returned. That module's barrel
// exports its renderer for exactly this second caller — "a pure function of a value that is already
// public … a second caller cannot reach a different answer" — and using it is the difference between
// one statement of what a desktop assessment reads like and two that a reader has to hope agree.
// `hikari ask "桌面现在怎么样？"` and `hikari observe desktop-session status` therefore print the same
// block, which is not a coincidence to be tidied away later: it is the strongest available evidence
// that neither is inventing anything.
//
// It does not add. Every line is a fixed label and values taken from a contract verbatim, and the only
// free text that reaches a line is text a human wrote (a work focus designation), text an owner already
// rendered, or — in the one new case below — the model's own conversational reply, which is not a claim
// about Hikari and is never mixed with one that is.
//
// What used to be here and is not: the lead-in. Every answer opened with a sentence in this file's
// words saying which question had been understood ("你问的是桌面现在是什么状态。"). It is gone, and its
// removal is the point rather than a tidy-up. A lead-in has to name a topic, and naming a topic is a
// judgement about what the human meant — the one thing this surface is least entitled to make, and the
// one thing the tool-use loop moved off it. When the model reads a capability, the reading already says
// what it is: the focus block opens with its own header and the desktop block opens with its own
// verdict line. A sentence in front of them could only ever restate that, in words that a model
// produced and nobody owns. Two grounded blocks are laid out one after another with no connective
// tissue at all, because a sentence joining them would be this file composing a claim out of two facts
// it is not allowed to have an opinion about.

import type { DesktopSessionAwarenessAssessment } from '../desktop-session-awareness/index.js';
import { renderAssessment } from '../desktop-session-observe/index.js';
import { oneLine } from '../terminal-text/index.js';

import type { DialogueTurn } from './dialogue.js';
import type { LanguageExposure } from './exposure.js';

const FOCUS_HEADER = '你当前明确关注：';
const FOCUS_NONE = '你当前还没有明确声明任何关注对象。';

/**
 * One capability's reading, rendered, with the name it was read under.
 *
 * The name is carried for the loop's bookkeeping — it is what makes "this capability has already been
 * read this interaction" a fact about a value instead of a fact about a string a model wrote — and it
 * never reaches a line. The lines are the whole of what a human is shown, and they are also the whole
 * of what the model is shown: `read.ts` produces this and `answer.ts` hands the same `lines` to both.
 * That is the invariant the surface rests on, and it is structural here rather than promised — there is
 * one array, and two readers of it. `read.ts` also escapes them, which is what those two readers being
 * handed *the same thing* has to mean once the lines are allowed to contain text a human typed.
 */
export interface GroundedBlock {
  readonly name: string;
  readonly lines: readonly string[];
}

/**
 * The grounded answer, as lines a human reads: the blocks in the order they were read.
 *
 * `contextUsed` is the turn the question was answered against, when there was one. It names the
 * *capabilities* the previous grounded turn read, not a topic, because a capability is what a model can
 * act on and a topic was this surface's own vocabulary. It is printed last so the answer leads, and it
 * carries the moment as well as the reads, because a referent whose age is invisible is not a fact a
 * reader can weigh.
 *
 * A follow-up that the model resolved without reading anything does not appear here: a chat reply has no
 * grounding to attribute, and printing a context line under one would suggest Hikari had established
 * something.
 */
export function renderAnswer(blocks: readonly GroundedBlock[], contextUsed: DialogueTurn | null): readonly string[] {
  const lines: string[] = [];
  for (const block of blocks) lines.push(...block.lines);

  if (contextUsed !== null) {
    // "按…理解的" and not "按…读到的", and the verb is doing real work rather than padding. The line is
    // about the context the *model* was given, not about where the facts below came from: a follow-up
    // may be understood against the previous turn's reads and then read something else entirely — a
    // question about the desktop following one about the work focus is the ordinary case. Without the
    // verb, a reader sees a desktop block and a line naming the work focus, and reasonably concludes
    // the answer is being attributed to a reading it did not come from.
    lines.push(`（这一轮是按上一轮读取的内容理解的：${contextUsed.reads.join('、')}，它记于 ${contextUsed.at}）`);
  }

  // Applied to the whole answer rather than to the one field that needs it today, and applied here as
  // well as in `read.ts` rather than instead of it. The blocks arrive from the reader already line-safe,
  // because the model is shown those same lines and a forged second line would be a forgery aimed at
  // whichever of the two readers arrived second; this pass is what makes "one element is one line" a
  // property of *this* return value, so a future constructor that assembles lines some other way cannot
  // inherit the guarantee by accident. `oneLine` does not touch a backslash, so the second pass is a
  // no-op on lines that already went through the first.
  return lines.map(oneLine);
}

/**
 * What a human is shown when the model simply talked.
 *
 * The model's reply, line for line, and nothing else. This is the one path where model text is shown to
 * a human, and the reason it is safe is that it is the whole answer: nothing here is combined with a
 * reading, so there is no reading for a sentence to be mistaken for. The moment the loop reads
 * anything, this function stops being reachable in that interaction — see `answer.ts`, where the chat
 * path is guarded by "no blocks were read".
 *
 * It is escaped like everything else. The model is not a trusted source of layout either: a reply
 * containing a newline and a colon could otherwise print something shaped like a Hikari line.
 */
export function renderChat(content: string): readonly string[] {
  return content
    .trim()
    .split(/\r\n|\r|\n/)
    .map(oneLine);
}

// One designation per line rather than joined with a separator. A designation is free text and may
// contain any character, so a separator would let one designation print as though it were two — the
// same forged structure `oneLine` refuses, arriving through the layout instead of through a control
// character.
//
// The header and the empty case are this file's words and not the work focus plugin's. Its renderer is
// deliberately not exported (see `work-focus/index.ts`: the set is read through the contract), and what
// a *language* answer says about the focus is this surface's statement about a question it read, not
// the focus surface's answer to `hikari focus status`.
//
// Exported since the loop landed, because the tool result a model is shown and the answer a human is
// shown are now built in two places and have to be the same lines. `read.ts` calls it; this file does
// not, and the identity is what keeps the two from drifting.
export function renderFocus(designations: readonly string[]): readonly string[] {
  if (designations.length === 0) return [FOCUS_NONE];
  return [FOCUS_HEADER, ...designations.map((designation) => `  ${designation}`)];
}

/**
 * What a human is told when their question could not be turned into a reading.
 *
 * Two ways in, and one answer, because from the seat of the person asking they are one fact: this build
 * could not work out what to read. The model may have returned nothing at all, or it may have asked for
 * a capability that does not exist — either way nothing was read, no fact was established, and the
 * useful thing to say next is the same. The mandate keeps both under `refused`, and splitting them
 * would be starting the error taxonomy it forbids.
 *
 * The list at the end is the exposures' own descriptions, verbatim. It is long, and the length is the
 * honest option: shortening an owner's description into a gloss would be this file writing a second
 * statement of what another domain's capability covers, which is the drift `exposure.ts` exists to
 * prevent. A person who asks out of range reads what the owners actually said.
 *
 * The list is handed in rather than read off a module here, because which capabilities exist is a
 * property of the variant the person is talking to and not of this file. A resident without a repository
 * scope has no relevance judgement, and a refusal that listed one would be telling a human about a
 * capability their Hikari does not have — the same category of untruth as a refusal that listed nothing.
 *
 * It never quotes what the model wrote. The model's sentence is not evidence about Hikari, and showing
 * it to a human would put the model's words on the wire that this whole surface exists to keep them off
 * — a refusal that quoted the model would be the prose channel reopened from the other end. It is also
 * why the wording is fixed: a refusal that varied with what the model said would be a second, unowned
 * rendering of the model's output.
 */
export function unclassifiedLines(exposures: readonly LanguageExposure[]): readonly string[] {
  return [
    '这句话我没有找到该读 Hikari 的哪一部分，所以没有回答。',
    '这个构建能读的是：',
    ...exposures.map((exposure) => `  ${exposure.description}`),
  ];
}

export function emptyQuestionLines(): readonly string[] {
  return ['这句话是空的，没有可以理解的内容。'];
}

export function longQuestionLines(limit: number): readonly string[] {
  return [`这句话超过了 ${limit} 个字符，不是一句问话。`];
}

/**
 * What a human is told when the model's reply was cut off before it finished.
 *
 * `finish_reason = length` means the endpoint stopped generating because it hit the ceiling, so what
 * arrived is a prefix of a sentence rather than a sentence. Showing it would be showing a human
 * something the model did not say, with the missing half invisible; the smallest honest handling is to
 * say so and stop. It applies only to a chat reply — a truncated *tool call* is a different situation
 * and is handled by `readStep`, which cannot produce a call without a name to look up.
 *
 * Deliberately not a token-budget framework, and deliberately not a retry: raising `MODEL_MAX_TOKENS`
 * without measuring would be guessing at a number, and asking again would be spending another round to
 * get a second partial sentence. The ceiling has since been raised once, on a measurement rather than a
 * guess — see its note in `model.ts` — and this line is unchanged by that on purpose: a truncation that
 * survives the ceiling as it stands is still reported rather than retried, and the fix for one that turns
 * out to be common is still a real one, made with evidence.
 */
export function truncatedLines(): readonly string[] {
  return ['模型的话说到一半就到了长度上限，所以这句话不算说完，没有展示。'];
}

/**
 * What a human is told when the model itself could not be reached.
 *
 * Deliberately not the refusal above, and deliberately sharing no words with it. "我没有找到该读什么"
 * and "我没能问到" are different facts with different repairs — ask something else, versus come back —
 * and a surface that said the first while meaning the second would be telling a human their question
 * was out of range when the model was simply down.
 */
export function modelFailureLines(detail: string): readonly string[] {
  return ['模型没有答上来，所以这个问题没有被理解，也没有被回答。', detailLine(detail)];
}

/** What a human is told when a reading was chosen and did not come back. */
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
