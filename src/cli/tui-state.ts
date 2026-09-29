// What the TUI knows, and what a keystroke does to it.
//
// This file is pure on purpose, and the purity is load-bearing rather than tidy. Almost every rule the
// mandate states about this slice is a rule about *deciding* something — whether a line is a sentence or
// an instruction, whether a second question may be sent, what a reply is labelled, when the transcript
// drops its oldest entry — and none of those rules is about a terminal. Keeping them here means they can
// be checked without a TTY, which matters beyond convenience: this build is developed on a machine where
// the interactive half cannot be driven automatically at all, so a rule that only exists inside the
// key handler is a rule with no evidence behind it.
//
// What is deliberately *not* here: any call to an endpoint. `decideSubmit` returns what should happen and
// the loop performs it. A pure function that could reach the network would not be one, and the split has
// a second benefit worth naming — the decision table below is the whole of the TUI's opinion about the
// human's input, so "the TUI does not interpret a sentence" is a claim about a function of forty lines
// rather than about a program.

import { parseSlashCommand, type LineEdit, type SlashCommand } from './tui-input.js';

// ---------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------

/**
 * The three screens, in Tab order.
 *
 * The order is not arbitrary: Chat is first because it is the default, and the two views an operator
 * visits in passing follow it. Tab is the only way between them, so the cycle is the whole navigation
 * model and the array below *is* the model rather than a mirror of it.
 */
export type TuiViewName = 'chat' | 'system' | 'profile';

export const VIEW_ORDER: readonly TuiViewName[] = ['chat', 'system', 'profile'];

export function nextView(view: TuiViewName): TuiViewName {
  const at = VIEW_ORDER.indexOf(view);
  // `indexOf` cannot return -1 for a value of this type, and the fallback is here rather than a `!`
  // because the alternative — asserting the element exists — is a lie the compiler would accept and a
  // reader would have to re-derive. Landing on Chat is the harmless reading of an impossible branch.
  return VIEW_ORDER[(at + 1) % VIEW_ORDER.length] ?? 'chat';
}

// ---------------------------------------------------------------------------------------------
// The transcript
// ---------------------------------------------------------------------------------------------

/**
 * How many entries the window keeps.
 *
 * A local memory bound, not a product threshold: nothing in Hikari is being promised by it and no
 * human was consulted about it, which is exactly why it is allowed to be an arbitrary round number.
 * What matters is that it *is* bounded — a long-running surface that only ever appended would grow
 * without limit for as long as someone left it open, and last week's conversation is not worth an
 * unbounded process.
 */
export const TRANSCRIPT_LIMIT = 200;

/**
 * A line in the window, and the four things it can be.
 *
 * §9 names three. The fourth is this surface speaking in its own voice — a refusal, the answer to
 * `/help`, the note that a paste was cut — and it is kept as its own kind rather than folded into the
 * others so that nothing in the window can be mistaken for something Hikari said. A `notice` is this
 * program talking; a `reply` is Hikari answering; the two are never the same object, and the renderer
 * gives them different marks.
 *
 * `reply.log` of the six outcomes is the protocol's own list, not a summary of it: `chatted`,
 * `answered`, `refused` and `failed` are the language plugin's four words for what it did, and `absent`
 * and `unreachable` are the two the client distinguishes when nothing came back. §9 forbids merging
 * them, so the type does not give anyone the chance — there is no `error` member that three of them
 * could be collapsed into.
 */
export type ReplyTone = 'chatted' | 'answered' | 'refused' | 'failed' | 'absent' | 'unreachable';

export type TranscriptEntry =
  | { readonly kind: 'human'; readonly at: string; readonly text: string }
  | { readonly kind: 'reply'; readonly at: string; readonly tone: ReplyTone; readonly lines: readonly string[] }
  | { readonly kind: 'proactive'; readonly at: string; readonly lines: readonly string[] }
  | { readonly kind: 'notice'; readonly at: string; readonly text: string };

/**
 * Append one entry, dropping the oldest if that would exceed the bound.
 *
 * Dropping is silent on purpose, and the reason is that the alternative is worse. A visible "一些较早的内容已经不在窗口里" line would itself be an entry, so it would evict another one to say so and eventually the window would be mostly notices about notices. The content is gone either way; saying so once per eviction costs the human the content they could still read.
 */
export function appendEntry(
  transcript: readonly TranscriptEntry[],
  entry: TranscriptEntry,
): readonly TranscriptEntry[] {
  const grown = [...transcript, entry];
  return grown.length <= TRANSCRIPT_LIMIT ? grown : grown.slice(grown.length - TRANSCRIPT_LIMIT);
}

