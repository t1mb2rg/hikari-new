// The TUI's screen, as lines and then as bytes.
//
// Pure, like `tui-state.ts` and for the same reason, with one more of its own: this is where the
// disciplines the mandate states about *presentation* are enforced, and a discipline that only exists
// inside a loop which talks to a terminal cannot be checked on a machine where the terminal cannot be
// driven. "The resident's status lines go out whole", "a Language reply is not reworded", "the frame
// leaves nothing of the previous frame behind" and "the input line fits the window" are all claims about
// these functions.
//
// The two rules that shape the code below:
//
//   * Colour is decided by the protocol and by nothing else. §5.3 of the v0 freeze, carried forward:
//     the tints here read `ControlOutcome` and `LanguageReply.outcome` — fields the protocol defines —
//     and never the contents of a line. A frame that went red because a line contained the word
//     "failed" would be this file parsing sentences it was told to carry whole, and it would break
//     silently the first time the resident reworded one.
//
//   * Text is measured and clipped before it is styled, never after. Every line is built as a list of
//     spans in plain text, the list is trimmed to the window, and only then are the SGR sequences
//     written in. Styling first would mean measuring a string that already contains escape sequences
//     this file would have to skip over to know how wide it really is — and getting that wrong does not
//     look like a bug in a test, it looks like a line that wraps and pushes the input row off screen.

import { oneLine } from '../terminal-text/index.js';
import type { LineEdit } from './tui-input.js';
import {
  toneLabel,
  type DeliveryState,
  type ProfileField,
  type ReplyTone,
  type TranscriptEntry,
  type TuiState,
  type TuiViewName,
} from './tui-state.js';

// ---------------------------------------------------------------------------------------------
// The terminal, as this file uses it
// ---------------------------------------------------------------------------------------------

const ALT_SCREEN_ON = '\x1b[?1049h';
const ALT_SCREEN_OFF = '\x1b[?1049l';
const CURSOR_HIDE = '\x1b[?25l';
const CURSOR_SHOW = '\x1b[?25h';
const CLEAR_SCREEN = '\x1b[2J';
const HOME = '\x1b[H';
const CLEAR_LINE = '\x1b[K';
// Erase from the cursor to the end of the screen. Carried over from the v0 console unchanged, and it
// matters more here than it did there: this TUI has three bodies of very different lengths behind one
// window, so the frame after a Tab can easily be shorter than the frame before it. Clearing only to the
// end of each written line would leave the tail of the previous view sitting under the new one, read as
// though it belonged to it.
const ERASE_BELOW = '\x1b[J';

// Every span is closed with a reset, and the frame appends `\x1b[K` to every line — which erases using
// the attributes in effect where it starts. A span left open therefore decides what the rest of its
// line is *erased* with, not merely what it is coloured with. Of the styles below only the inverse one
// would actually paint, but the rule is "close every span" because which one would show changes the day
// a style is added.
const SGR_RESET = '\x1b[0m';
const SGR_BOLD = '\x1b[1m';
const SGR_DIM = '\x1b[2m';
const SGR_RED = '\x1b[31m';
const SGR_GREEN = '\x1b[32m';
const SGR_YELLOW = '\x1b[33m';
const SGR_CYAN = '\x1b[36m';
const SGR_INVERSE = '\x1b[7m';

const RULE_CHAR = '─';

/**
 * How a frame is drawn. Arguments rather than environment reads, so that the same state renders the
 * same bytes anywhere and a test can pin a narrow, uncoloured frame without owning a terminal.
 */
export interface TuiRenderOptions {
  readonly columns: number;
  readonly rows: number;
  readonly color: boolean;
}

const DEFAULT_RENDER: TuiRenderOptions = { columns: 80, rows: 24, color: true };

// Three header rows, a rule, the body, a rule, the input row, and the key hints under it.
const HEADER_ROWS = 3;
const CHROME_ROWS = HEADER_ROWS + 3;

// Below this many rows the hint is dropped rather than taking a row from the body. It is the only piece
// of chrome on the screen that is decoration — everything else is either a fact or the thing being
// typed into — so it is the one that yields when the window is too short for all of them, and a window
// this short is one where a row of body text is worth more than a row of instructions.
const HINT_MIN_ROWS = 12;

function hintRows(render: TuiRenderOptions): number {
  return render.rows >= HINT_MIN_ROWS ? 1 : 0;
}

