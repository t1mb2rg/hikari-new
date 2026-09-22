#!/usr/bin/env node
import { NotInitializedError } from '../continuity/index.js';
import { askCommand } from './ask-command.js';
import { chronicleInitCommand } from './chronicle-init.js';
import { statusCommand, stopCommand } from './control-command.js';
import { focusCommand } from './focus-command.js';
import { initCommand } from './init.js';
import { observeCommand } from './observe-command.js';
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
  if (parsed.command === 'focus') return focusCommand(parsed.options);
  if (parsed.command === 'relevance') return relevanceCommand(parsed.options);
  if (parsed.command === 'observe') return observeCommand(parsed.options);
  if (parsed.command === 'ask') return askCommand(parsed.options);
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
