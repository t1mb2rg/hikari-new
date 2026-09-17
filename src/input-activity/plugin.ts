import type { PluginDefinition } from '../runtime/plugin.js';
import { toObservation } from './acquisition.js';
import type { InputActivityAcquirer } from './acquisition.js';
import { inputActivityService } from './contracts.js';
import { createWindowsAcquirer } from './windows.js';

export function createInputActivityPlugin(
  createAcquirer: () => InputActivityAcquirer,
): PluginDefinition<undefined> {
  return {
    id: 'input-activity.windows',
    version: '1.0.0',
    requires: [],
    provides: [inputActivityService],
    setup(context) {
      const acquirer = createAcquirer();
      context.defer(() => acquirer.dispose());
      context.services.provide(
        inputActivityService,
        Object.freeze({
          current: async () => toObservation(await acquirer.acquire()),
        }),
      );
    },
  };
}

export const inputActivityPlugin = createInputActivityPlugin(createWindowsAcquirer);