/**
 * Whether the window should say that the resident's continuity and its own are different things.
 *
 * §7 is a naming discipline with a visible consequence, and this is where the consequence lands. The
 * window survives a resident restart because it belongs to *this process*; nothing about that fact says
 * Hikari still knows what was said. Left unsaid, the natural reading of a screen that still shows the
 * conversation after `systemctl restart hikari`-shaped operations is that Hikari remembers it — and that
 * reading would be wrong in the direction that costs the human most, because they would rely on it.
 *
 * So the rule is stated once, as a function, so that it cannot drift out of the render: the marker
 * appears exactly when there is something above it that survived a restart, which is to say when a
 * launch has been observed *and* the window is not empty.
 */
export function memoryMarkerNeeded(transcript: readonly TranscriptEntry[], launched: boolean): boolean {
  return launched && transcript.length > 0;
}

export const MEMORY_MARKER = '本机窗口：这些内容只在这个进程里，Hikari 不记得它。';

// ---------------------------------------------------------------------------------------------
// The whole of what the TUI knows
// ---------------------------------------------------------------------------------------------

/**
 * What the delivery subscription is doing, as far as its client can tell.
 *
 * There is no `connected`, and its absence is the honest part. `subscribeToHumanDelivery` resolves when
 * the subscription *ends* and at no other time — the promise is the lifetime of the connection — so a
 * client that is quietly and correctly connected looks exactly like one still dialling. Calling that
 * state "connected" would be this screen asserting something the wire never told it; calling it
 * "listening" is what is true from here, which is that an attempt is open and nothing has ended it.
 *
 * The three endings are kept apart rather than collapsed into one "unavailable", because the client
 * already told them apart and §8 says so: `ended` is a connection that closed (the resident stopped, was
 * restarted, or another listener had the endpoint), `absent` is nothing serving the endpoint, and
 * `unreachable` is something going wrong on the way. "Hikari 离线" would be wrong about all three.
 */
export type DeliveryState =
  | { readonly kind: 'listening' }
  | { readonly kind: 'stopped'; readonly tone: 'ended' | 'absent' | 'unreachable'; readonly detail: string };

export interface TuiState {
  readonly dataDir: string;
  readonly view: TuiViewName;
  readonly edit: LineEdit;
  readonly transcript: readonly TranscriptEntry[];
  /** Lines scrolled back from the newest. 0 is the live bottom. */
  readonly scroll: number;
  /** True while one ask is in flight. §5.3: at most one, and it does not block anything else. */
  readonly asking: boolean;
  /** The resident's last answer, or undefined before the first one arrives. */
  readonly control: ControlOutcomeView | undefined;
  readonly launching: boolean;
  /**
   * True while a stop-then-start sequence is in flight, which is a different thing from `launching`.
   *
   * `launching` is what the header reads to say the resident has been asked to start and has not answered
   * yet. During the stop and the wait that precedes a restart nothing has been launched at all, so it is
   * not true then — and the two-second poll rewrites `launching` on every pass, so it could not hold a
   * gate across the sequence even if it were. This field holds nothing but the gate: it is not rendered,
   * and it is not a second opinion about the resident's state.
   */
  readonly restarting: boolean;
  readonly delivery: DeliveryState;
  /** The launch profile as last read, or the reason it could not be. Re-read when the view opens. */
  readonly profile: ProfileView;
}

/**
 * The control answer, narrowed to what a screen is allowed to use.
 *
 * `lines` is carried whole and typed as opaque strings; nothing in this module reads inside it, and the
 * type gives no field to read. §6's prohibition is enforced by there being nothing to parse rather than
 * by a comment asking nicely.
 */
export type ControlOutcomeView =
  | { readonly kind: 'answered'; readonly outcome: 'ok' | 'failed'; readonly lines: readonly string[] }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreachable'; readonly detail: string };

export type ProfileView =
  | { readonly kind: 'unread' }
  | { readonly kind: 'none' }
  | { readonly kind: 'unreadable'; readonly reason: string }
  | { readonly kind: 'profile'; readonly path: string; readonly fields: readonly ProfileField[] };

/**
 * One line of the profile view: a label and a value that Hikari already holds.
 *
 * The value is a `string` here because the renderer only ever places it in a frame. Every one of them is
 * derived from a typed field by `readProfile`, so §7's rule — no reverse-engineering the equivalent
 * command line — is satisfied by where these come from rather than by anything this type can enforce.
 * The one place it could be violated is the function that builds them, and that function reads a parsed
 * object and nothing else.
 */
export interface ProfileField {
  readonly label: string;
  readonly value: string;
  /** Absent when the profile simply does not set this. Never an empty string standing in for "no". */
  readonly set: boolean;
}

export function initialState(dataDir: string): TuiState {
  return {
    dataDir,
    view: 'chat',
    edit: { text: '', cursor: 0 },
    transcript: [],
    scroll: 0,
    asking: false,
    control: undefined,
    launching: false,
    restarting: false,
    delivery: { kind: 'listening' },
    profile: { kind: 'unread' },
  };
}