/**
 * How many rows are left for a view's body, and never fewer than one.
 *
 * The hint is subtracted here rather than left to the caller because `bodyRows` and `renderScreen` have
 * to agree exactly: the body is the only part of the frame whose length is derived rather than fixed, so
 * a disagreement between these two is a frame one row taller than the window, and the line that falls
 * off the bottom of it is the input row. That is a bug this file has already had once.
 */
export function bodyRows(render: TuiRenderOptions = DEFAULT_RENDER): number {
  return Math.max(1, render.rows - CHROME_ROWS - hintRows(render));
}

// ---------------------------------------------------------------------------------------------
// Spans: text that knows how wide it is and what it should look like
// ---------------------------------------------------------------------------------------------

interface Span {
  readonly text: string;
  readonly codes: readonly string[];
}

type Line = readonly Span[];

/**
 * Text with a tab turned into a single space, before it ever reaches the grid.
 *
 * A tab is the one control character that arrives here at all. `oneLine` spells every other one out but
 * leaves 0x09 alone, because a stream of output can afford the terminal's own tab stops — and every
 * producer of lines this surface displays escapes through it: the language plugin for replies, both
 * proactive deciders for deliveries. A grid cannot afford them. `displayWidth` counts a tab as zero cells
 * (it is below 0x20), while a terminal advances it to the next multiple of eight, so the renderer trims a
 * line believing it fits and the terminal then wraps it: the frame grows a row and the input row falls
 * off the bottom, which is the failure the note on `displayWidth` describes.
 *
 * Computing the true width instead — expanding to the next tab stop — is not available here, and that is
 * the decisive part rather than a limitation of effort. The frame writer separates rows with a bare `\n`
 * and never returns the carriage, so the column a row starts at is whatever the previous row left behind,
 * which differs between terminals that treat `\n` as a line feed and ones that treat it as a newline.
 * A tab's stop is therefore not merely unknown to this file, it is not well defined. Emitting one hands
 * the layout to the terminal.
 *
 * A space keeps the separation the tab stood for at a cost of exactly one cell, so measurement and
 * rendering agree again. Verified against the failing shape rather than argued: at 40 columns a reply
 * line of `'x'.repeat(32) + '\t' + '尾'` rendered 41 cells wide before this, and the same line is 40 after.
 */
function gridText(text: string): string {
  return text.includes('\t') ? text.replace(/\t/g, ' ') : text;
}

function span(text: string, ...codes: readonly string[]): Span {
  return { text: gridText(text), codes };
}

/**
 * How many terminal cells a piece of text takes.
 *
 * This is not a full UAX #11 implementation and does not pretend to be. It covers the three cases that
 * decide whether a frame fits on the machine this is built for: characters that take two cells (CJK and
 * fullwidth forms, which is what the interface's own Chinese text is made of, plus the ranges where
 * emoji live), characters that take none (combining marks and the zero-width range), and everything
 * else.
 *
 * Getting this wrong has a specific failure rather than a general one: a line measured as narrower than
 * it is wraps, the frame grows by a row, and the input row is pushed off the bottom of the window.
 * Under-measuring the CJK the labels are written in would do that on every frame.
 *
 * The one character deliberately *not* covered here is the rule, which is built to the measured width
 * rather than measured itself. `─` is East Asian Width *Ambiguous*: a terminal configured to render
 * ambiguous characters double-width would wrap it. That is a known assumption rather than an oversight,
 * it is inherited from the v0 console's own note, and it has not been observed on the platform this is
 * built for.
 */
export function displayWidth(text: string): number {
  let width = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 0) continue;
    if (isZeroWidth(code)) continue;
    width += isWide(code) ? 2 : 1;
  }
  return width;
}

function isZeroWidth(code: number): boolean {
  if (code < 0x20 || (code >= 0x7f && code < 0xa0)) return true;
  if (code >= 0x0300 && code <= 0x036f) return true; // combining diacritics
  if (code === 0x200b || code === 0x200c || code === 0x200d || code === 0xfeff) return true;
  return false;
}

function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
    (code >= 0x2e80 && code <= 0x303e) || // CJK radicals, Kangxi, CJK punctuation
    (code >= 0x3041 && code <= 0x33ff) || // kana, CJK compatibility
    (code >= 0x3400 && code <= 0x4dbf) || // CJK extension A
    (code >= 0x4e00 && code <= 0x9fff) || // CJK unified ideographs
    (code >= 0xa000 && code <= 0xa4cf) || // Yi
    (code >= 0xac00 && code <= 0xd7a3) || // Hangul syllables
    (code >= 0xf900 && code <= 0xfaff) || // CJK compatibility ideographs
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) || // fullwidth forms
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f9ff) || // emoji
    (code >= 0x20000 && code <= 0x3fffd) // CJK extensions B and beyond
  );
}

