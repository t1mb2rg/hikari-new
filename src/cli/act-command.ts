// `hikari act` — one instruction, one repository, one answer.
//
// This is the entry point the boundary review named when it took L1: a human's own sentence is the
// mandate, and everything this slice may do hangs off that sentence arriving. The command is therefore
// deliberately thin. It parses nothing out of the sentence — no verbs, no paths, no repository names —
// because a mandate that this CLI had re-read and summarised would already be an interpretation, and the
// review's first invariant is that the mandate reaches the record unrewritten.
//
// The repository is a separate argument for the same reason, and for one more: the range check has to
// happen before anything starts, and a range decided by parsing the sentence would be a range this slice
// inferred rather than a range a person named.
//
// Exit code: 0 only when the world actually changed. "Nothing changed" and "cannot tell" are answers, and
// both exit non-zero — not because they are errors, but because neither is what was asked for, and a
// script that treats a change as a change should not be told otherwise.

import { requestRepositoryChange, repositoryChangeFailureLines } from './act.js';
import type { ActOptions, CommandOutcome } from './options.js';

export function actCommand(options: ActOptions): Promise<CommandOutcome> {
  return askRunningHikari(options);
}

async function askRunningHikari(options: ActOptions): Promise<CommandOutcome> {
  const answer = await requestRepositoryChange(options.dataDir, options.repository, options.mandate);

  if (answer.kind === 'answered' && answer.outcome === 'ok') {
    return { exitCode: 0, stdout: render(answer.lines), stderr: '' };
  }

  // A run that did not change anything is still Hikari answering, so what it said goes out whole and the
  // exit code follows what it said rather than which words were missing.
  if (answer.kind === 'answered') {
    return { exitCode: 1, stdout: '', stderr: render(answer.lines) };
  }

  return { exitCode: 1, stdout: '', stderr: render(repositoryChangeFailureLines(answer)) };
}

function render(lines: readonly string[]): string {
  return `${lines.join('\n')}\n`;
}
