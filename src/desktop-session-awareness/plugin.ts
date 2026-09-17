import type { PluginDefinition } from '../runtime/plugin.js';
import { desktopSessionWorldService } from '../desktop-session-world/index.js';
import type { DesktopSessionWorldSnapshot } from '../desktop-session-world/index.js';
import { desktopSessionAwarenessService } from './contracts.js';
import type {
  DesktopSessionAwarenessAssessment,
  DesktopSessionFacetChange,
  DesktopSessionChange,
} from './types.js';

type ForegroundFacet = DesktopSessionWorldSnapshot['foreground'];
type InputActivityFacet = DesktopSessionWorldSnapshot['inputActivity'];

function compareForeground(
  previous: ForegroundFacet,
  current: ForegroundFacet,
): DesktopSessionFacetChange {
  // A facet the World could not fill carries no payload to compare, and neither does a pair where
  // only one side is filled: there is nothing here that could call that a difference.
  if (previous.kind !== 'available' || current.kind !== 'available') return 'indeterminate';

  const before = previous.observation.foreground;
  const after = current.observation.foreground;

  if (before.kind === 'absent' || after.kind === 'absent') {
    return before.kind === after.kind ? 'unchanged' : 'changed';
  }

  // Both targets are present, so only the two reported fields can differ. `===` is deliberate: a
  // `title` the source never reported reads as `undefined`, which is not equal to a reported
  // `null`, so those two states stay distinct here without a presence check.
  return before.title === after.title && before.processName === after.processName
    ? 'unchanged'
    : 'changed';
}

function compareInputActivity(
  previous: InputActivityFacet,
  current: InputActivityFacet,
): DesktopSessionFacetChange {
  if (previous.kind !== 'available' || current.kind !== 'available') return 'indeterminate';

  // Compared for inequality only. The tick is the platform's own counter, so this layer reads a
  // decrease as a difference, never as a rewind to correct and never as a duration.
  return previous.observation.lastInputTick === current.observation.lastInputTick
    ? 'unchanged'
    : 'changed';
}

function overallChange(
  foreground: DesktopSessionFacetChange,
  inputActivity: DesktopSessionFacetChange,
): DesktopSessionChange {
  // A difference stands on its own: it is still a difference when the other facet could not be
  // compared. Sameness does not: it is only sameness if everything that could be compared was.
  if (foreground === 'changed' || inputActivity === 'changed') return 'changed';
  if (foreground === 'unchanged' && inputActivity === 'unchanged') return 'stable';
  return 'indeterminate';
}

export const desktopSessionAwarenessPlugin: PluginDefinition<undefined> = {
  id: 'desktop-session-awareness',
  version: '1.0.0',
  requires: [desktopSessionWorldService],
  provides: [desktopSessionAwarenessService],
  setup(context) {
    const world = context.services.get(desktopSessionWorldService);

    // Activation-local by construction: `setup` runs once per activation, so a deactivation and a
    // later reactivation get a fresh binding and their first assessment is a baseline again.
    let previous: DesktopSessionWorldSnapshot | undefined;

    context.services.provide(
      desktopSessionAwarenessService,
      Object.freeze({
        current: async (): Promise<DesktopSessionAwarenessAssessment> => {
          // No try/catch: a world that could not be observed is not this layer's to reinterpret.
          // The assignment below is unreachable when this rejects, so a failed acquisition leaves
          // the baseline where it was and the next assessment still compares against it.
          const current = await world.current();
          const baseline = previous;
          previous = current;

          if (baseline === undefined) return Object.freeze({ kind: 'baseline', current });

          const foreground = compareForeground(baseline.foreground, current.foreground);
          const inputActivity = compareInputActivity(baseline.inputActivity, current.inputActivity);

          return Object.freeze({
            kind: 'comparison',
            previous: baseline,
            current,
            foreground,
            inputActivity,
            change: overallChange(foreground, inputActivity),
          });
        },
      }),
    );
  },
};