/** The width of a whole line of spans. */
function lineWidth(line: Line): number {
  return line.reduce((total, part) => total + displayWidth(part.text), 0);
}

/**
 * The line, trimmed to `columns` cells.
 *
 * A character that would straddle the boundary is dropped rather than half-written — a wide character
 * has no half, and letting one through puts the terminal's own opinion about the overflow into the
 * layout. The marker is `…` and it is written in place of the last column that fits, so the result is
 * exactly `columns` wide when it was trimmed and exactly as wide as it was otherwise.
 */
function clip(line: Line, columns: number): Line {
  if (columns <= 0) return [];
  if (lineWidth(line) <= columns) return line;

  const kept: Span[] = [];
  let used = 0;
  let trimmed = false;

  for (const part of line) {
    let text = '';
    for (const character of part.text) {
      const size = displayWidth(character);
      // Reserve the last column for the marker as soon as we know something is being cut.
      if (used + size > columns - 1) {
        trimmed = true;
        break;
      }
      text += character;
      used += size;
    }
    if (text !== '') kept.push(span(text, ...part.codes));
    if (trimmed) break;
  }

  kept.push(span('…', SGR_DIM));
  return kept;
}

/** A line of spans as the bytes that go to the terminal. */
function emit(line: Line, color: boolean): string {
  let out = '';
  for (const part of line) {
    if (!color || part.codes.length === 0) {
      out += part.text;
      continue;
    }
    out += `${part.codes.join('')}${part.text}${SGR_RESET}`;
  }
  return out;
}

function rule(render: TuiRenderOptions): Line {
  // Never narrower than one column. The floor is one rather than a "minimum sensible width" because the
  // only hard failure available to this line is wrapping: a rule longer than the window is pushed onto a
  // second row and shifts everything below it, and a cramped window is precisely where that must not
  // happen. Deliberately not run through `clip`: its length is exact by construction, and clipping it
  // would append ellipsis to a line whose whole job is to be a straight edge.
  return [span(RULE_CHAR.repeat(Math.max(1, render.columns)), SGR_DIM)];
}

// ---------------------------------------------------------------------------------------------
// Colour: the protocol's outcome, and never a line's contents
// ---------------------------------------------------------------------------------------------

/**
 * The one thing on screen allowed to vary with the resident's state, and the line it must not cross.
 *
 * Read the input to this function and not just its output: `launching` and `control`, and nothing else.
 * There is no parameter carrying the status lines, so there is nothing here that *could* look inside
 * them — which is a stronger guarantee than a comment asking the next author to be careful.
 *
 * `launching` outranks an answer rather than being merged with it: a launch in progress shows as pending
 * even while the last poll still says `absent`, because saying "没有运行" about a process the operator
 * just watched start is the specific misreading the v0 console was built to avoid.
 */
export type ResidentTone = 'ok' | 'failed' | 'idle' | 'broken' | 'pending';

export function residentTone(state: Pick<TuiState, 'launching' | 'control'>): ResidentTone {
  if (state.launching || state.control === undefined) return 'pending';
  if (state.control.kind === 'answered') return state.control.outcome === 'ok' ? 'ok' : 'failed';
  return state.control.kind === 'absent' ? 'idle' : 'broken';
}

function toneColor(tone: ResidentTone): readonly string[] {
  if (tone === 'ok') return [SGR_GREEN];
  if (tone === 'failed') return [SGR_RED];
  if (tone === 'broken') return [SGR_YELLOW];
  return [SGR_DIM];
}

/**
 * A mark that says the same thing as the words beside it, so that it is never the only carrier of a
 * state.
 *
 * Filled means something is running, hollow means nothing is, and `broken` deliberately gets neither.
 * `unreachable` is the control channel not answering, which is not evidence either way about a resident:
 * `absent` has already taken the cases that prove nothing is there, so what is left is a state this
 * screen cannot see into. A filled mark there would be the frame asserting something it does not know,
 * and it would assert it on every frame, on every platform without named pipes, where `unreachable` is
 * not an edge case but the permanent answer.
 */
function toneDot(tone: ResidentTone): string {
  if (tone === 'idle') return '○';
  if (tone === 'pending') return '◌';
  if (tone === 'broken') return '?';
  return '●';
}

