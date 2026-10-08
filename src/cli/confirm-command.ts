// `hikari confirm "<text>"` — a human telling a running Hikari to keep something they said.
//
// This is a separate command rather than a flag on `ask`, and `language/types.ts` argues the same point
// one layer down: folding a write into a read would make "nothing was recorded" and "something was
// recorded" two readings of one request, and a person who only asked has confirmed nothing. A flag
// would move that distinction into argv, where it is a property of how the line was typed rather than
// of which act was named. Two commands means the act is the first thing on the line.
//
// What this command is *not* is an authority. The record it creates says one thing — this person
// confirmed this statement through this endpoint — and nothing in Hikari reads it to decide whether
// anything may happen. It is not a permission, does not restore the work focus, does not turn on a
// source, and does not survive being read as any of those. What it does is make the sentence visible to
// the next conversation, framed as the low-trust material it is; the framing is the plugin's job and
// its argument is in `language/prompt.ts`.
//
// The three ways to fail are the same three as `ask`, and they are one command's worth of wording short:
// this file writes nothing of its own on the path where the statement was processed. Hikari says what
// it did, and this file carries the lines to the terminal unchanged. `recorded` is the success — exit 0,
// the lines on stdout — and it is the only one, because it is the only outcome under which the thing
// that was asked for actually happened. `refused` is non-zero: an empty or oversize statement was not
// kept, and a command whose whole purpose was to keep it has not done its work. `failed` is non-zero
// for the reason it is everywhere else — the write did not happen, and nothing may be said to have been
// kept.
//
// Nothing here keeps state between invocations, and nothing here could: each invocation opens the pipe,
// sends one sentence and exits. The record lives in the data directory, which is what makes a
// confirmation from one terminal visible to a question asked from another, or after the resident has
// been restarted. That is the whole of what this command promises, and the promise is bounded on the
// other side too: it is a record of what a person said, not of anything being true.
//
// This command does not start, restart or configure a resident. It can reach one that is already
// running, and that is the whole of what it does.

import { languageFailureLines, requestLanguage } from './language.js';
import type { CommandOutcome, ConfirmOptions } from './options.js';

export function confirmCommand(options: ConfirmOptions): Promise<CommandOutcome> {
  return confirmWithRunningHikari(options.dataDir, options.text);
}

async function confirmWithRunningHikari(dataDir: string, text: string): Promise<CommandOutcome> {
  const answer = await requestLanguage(dataDir, { word: 'confirm', text });

  if (answer.kind === 'replied') {
    // One success, listed on its own rather than as "everything but the two failures". `chatted` and
    // `answered` are outcomes the endpoint has and this word cannot produce, and a set written the other
    // way round would treat a reply that was neither a record nor a refusal as this command having
    // worked. What a human is told if that ever arrives is that it did not.
    const kept = answer.reply.outcome === 'recorded';
    return kept
      ? { exitCode: 0, stdout: render(answer.reply.lines), stderr: '' }
      : { exitCode: 1, stdout: '', stderr: render(answer.reply.lines) };
  }

  return { exitCode: 1, stdout: '', stderr: render(languageFailureLines(answer)) };
}

function render(lines: readonly string[]): string {
  return `${lines.join('\n')}\n`;
}
