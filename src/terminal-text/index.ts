// What a line of somebody else's text may not do to the terminal that prints it.
//
// This was written first inside `src/desktop-session-observe/presentation.ts`, and it lives here now
// because that module stopped being its only caller. The move is an extraction and not a redesign:
// the rule, the ranges and the reasoning below are the same ones, unchanged.
//
// Why it is a module rather than a copy. The thing being defended against is *content impersonating
// the surface that prints it*, and that is not a property of the desktop session observation — it is
// a property of any human-facing line that carries text this repository did not write. A second
// caller that copied the rule would be a second statement of it, and the day the two disagree the
// disagreement is invisible: both surfaces still print, and only one of them is still safe. So the
// consumer that arrived second is what makes this the owner of the rule rather than a duplicate.
//
// What this deliberately is not: a renderer, a message type, a `Presentation` layer, a formatter, or
// a framework. It has one function, it takes a string and returns a string, it holds nothing, orders
// nothing and knows no vocabulary. The shape of an answer stays with the module that owns the answer,
// which is why this file has no header, no separator and no opinion about lines beyond "one is one".

// A rendered line is exactly one line, enforced rather than assumed.
//
// The window title is the one free-text field the desktop surface carries, and nothing upstream cleans
// it: the Win32 read is `StringBuilder` -> `ToString()` -> the World's observation -> the renderer.
//
// Measured rather than assumed. A window whose caption was set to two lines read back through
// `GetWindowTextW` — the same call `src/foreground/windows.ts` makes — as 19 characters with the line
// feed still in it, and nothing in the acquisition strips it.
//
// Joined with a newline for a terminal, that one title becomes two printed lines. A title is free
// text, so the second line can be made to read `判词：stable`, and a human would then be looking at
// two contradicting verdicts, one of which was never a judgement Hikari made. That is exactly the
// failure the desktop surface exists to prevent, arriving through the one field that carries somebody
// else's bytes.
//
// The same free-text field reaches the terminal by a second road, and it is the more direct one. A
// line break only lets a title add a line; an escape sequence lets it *rewrite the screen the lines
// are printed on*. A title carrying `ESC [ 2 J` clears the display, `ESC [ 3 1 m` recolors what
// follows, and a cursor-positioning sequence puts a fabricated `判词：stable` wherever it likes —
// erasing the real one as it does. Measured, not supposed: a title set to such a sequence arrives
// through the Win32 read and the renderer returns it with the ESC bytes intact, and a terminal
// executes them. Where the line break forges one extra line, this forges the whole screen.
//
// So the rule covers control characters as a class rather than line breaks as a list. Both roads are
// the same failure — content impersonating the surface — and a rule that enumerated only the first
// would have to be extended again for the next one.
//
// Escaping is not a loss of fidelity. The text is still carried verbatim in content — nothing is
// dropped, truncated, summarized or reworded — it simply can no longer impersonate the surface's own
// structure, which is what makes a transcription checkable in the first place. A title that truly
// contains an escape character renders as its code point written out in text, which is the honest
// thing to show a human: the byte is real, and it is not the terminal's to act on.
//
// `0x09` (tab) is deliberately left alone. It is a control character that cannot begin a new line and
// cannot move the cursor somewhere a verdict could be forged, so preserving it is the more faithful
// reading of "verbatim" — the one case where fidelity costs nothing.
//
// Spelled as code points rather than as escapes or literal characters so that this file contains no
// invisible bytes: a rule about invisible characters is a poor place to hide some.
const LINE_BREAKS: ReadonlyMap<number, string> = new Map([
  [0x0d, '\\r'],
  [0x0a, '\\n'],
  [0x0b, '\\v'],
  [0x0c, '\\f'],
  [0x85, '\\u0085'],
  [0x2028, '\\u2028'],
  [0x2029, '\\u2029'],
]);

// C0 (including ESC and BEL), DEL, and C1 — the ranges a terminal reads as instructions rather than
// as text. Named spellings are used for the line breaks above because those are the ones a human
// meets most often; everything else gets its code point, which says exactly which byte was there.
function isControl(code: number): boolean {
  if (code === 0x09) return false;
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}

/**
 * The same text, with every character a terminal would act on written out instead.
 *
 * Applied to a whole rendered line rather than to the fields that need it today, so that "one element
 * is one line" is a property of what a renderer returns rather than a hope about its inputs — a field
 * added later cannot quietly reopen the hole.
 */
export function oneLine(value: string): string {
  let escaped = '';
  for (const character of value) {
    const code = character.codePointAt(0) ?? -1;
    const named = LINE_BREAKS.get(code);
    if (named !== undefined) {
      escaped += named;
    } else if (isControl(code)) {
      escaped += `\\u${code.toString(16).padStart(4, '0')}`;
    } else {
      escaped += character;
    }
  }
  return escaped;
}