/**
 * What the resident is doing, in words, from the control answer alone.
 *
 * The `absent` case carries the one thing this file infers rather than transcribes, and it is a
 * deliberate exception: a missing data directory is a fact about the filesystem that the control client
 * has no way to report, and an operator told only "没有运行" would go looking for a process instead of
 * running `hikari init`. The directory is a value this surface was handed rather than something it
 * parsed out of a sentence, which is the line §6 draws.
 */
function describeResident(state: Pick<TuiState, 'control' | 'launching'>): string {
  if (state.launching) return '已按启动配置发出，正在等它应答…';
  if (state.control === undefined) return '正在询问…';

  const control = state.control;
  if (control.kind === 'answered') return control.outcome === 'ok' ? '正在运行。' : '正在运行，但它报告了失败。';
  if (control.kind === 'absent') return '没有运行。';
  return `无法访问控制通道：${oneLine(control.detail)}`;
}

/**
 * The colour a reply is drawn in, from its protocol outcome and nothing else.
 *
 * `refused` is yellow and not red, and that is a decision rather than a shade: the language plugin
 * declining to answer is the plugin working correctly, and painting a correct refusal as an error would
 * teach the human to distrust it. `failed` is the one that is red.
 */
function toneColorOf(tone: ReplyTone): readonly string[] {
  if (tone === 'failed') return [SGR_RED];
  if (tone === 'refused' || tone === 'absent' || tone === 'unreachable') return [SGR_YELLOW];
  return [SGR_CYAN];
}

// ---------------------------------------------------------------------------------------------
// The transcript, as lines
// ---------------------------------------------------------------------------------------------

/**
 * The window's entries, flattened to lines, oldest first.
 *
 * Reply and proactive lines are pushed through untouched — not indented, not coloured, not re-wrapped,
 * not escaped a second time. Both facts are deliberate. Indenting them would be this screen editing
 * text it was told to carry whole, which is why the speaker's name goes on a line of its own rather than
 * in a column beside the words. Escaping them again would be the same edit in a different direction:
 * they were escaped on the resident's side (`express.ts` runs every line it emits through `oneLine`),
 * and doing it twice would show a human backslashes the resident never sent.
 *
 * The values that *are* escaped here are the ones this file or the filesystem produced: a timestamp, a
 * notice carrying an exception message, the data directory. They have not been through anything.
 */
export function transcriptLines(entries: readonly TranscriptEntry[]): readonly Line[] {
  const lines: Line[] = [];

  for (const entry of entries) {
    if (lines.length > 0) lines.push([]);

    if (entry.kind === 'human') {
      lines.push([span(`你  ${entry.at}`, SGR_DIM)]);
      lines.push([span(oneLine(entry.text))]);
      continue;
    }

    if (entry.kind === 'notice') {
      lines.push([span(`·  ${entry.at}`, SGR_DIM)]);
      lines.push(...oneLine(entry.text).split('\n').map((text) => [span(text, SGR_DIM)]));
      continue;
    }

    if (entry.kind === 'proactive') {
      // A shape, not a bar. An inverted block is the loudest thing an 80-column terminal can draw, and
      // this line is one of the things on the screen rather than the most important of them — it was
      // outshouting the words it introduced. Bold and deliberately uncoloured: cyan two lines below
      // already means "a reply came back", and Hikari speaking first is not an outcome, so it does not
      // get to borrow a colour that means one.
      lines.push([span('◆ PROACTIVE', SGR_BOLD), span(`  ${entry.at}`, SGR_DIM)]);
      lines.push(...entry.lines.map((text): Line => [span(text)]));
      continue;
    }

    lines.push([span(`${toneLabel(entry.tone)}  ${entry.at}`, ...toneColorOf(entry.tone))]);
    lines.push(...entry.lines.map((text): Line => [span(text)]));
  }

  return lines;
}

/**
 * The slice of the flattened transcript that fits, `rows` long exactly.
 *
 * `scroll` counts lines back from the newest, so 0 is the live bottom and a larger number is further
 * into the past. Padding goes at the *top*, which is what keeps the input row still: a transcript that
 * grew downward from a fixed first row would move the input row up and down as the conversation grew,
 * and the thing a human is typing into should not move.
 */
export function windowTranscript(
  lines: readonly Line[],
  rows: number,
  scroll: number,
): readonly Line[] {
  const fits = Math.max(1, rows);
  const newest = Math.max(0, lines.length - fits);
  const from = Math.max(0, newest - Math.max(0, scroll));
  const visible = lines.slice(from, from + fits);
  const padding: Line[] = Array.from({ length: Math.max(0, fits - visible.length) }, () => []);
  return [...padding, ...visible];
}