// ---------------------------------------------------------------------------------------------
// What Enter does
// ---------------------------------------------------------------------------------------------

/**
 * What to do with a submitted line — the entire input policy, in one place.
 *
 * Read the order of the checks, because the order is the rule §5.2 is most easily broken by:
 *
 *   1. An empty line submits nothing. Sending `""` to a model spends a model call to ask nothing, and
 *      an empty line is at least as often a slipped Enter as it is a question.
 *   2. The vocabulary is consulted next, and only for a line whose *first character* is `/`. That test
 *      is the whole of the intent detection this program is allowed to do. `帮我重启` reaches the model
 *      because nothing here has a verb list to match it against — not because it was considered and
 *      rejected, but because there is no mechanism that could have considered it.
 *   3. One ask at a time, and it applies only to sentences. A local command is not an ask: `/stop` while
 *      a question is in flight is a thing an operator may well need, and refusing it would make the one
 *      screen that can stop a runaway resident unavailable exactly when it is wanted.
 *
 * Both tests are made on `line.trim()` and the sentence that is *sent* is `line` — the two are not the
 * same string, and the difference is the point. Trimming decides whether there is anything to submit at
 * all, and nothing else: `"   "` is a slipped Enter rather than a question, so it submits nothing. What
 * goes to the model is what the human typed, byte for byte. A `trim()` on the way out would be this
 * screen editing a sentence it has no business editing — the same act as rewording it, one space at a
 * time — and it would be invisible, because nobody reads their own trailing whitespace back.
 */
export type SubmitDecision =
  | { readonly kind: 'empty' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'ask'; readonly text: string }
  | { readonly kind: 'command'; readonly command: SlashCommand };

export function decideSubmit(state: Pick<TuiState, 'asking'>, line: string): SubmitDecision {
  if (line.trim() === '') return { kind: 'empty' };

  const slash = parseSlashCommand(line);
  if (slash.kind === 'command') return { kind: 'command', command: slash.command };
  if (slash.kind === 'unknown') return { kind: 'refused', reason: `没有这个命令：${slash.word}。输入 /help 看有哪些。` };

  if (state.asking) return { kind: 'busy' };
  return { kind: 'ask', text: line };
}

/**
 * The state after `/clear`, which is a screen forgetting and nothing else.
 *
 * §5.4 is a statement about *scope*, and scope is best expressed as the list of things a function does
 * not touch. There is no call here to the language plugin, to the chronicle, to memory, or to the
 * resident's control channel — and no field of the returned state other than these two changed. The
 * transcript belongs to this process, so emptying it costs nothing anyone else was relying on; the
 * dialogue context belongs to the resident, so a surface that emptied it would be reaching into another
 * process to delete something its owner still has.
 *
 * It exists as a function rather than as two lines in the key handler for the reason everything in this
 * file does: a rule that only exists inside a loop with a terminal cannot be checked on a machine with
 * no terminal, and this is one of the rules most likely to be got wrong by a later edit that "also"
 * resets something.
 */
export function afterClear(state: TuiState): TuiState {
  return { ...state, transcript: [], scroll: 0 };
}

/**
 * The six words the protocol's outcomes are shown under.
 *
 * They are translated for the screen and for nothing else — the tone itself is carried through
 * unchanged, and this function is the only place a language-specific word for it exists. `refused` is
 * deliberately not red and not called a failure: the plugin declining to answer is it working, and a
 * screen that painted it as an error would be teaching the human to distrust a correct refusal.
 *
 * The last two labels name the *language entry* rather than the resident, and that is a correction
 * rather than a style. `absent` was labelled `没有常驻` until it was seen on a screen next to a header
 * reading `正在运行。` — and both were true, because the client's `absent` covers two situations it
 * spells out in its own lines: nothing is running, or a resident was started without a model and so
 * loaded no language plugin. A label saying "there is no resident" is false in the second case, and it
 * is false in the direction §9 forbids — it reports the resident as gone when the resident is fine and
 * only its language entry is missing. The client's own sentence already drew that distinction carefully
 * ("没有正在提供语言入口的 ... 常驻"); a label above it must not throw the qualifier away.
 */
export function toneLabel(tone: ReplyTone): string {
  if (tone === 'chatted') return 'Hikari';
  if (tone === 'answered') return 'Hikari';
  if (tone === 'refused') return 'Hikari（没有回答）';
  if (tone === 'failed') return 'Hikari（失败）';
  if (tone === 'absent') return '没有语言入口';
  return '联系不上语言入口';
}

/** Which of the six came back, from the client's own outcome. No merging, no default. */
export function toneOfReplied(reply: { readonly outcome: 'chatted' | 'answered' | 'refused' | 'failed' }): ReplyTone {
  return reply.outcome;
}
