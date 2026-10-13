// `hikari screen "<text>"` — a human asking about the window in front of them, and thereby
// authorizing one read of it.
//
// ## Why this is a command and not a flag on `ask`
//
// The word is the authorization. `language/types.ts` argues it one layer down and the argument is the
// reason this file exists rather than an option in `ask-command.ts`: what makes a read of somebody's
// screen permitted is that the person asked a question about their screen, and a `--about-screen` flag
// would turn that act into a property of a question — a boolean a caller could set on any sentence, and
// one that would have to be re-decided at every layer between here and the plugin. Two commands and two
// words mean the decision is made once, by the person, in the token they typed, and the plugin can
// state the rule as "the word `screen` arrived" rather than "a field was true".
//
// This is also why a third word did not become a third field. `types.ts` states the test a new word has
// to pass; this command is the caller end of the word that passed it.
//
// ## What this command tells the human, and where
//
// The disclosure lives in `USAGE` and nowhere else: this run sends the window body it read to whatever
// model endpoint the resident was started with, and that endpoint may be remote. `ask` discloses its
// own transfer the same way and in the same place, and the design that authorized this slice asked for
// no new disclosure shape — so there is no warning printed here, no confirmation prompt, and no
// `--yes`. A second disclosure mechanism would be a second thing to keep true, and the one that is
// there is read exactly once, by a person deciding whether to type the command.
//
// What this file must *not* do is soften that: it does not summarise the read, does not say how long
// the body was, does not decide whether the answer was good, and does not print anything about the
// window itself. Every line a human sees on the success path is the plugin's, carried through
// unchanged — the same rule `ask-command.ts` states, for the same reason.
//
// ## The exit code
//
// `answered` is the only success, and the other four are excluded by name rather than by falling
// through to a non-zero. Two of them cannot happen on this path at all, and saying which is the point
// of listing them:
//
//   chatted    requires the loop to have read nothing before the model's last word. The authorized
//              path has read something before the model is called at all — the window body is on the
//              page before the first step — so this outcome is unreachable here rather than merely
//              unlikely. A `screen` that came back `chatted` would mean the read did not reach the
//              page, which is a bug and not an outcome, and exit 1 is the right report of it.
//   recorded   belongs to `confirm`. This word never writes, so the outcome that reports a write is
//              not one this command can receive.
//   refused    Hikari understood the request and will not answer that — the question was empty, or
//              longer than any question needs to be. A refusal is not a failure of the command and the
//              plugin's own words go to stderr; the exit code follows what Hikari said.
//   failed     this build did not get to a verdict: no window Hikari could attribute to this person,
//              a walk that threw, a model that could not be reached, an endpoint that did not answer.
//
// Nothing here keeps state between invocations. Each run opens the pipe, sends one sentence, and exits;
// the authorization is the sentence, and it is spent when the read is done. There is no mode, no
// session, and nothing on disk that a later invocation could reuse — which is the whole of what "one
// explicit authorization, not a standing permission" means at this end.

import { languageFailureLines, requestLanguage } from './language.js';
import type { CommandOutcome, ScreenOptions } from './options.js';

export function screenCommand(options: ScreenOptions): Promise<CommandOutcome> {
  return askAboutTheWindow(options.dataDir, options.text);
}

async function askAboutTheWindow(dataDir: string, text: string): Promise<CommandOutcome> {
  const answer = await requestLanguage(dataDir, { word: 'screen', text });

  if (answer.kind === 'replied') {
    // One outcome rather than a list of two, unlike `ask`, and the asymmetry is the claim: the two
    // words differ in exactly one way that a client can see, and it is that this one has read
    // something before the model speaks. `answered` is what that produces; everything else is the
    // four cases the header rules out or reports.
    return answer.reply.outcome === 'answered'
      ? { exitCode: 0, stdout: render(answer.reply.lines), stderr: '' }
      : { exitCode: 1, stdout: '', stderr: render(answer.reply.lines) };
  }

  return { exitCode: 1, stdout: '', stderr: render(languageFailureLines(answer)) };
}

function render(lines: readonly string[]): string {
  return `${lines.join('\n')}\n`;
}
