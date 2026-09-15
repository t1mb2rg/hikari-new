import { initializeChronicle } from '../chronicle/index.js';
import { restoreHikari } from '../continuity/index.js';
import type { CliOptions, CommandOutcome } from './options.js';

export function chronicleInitCommand(options: CliOptions): CommandOutcome {
  const identity = restoreHikari({ rootDir: options.dataDir });
  initializeChronicle({ rootDir: options.dataDir, identity });
  return {
    exitCode: 0,
    stdout: `事实史已初始化：${identity.hikariId}\n`,
    stderr: '',
  };
}
