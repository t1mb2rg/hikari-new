import type { PluginDefinition } from '../runtime/plugin.js';
import { toObservation } from './acquisition.js';
import type { ForegroundAcquirer } from './acquisition.js';
import { foregroundService } from './contracts.js';
import { createWindowsAcquirer } from './windows.js';

export function createForegroundPlugin(
  createAcquirer: () => ForegroundAcquirer,
): PluginDefinition<undefined> {
  return {
    id: 'foreground.windows',
    version: '1.0.0',
    requires: [],
    provides: [foregroundService],
    setup(context) {
      const acquirer = createAcquirer();
      context.defer(() => acquirer.dispose());
      context.services.provide(
        foregroundService,
        Object.freeze({
          current: async () => toObservation(await acquirer.acquire()),
        }),
      );
    },
  };
}

export const foregroundPlugin = createForegroundPlugin(createWindowsAcquirer);
