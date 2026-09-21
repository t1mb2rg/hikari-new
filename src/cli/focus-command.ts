// `hikari focus` — a human telling a running Hikari what they are working on, and asking it back.
//
// The four words live in one file because they are one operation with four spellings: same
// discovery, same protocol, same three ways to fail, same exit codes. What differs is the word sent
// and what Hikari says back, and Hikari says both of those itself — this file writes no message of
// its own on the success path, because the plugin holding the focus is the only thing that knows what
// the focus is.
//
// Nothing here keeps state between invocations, and nothing here could: each command opens the pipe,
// asks its one question and exits. The focus lives in the resident, which is what makes `hikari focus
// declare` from one terminal visible to `hikari focus status` in another.
//
// This command does not start, restart or configure a resident. It can reach one that is already
// running, and that is the whole of what it does.

import { focusFailureLines, requestWorkFocus } from './focus.js';
import type { CommandOutcome, FocusOptions } from './options.js';
import type { WorkFocusRequest } from '../work-focus/index.js';

export function focusCommand(options: FocusOptions): Promise<CommandOutcome> {
  return askRunningHikari(options.dataDir, toRequest(options));
}

// The arity that makes `designations[0]` safe was settled by the parser, which is the only place that
// can settle it: by the time a `FocusOptions` exists, `declare` has exactly one operand and the other
// three have the number they take. Restating the count here would be a second rule to keep in step
// with the first.
function toRequest(options: FocusOptions): WorkFocusRequest {
  if (options.word === 'declare') {
    const [designation] = options.designations;
    // Unreachable: `readFocusArity` refuses a `declare` with any count but one. The check exists
    // because the alternative is a fallback value, and every fallback here would be a designation
    // someone did not type — which the plugin would then refuse with a reason that was not true.
    if (designation === undefined) throw new Error('focus declare 需要一个工作焦点。');
    return { word: 'declare', designation };
  }
  if (options.word === 'replace') return { word: 'replace', designations: options.designations };
  if (options.word === 'clear') return { word: 'clear' };
  if (options.word === 'status') return { word: 'status' };

  // A word this file has never heard of must stop here rather than be answered as something else.
  // Asking a question other than the one that was asked is the only way this file could lie quietly:
  // every other failure on this path is Hikari refusing out loud.
  return unreachableWord(options.word);
}

function unreachableWord(word: never): never {
  throw new Error(`focus 不认识这个词：${String(word)}`);
}

async function askRunningHikari(dataDir: string, request: WorkFocusRequest): Promise<CommandOutcome> {
  const answer = await requestWorkFocus(dataDir, request);

  if (answer.kind === 'answered') {
    // A refusal is Hikari answering, not the command failing, so what it said goes out whole and the
    // exit code follows what it said rather than which word asked.
    return answer.outcome === 'ok'
      ? { exitCode: 0, stdout: render(answer.lines), stderr: '' }
      : { exitCode: 1, stdout: '', stderr: render(answer.lines) };
  }

  return { exitCode: 1, stdout: '', stderr: render(focusFailureLines(answer)) };
}

function render(lines: readonly string[]): string {
  return `${lines.join('\n')}\n`;
}
