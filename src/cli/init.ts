import { initializeHikari } from '../continuity/index.js';
import type { CliOptions, CommandOutcome } from './options.js';

export function initCommand(options: CliOptions): CommandOutcome {
  const identity = initializeHikari({ rootDir: options.dataDir });
  return {
    exitCode: 0,
    stdout: `Hikari 已初始化：${identity.hikariId}\n`,
    stderr: '',
  };
}
