// `hikari observe desktop-session status` — a human asking a running Hikari what it currently sees.
//
// This file writes no message of its own on the success path, and that is the whole design. The
// plugin holding the assessment is the only thing that knows what the two observations and the
// comparison between them say, so it is the plugin that says it, and this file carries the lines to
// stdout unchanged. In particular it does not restate the verdict, does not decide whether a facet
// changed, and does not read anything into a window title: every one of those would be this file
// forming a second opinion about a judgement that already has an owner.
//
// Nothing here keeps state between invocations, and nothing here could: each command opens the pipe,
// asks its one question and exits. What the answer is about lives in the resident, which is what makes
// this reading a claim about Hikari right now rather than about the moment this command started.
//
// This command does not start, restart or configure a resident. It can reach one that is already
// running, and that is the whole of what it does.

import { observeFailureLines, requestDesktopSessionObserve } from './observe.js';
import type { CliOptions, CommandOutcome } from './options.js';

export function observeCommand(options: CliOptions): Promise<CommandOutcome> {
  return askRunningHikari(options.dataDir);
}

async function askRunningHikari(dataDir: string): Promise<CommandOutcome> {
  const answer = await requestDesktopSessionObserve(dataDir);

  if (answer.kind === 'answered') {
    // A refusal is Hikari answering, not the command failing, so what it said goes out whole and the
    // exit code follows what it said rather than whether it had anything good to report.
    return answer.reply.outcome === 'ok'
      ? { exitCode: 0, stdout: render(answer.reply.lines), stderr: '' }
      : { exitCode: 1, stdout: '', stderr: render(answer.reply.lines) };
  }

  return { exitCode: 1, stdout: '', stderr: render(observeFailureLines(answer)) };
}

function render(lines: readonly string[]): string {
  return `${lines.join('\n')}\n`;
}
