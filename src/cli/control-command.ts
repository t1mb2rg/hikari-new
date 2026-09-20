// `hikari status` and `hikari stop` — a human asking a running resident two questions.
//
// The two commands live in one file because they are one operation with two words: same discovery,
// same protocol, same three ways to fail, same exit codes. Splitting them into two files would
// duplicate that body line for line and call the result two commands. What differs is the word sent
// and what the resident says back, and the resident says both of those itself — neither command
// writes a message of its own on the success path, because the resident is the only thing that
// knows what is true about the resident.
//
// Neither command starts, restarts or reconfigures anything: they can reach a resident that is
// already running, and that is the whole of what they do.

import { controlFailureLines, requestControl, type ControlRequest } from './control.js';
import type { CliOptions, CommandOutcome } from './options.js';

export function statusCommand(options: CliOptions): Promise<CommandOutcome> {
  return askRunningResident(options.dataDir, 'status');
}

export function stopCommand(options: CliOptions): Promise<CommandOutcome> {
  return askRunningResident(options.dataDir, 'stop');
}

async function askRunningResident(dataDir: string, request: ControlRequest): Promise<CommandOutcome> {
  const answer = await requestControl(dataDir, request);

  if (answer.kind === 'answered') {
    // A refusal is the resident answering, not the command failing, so what it said goes out whole
    // and the exit code follows what it said rather than which command asked.
    return answer.outcome === 'ok'
      ? { exitCode: 0, stdout: render(answer.lines), stderr: '' }
      : { exitCode: 1, stdout: '', stderr: render(answer.lines) };
  }

  return { exitCode: 1, stdout: '', stderr: render(controlFailureLines(answer)) };
}

function render(lines: readonly string[]): string {
  return `${lines.join('\n')}\n`;
}
