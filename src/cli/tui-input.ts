// What a keystroke means to the TUI: the single-line editor, the closed slash vocabulary, and the
// view/navigation keys that are not text at all.
//
// Everything here is pure and terminal-free, and the reason this surface keeps the split at all is that
// a rule about what counts as input is worth being able to state without owning a terminal — a test that
// has to open a TTY to check a Backspace checks nothing on a machine that has none.
//
// The line editor is the part with real content. It is a one-line editor over the text a human is
// composing, and the two decisions it makes are worth naming before the code:
//
//   * The cursor moves by code point, not by UTF-16 code unit. `text.slice(0, cursor)` with a cursor
//     that can land between a surrogate pair renders half of an astral character, and the failure is
//     not cosmetic — the terminal is handed a lone surrogate, which most of them draw as a replacement
//     box and some of them refuse. This command line already takes a data directory named
//     `D:\项目\hikari` whole rather than dropping what it cannot encode, so it does not get to mangle
//     one of its characters one editor later either.
//
//   * A control character is refused rather than inserted, and the refusal is visible. The reason is the
//     one this file keeps giving: a control character hidden inside a sentence fails later for a reason
//     nobody can see, and a keystroke that silently does nothing is indistinguishable from a dead
//     keyboard.
//
// Escape sequences are matched exactly rather than by prefix. In raw mode a chunk is usually one
// keystroke, but it is not guaranteed to be, and a rule like "any chunk starting with ESC means Left"
// would turn an unrecognised sequence — or a paste that begins with one — into a cursor jump.

/** The text being composed and where the cursor sits inside it, in UTF-16 code units. */
export interface LineEdit {
  readonly text: string;
  readonly cursor: number;
}

export const EMPTY_EDIT: LineEdit = { text: '', cursor: 0 };

export type EditResult =
  | { readonly kind: 'editing'; readonly edit: LineEdit }
  | { readonly kind: 'submitted'; readonly text: string; readonly dropped: boolean }
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'ignored' };

// The keys that are answers rather than text. `\r` and `\n` are both here because a terminal in raw
// mode sends one or the other depending on platform and on whether the key was Return or Enter on the
// numeric pad, and this build is only ever asked to care about the Windows console.
const ENTER = ['\r', '\n'];
const BACKSPACE = ['\x7f', '\b'];

const LEFT = ['\x1b[D', '\x1bOD'];
const RIGHT = ['\x1b[C', '\x1bOC'];
// `\x1b[H`/`\x1b[F` are the "cursor position" form; `\x1b[1~`/`\x1b[4~` are the "home/end" form the
// Windows console sends. Both spellings exist in the wild and both mean the same thing, so both are
// listed rather than one being declared canonical.
const HOME = ['\x1b[H', '\x1b[1~', '\x1bOH'];
const END = ['\x1b[F', '\x1b[4~', '\x1bOF'];
const DELETE = ['\x1b[3~'];
const BACKSPACE_WORD = ['\x17']; // Ctrl+W
const CLEAR_LINE = ['\x15']; // Ctrl+U

/**
 * One chunk of input on the chat line, as an operation on the edit.
 *
 * A chunk is not always one key. A pasted sentence arrives whole, and copied text very often carries a
 * trailing newline with it. So a line terminator anywhere in the chunk means submit, which is also what
 * the data-directory prompt does — the two prompts share this one function, and `dropped` is how the
 * caller that has a tail worth reporting is told about it. The one exception is a chunk whose *first*
 * line is blank, which is a paste rather than a submit; the reason is argued where it is implemented.
 *
 * `dropped` is the one place this file departs from that precedent, and it exists because the two
 * prompts are not the same shape. The data-directory prompt asks for a path: text after a newline is
 * not a path anyone meant to type, so discarding it silently costs nothing. The chat line takes a
 * sentence a human composed, and a multi-line paste is a real thing they might do. Dropping the tail
 * without saying so would be this file editing their words by deletion — the one thing §4 rules out —
 * so the tail is dropped and *reported*. A plain paste with a trailing newline has nothing but
 * whitespace after the terminator, which is not a second line and does not count as one.
 */