// ---------------------------------------------------------------------------------------------
// The three bodies
// ---------------------------------------------------------------------------------------------

/**
 * The conversation, bottom-aligned, plus the two things that are not part of it.
 *
 * Neither extra line is an entry, and neither is ever added to the transcript — both are this screen
 * speaking about itself, which is why they are built here rather than appended as a `notice`. Adding
 * them as entries would make the window's own furniture survive a `/clear`, and would count against the
 * bound that exists to cap what a human said.
 */
function chatBody(state: TuiState, render: TuiRenderOptions): readonly Line[] {
  const rows = bodyRows(render);
  // One row is held back while a question is in flight so that the marker cannot evict the sentence it
  // is waiting on — the reply arrives *under* the question, and a pending line that scrolled its own
  // prompt off the top would be this screen hiding the thing it is asking about.
  const room = state.asking ? Math.max(1, rows - 1) : rows;
  const body = windowTranscript(transcriptLines(state.transcript), room, state.scroll);

  if (state.asking) return [...body, [span('◌ Hikari 在想…', SGR_DIM)]];

  if (body.every((line) => line.length === 0)) {
    // A window with nothing in it yet reads as a surface that has not finished loading. One dim line
    // says what to do instead — and it goes at the *bottom*, where the first sentence will appear, so
    // that nothing moves the moment someone types. Placed at the top it would jump a row on the first
    // keystroke, on the one screen where the human is watching the cursor.
    const hint: Line[] = [[span('直接输入一句话，或者输入 /help 看有哪些命令。', SGR_DIM)]];
    return [...body.slice(hint.length), ...hint];
  }

  return body;
}

function systemBody(state: TuiState, render: TuiRenderOptions): readonly Line[] {
  const rows = bodyRows(render);
  const lines: Line[] = [];
  lines.push([span('常驻', SGR_DIM), span('  '), span(`${toneDot(residentTone(state))} ${describeResident(state)}`, ...toneColor(residentTone(state)))]);

  const control = state.control;
  if (control !== undefined && control.kind === 'answered' && control.lines.length > 0) {
    lines.push([]);
    // Verbatim, whole, in the order they arrived. Not sorted, not filtered, not counted, not coloured,
    // and not searched for words. §6: the status lines are sentences the resident wrote for a person,
    // and a screen that read them into fields would be inventing a schema for a wire that never carried
    // one — and would then be the thing every later rewording of those sentences had to keep working.
    lines.push(...control.lines.map((text): Line => [span(text)]));
  }

  lines.push([], [span(`输入 /start 启动，/stop 停止，/restart 重启。status 的全部内容见 hikari status。`, SGR_DIM)]);
  return fitTo(lines, rows);
}

function profileBody(state: TuiState, render: TuiRenderOptions): readonly Line[] {
  const rows = bodyRows(render);
  const profile = state.profile;
  const lines: Line[] = [];

  if (profile.kind === 'unread') {
    lines.push([span('正在读取启动配置…', SGR_DIM)]);
    return fitTo(lines, rows);
  }
  if (profile.kind === 'none') {
    lines.push([span('这个数据目录没有启动配置。', SGR_DIM)]);
    lines.push([], [span('运行 hikari profile set 写完它之后，这里会显示它记住了什么。', SGR_DIM)]);
    return fitTo(lines, rows);
  }
  if (profile.kind === 'unreadable') {
    lines.push([span('启动配置无法读取。', SGR_YELLOW)]);
    lines.push([], [span(oneLine(profile.reason), SGR_YELLOW)]);
    return fitTo(lines, rows);
  }

  lines.push([span('启动配置', SGR_DIM), span('  '), span(oneLine(profile.path), SGR_DIM)]);
  lines.push([span('数据目录', SGR_DIM), span('  '), span(oneLine(state.dataDir))]);
  lines.push([]);
  for (const field of profile.fields) lines.push(fieldLine(field));
  lines.push([], [span('这里是「打算用什么启动」，不是「正在跑的是什么」。', SGR_DIM)]);
  return fitTo(lines, rows);
}

function fieldLine(field: ProfileField): Line {
  const label = `${field.label}：`;
  if (!field.set) return [span(label, SGR_DIM), span('未设置', SGR_DIM)];
  return [span(label, SGR_DIM), span(oneLine(field.value))];
}

