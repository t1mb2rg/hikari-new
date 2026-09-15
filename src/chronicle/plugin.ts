import { continuityService } from '../continuity/contracts.js';
import type { PluginDefinition } from '../runtime/plugin.js';
import { chronicleService } from './contracts.js';
import { openChronicle } from './open.js';

export interface ChroniclePluginConfig {
  readonly rootDir: string;
}

export const chroniclePlugin: PluginDefinition<ChroniclePluginConfig> = {
  id: 'chronicle',
  version: '1.0.0',
  requires: [continuityService],
  provides: [chronicleService],
  config: {
    parse(input: unknown): ChroniclePluginConfig {
      return Object.freeze({ rootDir: readRootDir(input) });
    },
  },
  setup(context, config) {
    const continuity = context.services.get(continuityService);
    context.services.provide(
      chronicleService,
      openChronicle({ rootDir: config.rootDir, identity: continuity.current }),
    );
  },
};

function readRootDir(input: unknown): string {
  if (typeof input !== 'object' || input === null) {
    throw new Error('Chronicle plugin requires a config object.');
  }
  const { rootDir } = input as { rootDir?: unknown };
  if (typeof rootDir !== 'string' || !rootDir.trim()) {
    throw new Error('Chronicle plugin requires a non-empty rootDir.');
  }
  return rootDir;
}