export function editLine(edit: LineEdit, chunk: string): EditResult {
  if (chunk === '') return { kind: 'ignored' };

  // A paste whose first line is blank is not a submit, and this is a correction the first version of
  // this function needed. "A line terminator anywhere means submit" reads a leading blank line as
  // "submit the line before it", and there is no line before it: `head` is empty, so the submitted text
  // is whatever the editor already held — and with the editor empty that is an empty submit, which the
  // caller drops without a word, because an empty line is normally just a slipped Enter. Copied text
  // very often begins with a blank line, so a pasted sentence disappeared from a screen that said
  // nothing at all, not even the notice the caller shows for a paste whose *tail* it cut.
  //
  // A run of leading blank lines that has real content after it is clipboard noise, then, and is
  // stripped before anything below reads the chunk. A bare Enter does not qualify — it has nothing after
  // the terminator, so it still submits the line the human was on — and neither does a chunk whose first
  // line has anything on it, which is the case the paragraphs above are not about.
  //
  // A loop rather than a self-call: the depth of a paste is the human's clipboard and not this file's
  // business, and each pass consumes at least one newline, so it ends.
  let body = chunk;
  for (;;) {
    const at = body.search(/[\r\n]/);
    if (at === -1) break;
    if (body.slice(0, at).trim() !== '') break;
    const rest = body.slice(at).replace(/^[\r\n]+/, '');
    if (rest.trim() === '') break;
    body = rest;
  }

  const terminator = body.search(/[\r\n]/);
  if (terminator !== -1) {
    const head = body.slice(0, terminator);
    const tail = body.slice(terminator).replace(/^[\r\n]+/, '').trim();
    const inserted = applyText(edit, head);
    if (inserted.kind === 'refused') return inserted;
    return { kind: 'submitted', text: inserted.edit.text, dropped: tail !== '' };
  }

  if (BACKSPACE.includes(body)) {
    if (edit.cursor === 0) return { kind: 'ignored' };
    const from = stepBack(edit.text, edit.cursor);
    return { kind: 'editing', edit: { text: edit.text.slice(0, from) + edit.text.slice(edit.cursor), cursor: from } };
  }

  if (DELETE.includes(body)) {
    if (edit.cursor >= edit.text.length) return { kind: 'ignored' };
    const to = stepForward(edit.text, edit.cursor);
    return { kind: 'editing', edit: { text: edit.text.slice(0, edit.cursor) + edit.text.slice(to), cursor: edit.cursor } };
  }

  if (LEFT.includes(body)) {
    return edit.cursor === 0 ? { kind: 'ignored' } : { kind: 'editing', edit: { ...edit, cursor: stepBack(edit.text, edit.cursor) } };
  }

  if (RIGHT.includes(body)) {
    return edit.cursor >= edit.text.length
      ? { kind: 'ignored' }
      : { kind: 'editing', edit: { ...edit, cursor: stepForward(edit.text, edit.cursor) } };
  }

  if (HOME.includes(body)) return edit.cursor === 0 ? { kind: 'ignored' } : { kind: 'editing', edit: { ...edit, cursor: 0 } };
  if (END.includes(body)) {
    return edit.cursor === edit.text.length ? { kind: 'ignored' } : { kind: 'editing', edit: { ...edit, cursor: edit.text.length } };
  }

  if (CLEAR_LINE.includes(body)) return edit.text === '' ? { kind: 'ignored' } : { kind: 'editing', edit: { text: '', cursor: 0 } };

  if (BACKSPACE_WORD.includes(body)) {
    if (edit.cursor === 0) return { kind: 'ignored' };
    let from = edit.cursor;
    while (from > 0 && /\s/.test(edit.text[from - 1] ?? '')) from -= 1;
    while (from > 0 && !/\s/.test(edit.text[from - 1] ?? '')) from -= 1;
    return { kind: 'editing', edit: { text: edit.text.slice(0, from) + edit.text.slice(edit.cursor), cursor: from } };
  }

  // Anything else beginning with ESC is an escape sequence this build does not bind. Ignoring it is
  // not the same as ignoring a character: the alternative — inserting it — would put invisible bytes
  // in the human's sentence, and the alternative the old console took — treating a leading ESC as
  // "quit" — would close the TUI on an unrecognised function key.
  if (body.startsWith('\x1b')) return { kind: 'ignored' };

  return applyText(edit, body);
}

/** Insert-or-refuse, the only two things inserting text can do. Narrower than `EditResult` so that a
 *  caller which needs the resulting edit — the submit path, which must hand back the text it just
 *  inserted — does not have to re-check for the members this function cannot return. */
type ApplyResult =
  | { readonly kind: 'editing'; readonly edit: LineEdit }
  | { readonly kind: 'refused'; readonly reason: string };

function applyText(edit: LineEdit, text: string): ApplyResult {
  if (text === '') return { kind: 'editing', edit };
  if (/[\x00-\x1f\x7f]/.test(text)) return { kind: 'refused', reason: '输入里有控制字符，这一段没有被写进去。' };
  return {
    kind: 'editing',
    edit: { text: edit.text.slice(0, edit.cursor) + text + edit.text.slice(edit.cursor), cursor: edit.cursor + text.length },
  };
}

/** One code point to the left, so a surrogate pair is stepped over rather than into. */
function stepBack(text: string, cursor: number): number {
  if (cursor <= 0) return 0;
  const previous = text.charCodeAt(cursor - 1);
  const isLowSurrogate = previous >= 0xdc00 && previous <= 0xdfff;
  return cursor >= 2 && isLowSurrogate && isHighSurrogate(text.charCodeAt(cursor - 2)) ? cursor - 2 : cursor - 1;
}