/**
 * Exactly `rows` lines, starting at the top and dropping the tail if the view wrote more.
 *
 * Padding goes at the *bottom* here, and the opposite is right in `windowTranscript` — the difference is
 * what each body is. A conversation grows from its newest line and must keep the input row still, so it
 * pads above. A report is read from its first line down and has no such anchor, so padding above it
 * would leave the resident's status floating at the bottom of the window with a field of blanks over it,
 * which reads as content that failed to load rather than as a page with room to grow.
 *
 * Dropping is not silent. §6 forbids this screen summarizing the status lines, so a view that cannot
 * fit them must say that it could not and point at the command that prints all of them — a truncated
 * list presented as the whole list is a screen lying by omission, which is worse than a short one.
 */
function fitTo(lines: readonly Line[], rows: number): readonly Line[] {
  if (lines.length <= rows) {
    const padding: Line[] = Array.from({ length: rows - lines.length }, () => []);
    return [...lines, ...padding];
  }
  const kept = lines.slice(0, rows - 1);
  const dropped = lines.length - kept.length;
  return [...kept, [span(`…还有 ${dropped} 行没有显示。`, SGR_DIM)]];
}

// ---------------------------------------------------------------------------------------------
// The frame
// ---------------------------------------------------------------------------------------------

const VIEW_LABELS: ReadonlyMap<TuiViewName, string> = new Map([
  ['chat', 'Chat'],
  ['system', 'System'],
  ['profile', 'Profile'],
]);

/** The tab bar, with the current view inverted so it is legible without colour. */
function viewTabs(view: TuiViewName): Line {
  const tabs: Span[] = [];
  const names: readonly TuiViewName[] = ['chat', 'system', 'profile'];
  names.forEach((name, index) => {
    if (index > 0) tabs.push(span('  '));
    const label = ` ${VIEW_LABELS.get(name) ?? name} `;
    tabs.push(name === view ? span(label, SGR_INVERSE) : span(label, SGR_DIM));
  });
  return tabs;
}

/**
 * What delivery is doing, in the words of the client that knows.
 *
 * The three endings are kept apart because `SubscribeOutcome` keeps them apart: `ended` is a connection
 * that closed, `absent` is nothing listening, `unreachable` is something that went wrong getting there.
 * §9 forbids collapsing them into "Hikari 离线", which is the one sentence that would be wrong about all
 * three — the first is not a fault, the second says nothing about the resident, and the third is not
 * something the human can act on by starting anything.
 *
 * `absent` used to read `没有常驻在提供它`, which said something about the resident and was false when it
 * mattered. A resident only loads the delivery transport when at least one decider was configured for it
 * (`resident.ts` composes it with the deciders or not at all), so a resident can be running, answering
 * the control channel, and still leave this endpoint unserved — measured, not supposed: a probe started
 * a resident with no proactive flags, saw `status answered`, and got `absent` back from a subscription
 * against it. The line below therefore names the endpoint, which is the only thing the client's `ENOENT`
 * actually established.
 */
export function deliveryLabel(delivery: DeliveryState): string {
  if (delivery.kind === 'listening') return '主动投递 监听中';
  if (delivery.tone === 'ended') return '主动投递 已断开';
  if (delivery.tone === 'absent') return '主动投递 不可用（没有端点在提供它）';
  return `主动投递 不可用：${oneLine(delivery.detail)}`;
}

/**
 * Three rows, each with one job: what Hikari is doing, what this surface is doing, and which Hikari
 * this is.
 *
 * They are not merged because they are clipped independently, and clipping is by row: a single row
 * carrying the tabs, the delivery state and the data directory would lose whichever of the three came
 * last on a narrow window — which, on the window where it matters most, is the one saying the surface
 * is not going to be reached by Hikari at all. Split across rows, a narrow terminal shortens each of
 * them rather than deleting one.
 *
 * The model and the repository are deliberately absent. Their only source is the Launch Profile, and
 * the profile says what someone *intended* to start with — not what is running. A header reading its
 * values off the profile would state the wrong model, calmly and permanently, for any resident started
 * from a command line that differed from the file. §3 also rules out the alternative: no new probe, and
 * no reading the resident's status text for the configuration it prints there. The two values are shown
 * where their identity is honest — in the Profile view, labelled as what this data directory remembers.
 */
