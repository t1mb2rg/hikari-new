// `hikari ask "<text>"` — a human asking a running Hikari a question in their own words.
//
// This file writes no message of its own on the path where the question was processed, and that is the
// whole design. The plugin holding the understanding, the facts and the wording is the only thing that
// knows what the answer is, so it is the plugin that says it, and this file carries the lines to the
// terminal unchanged. In particular it does not summarise them, does not add a lead-in, does not
// restate the outcome as a sentence, and does not decide whether what came back was good enough: every
// one of those would be this file writing prose about an answer, which is exactly the authority the
// language plugin does not delegate.
//
// The exit code follows the plugin's own outcome word and adds nothing to it. `answered` is the
// question having been answered — exit 0, and the answer on stdout. `refused` and `failed` are both
// non-zero, and they are both on stderr, but this file does not flatten them into one thing: it prints
// what the plugin said, and the plugin's two words say two different things, to be read by a human or
// branched on by a script. Collapsing them here would be the CLI forming the opinion that "I did not
// understand you" and "the model is unreachable" are the same event.
//
// Nothing here keeps state between invocations, and nothing here could: each `ask` opens the pipe, sends
// one sentence and exits. Multi-turn conversation in v1 is a person running this command more than once
// against one resident — the short-term context that makes a follow-up work belongs to that resident's
// activation and is not carried by this process, cannot be, and is not asked for.
//
// This command does not start, restart or configure a resident. It can reach one that is already
// running, and that is the whole of what it does.

import { askFailureLines, requestLanguageAsk } from './ask.js';
import type { AskOptions, CommandOutcome } from './options.js';

export function askCommand(options: AskOptions): Promise<CommandOutcome> {
  return askRunningHikari(options.dataDir, options.text);
}

async function askRunningHikari(dataDir: string, text: string): Promise<CommandOutcome> {
  const answer = await requestLanguageAsk(dataDir, text);

  if (answer.kind === 'replied') {
    // A refusal is Hikari answering, not the command failing, so what it said goes out whole and the
    // exit code follows what it said rather than whether it had anything good to report.
    return answer.reply.outcome === 'answered'
      ? { exitCode: 0, stdout: render(answer.reply.lines), stderr: '' }
      : { exitCode: 1, stdout: '', stderr: render(answer.reply.lines) };
  }

  return { exitCode: 1, stdout: '', stderr: render(askFailureLines(answer)) };
}

function render(lines: readonly string[]): string {
  return `${lines.join('\n')}\n`;
}