/** One code point to the right, by the same rule. */
function stepForward(text: string, cursor: number): number {
  if (cursor >= text.length) return text.length;
  return isHighSurrogate(text.charCodeAt(cursor)) && cursor + 1 < text.length ? cursor + 2 : cursor + 1;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

// ---------------------------------------------------------------------------------------------
// The slash vocabulary: closed, and the only thing the TUI reads as an instruction
// ---------------------------------------------------------------------------------------------

/**
 * The eight local commands, and the whole of what the TUI will treat as one.
 *
 * §5.2 makes this a closed set, and the closure is the load-bearing part rather than the list: the
 * TUI is a surface that hands a sentence to the Language endpoint unchanged, so the one thing it must
 * never do is look at a sentence and decide it was really an instruction. `帮我重启` is a sentence a
 * human typed and it goes to Hikari; `/restart` is an instruction and this file runs it. The test
 * separating them is the leading `/` and nothing else — no keyword table, no verb list, no scoring.
 *
 * That is also why an unrecognised `/word` is a *reported mistake* rather than text passed through.
 * The `/` already said the human meant an instruction; forwarding `\/hlep` to the model would spend a
 * model call to answer a typo, and the human would be looking at Hikari's prose wondering why their
 * command was ignored.
 */
export type SlashCommand =
  | { readonly kind: 'help' }
  | { readonly kind: 'clear' }
  | { readonly kind: 'status' }
  | { readonly kind: 'start' }
  | { readonly kind: 'stop' }
  | { readonly kind: 'restart' }
  | { readonly kind: 'profile' }
  | { readonly kind: 'quit' };

const SLASH_COMMANDS: ReadonlyMap<string, SlashCommand['kind']> = new Map([
  ['/help', 'help'],
  ['/clear', 'clear'],
  ['/status', 'status'],
  ['/start', 'start'],
  ['/stop', 'stop'],
  ['/restart', 'restart'],
  ['/profile', 'profile'],
  ['/quit', 'quit'],
]);

export type SlashParse =
  | { readonly kind: 'none' }
  | { readonly kind: 'command'; readonly command: SlashCommand }
  | { readonly kind: 'unknown'; readonly word: string };

/**
 * Read a submitted line as a local command, or as nothing at all.
 *
 * Only the *first token* is ever consulted, so `/status 一下` is `/status` with an argument rather
 * than an unknown command — and the argument is dropped rather than forwarded, because none of the
 * eight takes one and inventing an argument grammar for commands that have none would be building the
 * routing table this file exists not to have.
 *
 * The comparison is exact and case-sensitive. `/Help` is not `/help`: the vocabulary is eight literal
 * strings, and a reader that folded case would be a reader with a normalisation rule, which is one
 * step short of the intent-guessing this whole split is arranged to prevent.
 */
export function parseSlashCommand(line: string): SlashParse {
  if (!line.startsWith('/')) return { kind: 'none' };

  const word = line.split(/\s/)[0] ?? '';
  const command = SLASH_COMMANDS.get(word);
  return command === undefined ? { kind: 'unknown', word } : { kind: 'command', command: { kind: command } };
}

// ---------------------------------------------------------------------------------------------
// Keys that are not text
// ---------------------------------------------------------------------------------------------

/**
 * The three keys the TUI itself binds, named so the loop does not spell escape sequences inline.
 *
 * There is deliberately no single-letter key here. Chat is the default view and its input line is a
 * text field, so `q`, `s`, `x` and `r` have to be ordinary characters — the v0 console's `[q] 退出`
 * bar cannot survive a screen where `q` is the first letter of a word someone is typing. What is left
 * is the three keys whose sequences a terminal will not confuse with typing, plus the two control
 * chords.
 */
export type TuiKey = 'next-view' | 'scroll-up' | 'scroll-down' | 'quit';

export function readTuiKey(chunk: string): TuiKey | undefined {
  if (chunk === '\t') return 'next-view';
  if (chunk === '\x1b[5~') return 'scroll-up';
  if (chunk === '\x1b[6~') return 'scroll-down';
  // Ctrl+Q. Not Ctrl+C, which the terminal owns: a human who reaches for Ctrl+C means "stop this
  // program", and a TUI that swallowed it would be a process they could not interrupt from the
  // keyboard they are already using.
  if (chunk === '\x11') return 'quit';
  return undefined;
}

/**
 * Whether a chunk is an interrupt, which the TUI honours by quitting rather than by pretending it did
 * not arrive.
 *
 * Ctrl+C and Ctrl+D are here rather than in `readTuiKey` because they are not bindings — they are the
 * terminal's own, and the only question this file gets to answer is what happens next. What happens
 * next is quitting, which is what they mean everywhere, and which is deliberately *not* stopping the
 * resident: §10 of the mandate is that leaving the TUI is not stopping Hikari, and quitting is the
 * only thing these keys can sensibly do to a surface whose job is to be left open.
 */
export function isInterrupt(chunk: string): boolean {
  return chunk === '\x03' || chunk === '\x04';
}