function headerLines(state: TuiState, render: TuiRenderOptions): readonly Line[] {
  const tone = residentTone(state);
  return [
    clip(
      [
        span('Hikari', SGR_BOLD),
        span('  '),
        span(`${toneDot(tone)} ${describeResident(state)}`, ...toneColor(tone)),
      ],
      render.columns,
    ),
    clip([...viewTabs(state.view), span('   '), span(deliveryLabel(state.delivery), SGR_DIM)], render.columns),
    clip([span('数据目录 ', SGR_DIM), span(oneLine(state.dataDir), SGR_DIM)], render.columns),
  ];
}

/**
 * The input row: the prompt, the text so far, and a cursor drawn as a block.
 *
 * The row scrolls left when the text is longer than the window, and the reason is the one thing about
 * this line that is not cosmetic: a one-line editor that only ever showed the beginning of its text
 * would leave the human typing blind past the right edge, with no indication that their Backspace was
 * deleting something they could not see. The scroll keeps the cursor visible and drops characters off
 * the *left*, which is where the oldest and least interesting part of a sentence is.
 */
export function inputLine(state: TuiState, render: TuiRenderOptions): Line {
  return editRow(state.edit, state.asking, render);
}

function editRow(edit: LineEdit, asking: boolean, render: TuiRenderOptions): Line {
  // `…` while a question is in flight, so that the state §5.3 describes has something on screen saying
  // so. Without it the only evidence of a pending ask would be a reply that has not arrived, and a
  // surface that looks idle while it is working invites the human to type the question again.
  const prompt = asking ? '…  ' : '> ';
  const available = Math.max(1, render.columns - displayWidth(prompt));

  const cursorAtEnd = edit.cursor >= edit.text.length;
  // One code point, not one code unit — and cutting the tail on the same boundary is the half the first
  // version of this line got wrong. The editor's cursor only ever lands on an astral character whole
  // (`stepBack`/`stepForward` refuse to split one), so `edit.text[edit.cursor]` there is a lone high
  // surrogate and `slice(cursor + 1)` starts the tail with its orphaned low half: a pasted emoji comes
  // out as two replacement boxes, and the frame holds malformed UTF-16 before a terminal ever sees it.
  // The width arithmetic below was wrong by a cell at the same time, because `displayWidth` was asked
  // about half a character.
  const under = cursorAtEnd ? ' ' : codePointAt(edit.text, edit.cursor);
  const tail = edit.text.slice(edit.cursor + under.length);

  // Drop from the front until the cursor fits. By code point, not by code unit: this text came from an
  // editor whose cursor moves by code point, and cutting a surrogate pair here would put a lone half on
  // the screen — the same half-character the editor's cursor arithmetic exists to avoid.
  const head = [...edit.text.slice(0, edit.cursor)];
  let headWidth = displayWidth(head.join(''));
  while (head.length > 0 && headWidth + displayWidth(under) > available) {
    const dropped = head.shift();
    if (dropped === undefined) break;
    headWidth -= displayWidth(dropped);
  }

  const keptTail = clipText(tail, available - headWidth - displayWidth(under));

  return [span(prompt, SGR_DIM), span(head.join('')), span(under, SGR_INVERSE), span(keptTail)];
}

/**
 * The whole code point starting at `at`, so that a surrogate pair is taken as one character.
 *
 * `String.prototype.slice` and indexing both count UTF-16 code units, which is right for the string and
 * wrong for the screen: a cursor sits between characters, not between the halves of one. The pair check
 * is explicit rather than a `for…of` walk because the caller already knows the index and a walk would
 * rebuild the prefix to find it.
 */
function codePointAt(text: string, at: number): string {
  const first = text.charCodeAt(at);
  const second = text.charCodeAt(at + 1);
  const isPair = first >= 0xd800 && first <= 0xdbff && second >= 0xdc00 && second <= 0xdfff;
  return text.slice(at, at + (isPair ? 2 : 1));
}

/** Plain-text truncation, used where there are no styles to preserve. */
function clipText(text: string, columns: number): string {
  if (columns <= 0) return '';
  if (displayWidth(text) <= columns) return text;
  let out = '';
  let used = 0;
  for (const character of text) {
    const size = displayWidth(character);
    if (used + size > columns - 1) break;
    out += character;
    used += size;
  }
  return `${out}…`;
}

/**
 * The keys this screen binds, on the last row.
 *
 * It exists because the alternative is a surface whose only navigation is undiscoverable. `Tab` cycles
 * the views, `PgUp`/`PgDn` scroll and `Ctrl+Q` leaves, and none of those three leaves a mark on the
 * screen that a human could find by looking — so a person who did not read the source would use the
 * chat line and never learn the rest was there.
 *
 * It is written in the same muted tone as every other piece of chrome, and it names no single-letter
 * key: the input line is a text field, so `q`, `s` and `r` belong to the sentence being typed. That is
 * the same constraint that removed the v0 console's `[q] 退出` bar, and it is worth restating here
 * because a hint row is exactly where someone would be tempted to put one back.
 */
