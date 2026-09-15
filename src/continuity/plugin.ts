import type { PluginDefinition } from '../runtime/plugin.js';
import { continuityService } from './contracts.js';
import { restoreHikari } from './restore.js';

export interface ContinuityPluginConfig {
  readonly rootDir: string;
}

export const continuityPlugin: PluginDefinition<ContinuityPluginConfig> = {
  id: 'continuity',
  version: '1.0.0',
  requires: [],
  provides: [continuityService],
  config: {
    parse(input: unknown): ContinuityPluginConfig {
      return Object.freeze({ rootDir: readRootDir(input) });
    },
  },
  setup(context, config) {
    context.services.provide(continuityService, {
      current: restoreHikari({ rootDir: config.rootDir }),
    });
  },
};

function readRootDir(input: unknown): string {
  if (typeof input !== 'object' || input === null) {
    throw new Error('Continuity plugin requires a config object.');
  }
  const { rootDir } = input as { rootDir?: unknown };
  if (typeof rootDir !== 'string' || !rootDir.trim()) {
    throw new Error('Continuity plugin requires a non-empty rootDir.');
  }
  return rootDir;
}
