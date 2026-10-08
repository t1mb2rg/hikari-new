#!/usr/bin/env node
import { NotInitializedError } from '../continuity/index.js';
import { askCommand } from './ask-command.js';
import { bootstrapCommand } from './bootstrap.js';
import { chronicleInitCommand } from './chronicle-init.js';
import { confirmCommand } from './confirm-command.js';
import { statusCommand, stopCommand } from './control-command.js';
import { focusCommand } from './focus-command.js';
import { initCommand } from './init.js';
import { observeCommand } from './observe-command.js';
import { profileClearCommand, profileSetCommand, profileShowCommand } from './profile-command.js';
import { relevanceCommand } from './relevance-command.js';
import {
  INIT_HINT,
  USAGE,
  UsageError,
  parseCommandLine,
  type CommandOutcome,
  type ParsedCommandLine,
} from './options.js';
import { residentCommand } from './resident.js';
import { startCommand } from './start.js';
import { subscribeCommand } from './subscribe-command.js';

process.exitCode = await runCommandLine(process.argv.slice(2));

async function runCommandLine(argv: readonly string[]): Promise<number> {
  let outcome: CommandOutcome;
  try {
    outcome = await execute(parseCommandLine(argv));
  } catch (error) {
    outcome = failure(error);
  }

  process.stdout.write(outcome.stdout);
  process.stderr.write(outcome.stderr);
  return outcome.exitCode;
}

// The parse result is passed along whole rather than taken apart here. `resident` carries a cadence
// and `focus` carries operands, and handing this dispatcher the command and the options separately
// would erase both — it would have to be told what the options are, which is exactly the knowledge
// the union exists to keep in one place.
function execute(parsed: ParsedCommandLine): CommandOutcome | Promise<CommandOutcome> {
  if (parsed.command === 'init') return initCommand(parsed.options);
  if (parsed.command === 'chronicle-init') return chronicleInitCommand(parsed.options);
  if (parsed.command === 'resident') return residentCommand(parsed.options);
  if (parsed.command === 'status') return statusCommand(parsed.options);
  if (parsed.command === 'stop') return stopCommand(parsed.options);
  if (parsed.command === 'subscribe') return subscribeCommand(parsed.options);
  if (parsed.command === 'focus') return focusCommand(parsed.options);
  if (parsed.command === 'relevance') return relevanceCommand(parsed.options);
  if (parsed.command === 'observe') return observeCommand(parsed.options);
  if (parsed.command === 'ask') return askCommand(parsed.options);
  if (parsed.command === 'confirm') return confirmCommand(parsed.options);
  if (parsed.command === 'profile-set') return profileSetCommand(parsed.options);
  if (parsed.command === 'profile-show') return profileShowCommand(parsed.options);
  if (parsed.command === 'profile-clear') return profileClearCommand(parsed.options);
  // The default surface, which is a launch path before it is a window: `bootstrap.ts` decides which
  // data directory `hikari` means, finds or starts the resident configured there, and only then hands
  // over to the TUI. Everything it refuses — no terminal, no launch profile, a launch that failed —
  // it refuses with a reason and without opening a screen.
  //
  // The TUI draws to the terminal itself — raw mode, an alternate screen buffer, a redraw loop — so
  // it returns an outcome with nothing in it and hands the empty strings back to be written over an
  // already-restored screen. A failure to get a terminal at all is the one thing it does return for
  // the ordinary path to print.
  //
  // It is also the only command that never returns here in the ordinary case: the TUI ends by
  // restoring the terminal and exiting its own process, because the delivery subscription it holds is
  // an open socket and an open socket keeps the loop alive. The `await` below settles on the outcome
  // the TUI handed back on its way out, and the two writes after it are to a terminal that has already
  // been given back — which is why those strings are empty.
  if (parsed.command === 'tui') return bootstrapCommand(parsed.options);
  return startCommand(parsed.options);
}

function failure(error: unknown): CommandOutcome {
  if (error instanceof UsageError) {
    return { exitCode: 2, stdout: '', stderr: `${error.message}\n\n${USAGE}` };
  }

  const message = error instanceof Error ? error.message : String(error);
  const hint = error instanceof NotInitializedError ? `\n${INIT_HINT}` : '';
  return { exitCode: 1, stdout: '', stderr: `${message}${hint}\n` };
}
