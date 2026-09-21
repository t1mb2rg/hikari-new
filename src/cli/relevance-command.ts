// `hikari relevance repository-ci status` — a human asking a running Hikari whether the Repository CI
// observation it can see concerns the work focus they declared.
//
// This is the first real production reader of the relevance judgement, and it is a *client*: it
// reaches the plugin over the plugin's own endpoint, exactly as `hikari focus` reaches the work
// focus. That is why the judgement needs no Service — the only thing that asks for a verdict arrives
// through a pipe, and publishing a contract for it would be publishing one for nobody.
//
// Nothing here keeps state between invocations and nothing here could: each command opens the pipe,
// puts its one question and exits. The composition a human asks about is the one a resident is
// already running; this command does not start, restart, configure or enable anything, and it has no
// way to. In particular it cannot turn the Repository CI capability on — an operator who could enable
// a capability by asking about it would have a second composition root, and this is not one.
//
// The verdict is Hikari's, not this file's. `relevant` and `unknown` are written by the plugin that
// reached them, and the lines below are printed exactly as it sent them. This file writes a message
// of its own only when no judgement happened at all, and then it is careful to say which of the
// several ways that can be.

import type { CliOptions, CommandOutcome } from './options.js';
import { relevanceFailureLines, requestRelevance } from './relevance.js';

export async function relevanceCommand(options: CliOptions): Promise<CommandOutcome> {
  const answer = await requestRelevance(options.dataDir);

  if (answer.kind === 'answered') {
    // A judgement that could not be completed is Hikari answering, not the command failing, so what
    // it said goes out whole and the exit code follows what it said. The `failed` lines say why the
    // judgement did not run and are deliberately not the `unknown` lines: the two are different
    // facts about the world, and the whole point of the split is that a human can tell them apart.
    return answer.reply.outcome === 'ok'
      ? { exitCode: 0, stdout: render(answer.reply.lines), stderr: '' }
      : { exitCode: 1, stdout: '', stderr: render(answer.reply.lines) };
  }

  return { exitCode: 1, stdout: '', stderr: render(relevanceFailureLines(answer)) };
}

function render(lines: readonly string[]): string {
  return `${lines.join('\n')}\n`;
}
