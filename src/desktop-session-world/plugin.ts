import type { PluginDefinition } from '../runtime/plugin.js';
import { foregroundService } from '../foreground/index.js';
import { inputActivityService } from '../input-activity/index.js';
import { desktopSessionWorldService } from './contracts.js';
import type {
  DesktopSessionForegroundFacet,
  DesktopSessionInputActivityFacet,
  DesktopSessionWorldSnapshot,
} from './types.js';

export const desktopSessionWorldPlugin: PluginDefinition<undefined> = {
  id: 'desktop-session-world',
  version: '1.0.0',
  requires: [foregroundService, inputActivityService],
  provides: [desktopSessionWorldService],
  setup(context) {
    const foreground = context.services.get(foregroundService);
    const inputActivity = context.services.get(inputActivityService);

    context.services.provide(
      desktopSessionWorldService,
      Object.freeze({
        current: async (): Promise<DesktopSessionWorldSnapshot> => {
          // Both perceptions are started in the same synchronous segment so that the snapshot
          // covers the narrowest window a single acquisition can offer. `Promise.resolve().then`
          // also converts a synchronous throw from a source into a rejection, so that both ways a
          // source can fail end up in the same place: this facet's availability.
          const [foregroundResult, inputActivityResult] = await Promise.allSettled([
            Promise.resolve().then(() => foreground.current()),
            Promise.resolve().then(() => inputActivity.current()),
          ]);

          const foregroundFacet: DesktopSessionForegroundFacet =
            foregroundResult.status === 'fulfilled'
              ? { kind: 'available', observation: foregroundResult.value }
              : { kind: 'unavailable' };

          const inputActivityFacet: DesktopSessionInputActivityFacet =
            inputActivityResult.status === 'fulfilled'
              ? { kind: 'available', observation: inputActivityResult.value }
              : { kind: 'unavailable' };

          // Stamped after both facets have settled, so it describes when this snapshot was
          // assembled and never when the sources observed anything.
          return Object.freeze({
            snapshotAt: new Date().toISOString(),
            foreground: Object.freeze(foregroundFacet),
            inputActivity: Object.freeze(inputActivityFacet),
          });
        },
      }),
    );
  },
};
