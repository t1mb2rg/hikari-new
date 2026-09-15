#!/usr/bin/env node
import { NotInitializedError } from '../continuity/index.js';
import { chronicleInitCommand } from './chronicle-init.js';
import { initCommand } from './init.js';
import {
  INIT_HINT,
  USAGE,
  UsageError,
  parseCommandLine,
  type CliCommand,
  type CliOptions,
  type CommandOutcome,
} from './options.js';
import { startCommand } from './start.js';

process.exitCode = await runCommandLine(process.argv.slice(2));

async function runCommandLine(argv: readonly string[]): Promise<number> {
  let outcome: CommandOutcome;
  try {
    const parsed = parseCommandLine(argv);
    outcome = await execute(parsed.command, parsed.options);
  } catch (error) {
    outcome = failure(error);
  }

  process.stdout.write(outcome.stdout);
  process.stderr.write(outcome.stderr);
  return outcome.exitCode;
}

function execute(
  command: CliCommand,
  options: CliOptions,
): CommandOutcome | Promise<CommandOutcome> {
  if (command === 'init') return initCommand(options);
  if (command === 'chronicle-init') return chronicleInitCommand(options);
  return startCommand(options);
}

function failure(error: unknown): CommandOutcome {
  if (error instanceof UsageError) {
    return { exitCode: 2, stdout: '', stderr: `${error.message}\n\n${USAGE}` };
  }

  const message = error instanceof Error ? error.message : String(error);
  const hint = error instanceof NotInitializedError ? `\n${INIT_HINT}` : '';
  return { exitCode: 1, stdout: '', stderr: `${message}${hint}\n` };
}