function hintLine(): Line {
  return [span('Tab 切换视图   /help 命令   PgUp/PgDn 翻页   Ctrl+Q 退出', SGR_DIM)];
}

/**
 * The whole screen, as lines, at most `rows` of them.
 *
 * The clamp is not decoration. A frame taller than the window does not merely look wrong: writing the
 * last line scrolls the terminal, which moves everything the frame was carefully positioned against and
 * tears the top off the alternate screen. Every view is fitted to the window before it gets here; this
 * is the backstop that keeps a view added later from being able to break that property.
 */
export function renderScreen(state: TuiState, render: TuiRenderOptions = DEFAULT_RENDER): readonly string[] {
  const body =
    state.view === 'chat'
      ? chatBody(state, render)
      : state.view === 'system'
        ? systemBody(state, render)
        : profileBody(state, render);

  const lines: Line[] = [
    ...headerLines(state, render),
    rule(render),
    ...body,
    rule(render),
    clip(inputLine(state, render), render.columns),
    ...(hintRows(render) === 1 ? [clip(hintLine(), render.columns)] : []),
  ];

  return toFrameLines(lines, render);
}

/**
 * The prompt shown once, before the TUI proper, when no data directory was given.
 *
 * It survives from the v0 console rather than being replaced by a default, and the reason is unchanged:
 * there is no default directory and no remembered last one (`USAGE` says "没有默认值"), so the question
 * "which Hikari are you talking to" has a real answer that only the human has. Inventing a default here
 * would be this slice making a product decision about where a human's data lives, which is not a thing
 * a delivery of a user interface gets to decide on its own.
 *
 * It uses the same editor as the chat line and not a second one, so Backspace, the arrow keys and paste
 * behave identically in the first ten seconds of the program and every second after.
 */
export function renderAskScreen(
  edit: LineEdit,
  notice: string,
  render: TuiRenderOptions = DEFAULT_RENDER,
): readonly string[] {
  const lines: Line[] = [
    [span('Hikari', SGR_BOLD)],
    rule(render),
    [],
    [span('数据目录：', SGR_DIM)],
    [],
    clip(editRow(edit, false, render), render.columns),
    [],
    [span('输入一个数据目录后按 Enter；Esc 退出。', SGR_DIM)],
    [span('没有默认目录，也没有记住的上一次——这里问的就是你在跟哪一个 Hikari 说话。', SGR_DIM)],
  ];
  if (notice !== '') lines.push([], [span(oneLine(notice), SGR_YELLOW)]);
  return toFrameLines(lines, render);
}

function toFrameLines(lines: readonly Line[], render: TuiRenderOptions): readonly string[] {
  return lines
    .slice(0, Math.max(1, render.rows))
    .map((line) => emit(clip(line, render.columns), render.color));
}

function frameBytes(lines: readonly string[]): string {
  return HOME + lines.map((line) => `${line}${CLEAR_LINE}`).join('\n') + ERASE_BELOW;
}

/**
 * One frame, as the bytes that go to the terminal: home, every line cleared to its own end, then the
 * whole tail below the frame erased.
 *
 * The three parts are separate claims. `HOME` puts the frame back at the top-left, so no scrolling or
 * cursor arithmetic is needed between frames. The per-line clear removes whatever the previous frame had
 * to the right of this one. The erase-below removes whatever it had *underneath* — which is the part
 * that matters when a Tab or a stopped resident makes the new frame shorter than the old one.
 */
export function renderFrame(state: TuiState, render: TuiRenderOptions = DEFAULT_RENDER): string {
  return frameBytes(renderScreen(state, render));
}

export function renderAskFrame(
  edit: LineEdit,
  notice: string,
  render: TuiRenderOptions = DEFAULT_RENDER,
): string {
  return frameBytes(renderAskScreen(edit, notice, render));
}

/** What is written to the terminal when the TUI takes the screen, and when it gives it back. */
export const ENTER_SCREEN = `${ALT_SCREEN_ON}${CURSOR_HIDE}${CLEAR_SCREEN}`;
export const LEAVE_SCREEN = `${CURSOR_SHOW}${ALT_SCREEN_OFF}`;
export { SGR_INVERSE };
