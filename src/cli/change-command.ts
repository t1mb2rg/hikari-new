// `hikari change` — a human telling a running Hikari which directories it may change, and asking it back.
//
// The four words live in one file because they are one operation with four spellings: same discovery,
// same protocol, same ways to fail, same exit codes. What differs is the word sent and what Hikari says
// back, and Hikari says both of those itself — this file writes no message of its own on the success
// path, because the plugin holding the authorization is the only thing that knows what it holds.
//
// Nothing here keeps state between invocations, and nothing here could: each command opens the pipe, asks
// its one question and exits. The authorization lives in the resident, which is what makes `hikari change
// declare` from one terminal visible to `hikari change status` in another.
//
// This command does not start, restart or configure a resident. It can reach one that is already
// running, and that is the whole of what it does.
//
// **It is also not the half that changes anything.** Naming a directory as changeable authorizes nothing
// on its own: the check that reads this set belongs to the action slice, and until that exists the only
// thing this command can do is record what a human said. That is deliberate rather than unfinished — the
// authorization is the part that has to be true before anything acts on it.

import { changeFailureLines, requestChangeableRepositories } from './change.js';
import type { ChangeOptions, CommandOutcome } from './options.js';
import type { ChangeableRepositoriesRequest } from '../changeable-repositories/index.js';

export function changeCommand(options: ChangeOptions): Promise<CommandOutcome> {
  return askRunningHikari(options.dataDir, toRequest(options));
}

// The arity that makes `repositories` safe was settled by the parser, which is the only place that can
// settle it: by the time a `ChangeOptions` exists, the two moving words have at least one operand and
// the other two have none. Restating the count here would be a second rule to keep in step with the
// first.
function toRequest(options: ChangeOptions): ChangeableRepositoriesRequest {
  if (options.word === 'declare') return { word: 'declare', repositories: options.repositories };
  if (options.word === 'replace') return { word: 'replace', repositories: options.repositories };
  if (options.word === 'clear') return { word: 'clear' };
  if (options.word === 'status') return { word: 'status' };

  // A word this file has never heard of must stop here rather than be answered as something else. Asking
  // a question other than the one that was asked is the only way this file could lie quietly: every other
  // failure on this path is Hikari refusing out loud.
  return unreachableWord(options.word);
}

function unreachableWord(word: never): never {
  throw new Error(`change 不认识这个词：${String(word)}`);
}

async function askRunningHikari(
  dataDir: string,
  request: ChangeableRepositoriesRequest,
): Promise<CommandOutcome> {
  const answer = await requestChangeableRepositories(dataDir, request);

  if (answer.kind === 'answered') {
    // A refusal is Hikari answering, not the command failing, so what it said goes out whole and the
    // exit code follows what it said rather than which word asked.
    return answer.outcome === 'ok'
      ? { exitCode: 0, stdout: render(answer.lines), stderr: '' }
      : { exitCode: 1, stdout: '', stderr: render(answer.lines) };
  }

  return { exitCode: 1, stdout: '', stderr: render(changeFailureLines(answer)) };
}

function render(lines: readonly string[]): string {
  return `${lines.join('\n')}\n`;
}
