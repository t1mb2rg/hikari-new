// `hikari content status` — a human asking a running Hikari what is in the window it last saw them in.
//
// This file writes no message of its own on the success path, and that is the whole design. The plugin
// holding the read is the only thing that knows which window was read, what the walk reached and which
// bound stopped it, so it is the plugin that says it, and this file carries the lines to stdout
// unchanged. In particular it does not summarize the content, does not decide which region matters,
// does not render a window title as a heading: every one of those would be this file forming a second
// opinion about a read that already has an owner.
//
// The one thing this file would like to do and must not is print the window identity as though it
// were the answer. It is on the first lines of every rendering and a human's eye goes there first —
// but the question asked was what is *in* the window, and a command that answered with the window's
// name would be answering a question about attribution with a caption.
//
// Nothing here keeps state between invocations, and nothing here could: each command opens the pipe,
// asks its one question and exits. What the answer is about lives in the resident, which is what makes
// this reading a claim about what Hikari has observed rather than about the moment this command
// started.
//
// This command does not start, restart or configure a resident. It can reach one that is already
// running, and that is the whole of what it does.

import { oneLine } from '../terminal-text/index.js';
import { contentReadFailureLines, requestDesktopContentRead } from './content.js';
import type { CliOptions, CommandOutcome } from './options.js';

export function contentCommand(options: CliOptions): Promise<CommandOutcome> {
  return askRunningHikari(options.dataDir);
}

async function askRunningHikari(dataDir: string): Promise<CommandOutcome> {
  const answer = await requestDesktopContentRead(dataDir);

  if (answer.kind === 'answered') {
    // A failed read is Hikari answering, not the command failing, so what it said goes out whole and
    // the exit code follows what it said rather than whether it had anything good to report. The
    // failures that are *values* — `refused`, `unreadable`, `empty` — arrive as `ok` replies carrying
    // a rendering of the kind, so this branch is the bare kind of failure: no window Hikari can
    // attribute to a human, or a walk that could not be produced at all.
    return answer.reply.outcome === 'ok'
      ? { exitCode: 0, stdout: render(answer.reply.lines), stderr: '' }
      : { exitCode: 1, stdout: '', stderr: render(answer.reply.lines) };
  }

  return { exitCode: 1, stdout: '', stderr: render(contentReadFailureLines(answer)) };
}

/**
 * Every line this command prints, escaped once at the last place that knows it is a terminal.
 *
 * `renderContentRead` already escapes what it returns, so on the ordinary path this is a second pass
 * over text that is already safe — and it is idempotent, because the escapes it writes are literal
 * `\uXXXX` text rather than the characters themselves. It is here for the two paths where nothing has
 * escaped anything. A request the endpoint refused comes back as `failed` carrying a line built from
 * `JSON.stringify` of whatever the peer sent, and a socket failure comes back as `detail` straight from
 * an `Error.message` — and `JSON.stringify` does not escape C1 controls or U+2028, so a peer on this
 * pipe (same user only, per the endpoint's own access boundary) can put raw CSI and line separators
 * into a sentence Hikari is about to print as its own. That is the failure `terminal-text` exists to
 * close, and `src/cli/subscribe-command.ts` closes it at the same spot for the same reason.
 *
 * The content itself is not re-escaped into something new: a body line that legitimately contains the
 * six characters `` stays those six characters, before and after.
 */
function render(lines: readonly string[]): string {
  return `${lines.map(oneLine).join('\n')}\n`;
}
