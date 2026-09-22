import type { PluginDefinition } from '../runtime/plugin.js';
import { desktopSessionWorldService } from '../desktop-session-world/index.js';
import type { DesktopSessionWorldSnapshot } from '../desktop-session-world/index.js';
import {
  desktopSessionAwarenessService,
  desktopSessionAwarenessPeekService,
} from './contracts.js';
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
  provides: [desktopSessionAwarenessService, desktopSessionAwarenessPeekService],
  setup(context) {
    const world = context.services.get(desktopSessionWorldService);

    // Activation-local by construction: `setup` runs once per activation, so a deactivation and a
    // later reactivation get a fresh binding and their first assessment is a baseline again.
    //
    // Both contracts below read this one binding, and that is what makes them two questions about one
    // timeline rather than two timelines. A peek compares against whatever the driver last consumed,
    // which is why the answer a reader gets is the answer the driver's next cycle would arrive at.
    let previous: DesktopSessionWorldSnapshot | undefined;

    // The assessment, from whatever baseline the caller's policy supplies. Pure by design: it takes
    // the two snapshots and returns the verdict, so the one thing that tells the two contracts apart
    // is deliberately nowhere near this function.
    function assess(
      baseline: DesktopSessionWorldSnapshot | undefined,
      current: DesktopSessionWorldSnapshot,
    ): DesktopSessionAwarenessAssessment {
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
    }

    context.services.provide(
      desktopSessionAwarenessService,
      Object.freeze({
        async current(): Promise<DesktopSessionAwarenessAssessment> {
          // No try/catch: a world that could not be observed is not this layer's to reinterpret.
          // The assignment below is unreachable when this rejects, so a failed acquisition leaves
          // the baseline where it was and the next assessment still compares against it.
          const current = await world.current();
          const baseline = previous;
          previous = current;
          return assess(baseline, current);
        },
      }),
    );

    context.services.provide(
      desktopSessionAwarenessPeekService,
      Object.freeze({
        async peek(): Promise<DesktopSessionAwarenessAssessment> {
          // The same world read and the same comparison as `current()`, and deliberately not the same
          // assignment. That this method cannot advance the baseline is a property of the code rather
          // than a promise about the caller: the write appears exactly once in this file, above, and
          // it is not here.
          const current = await world.current();
          return assess(previous, current);
        },
      }),
    );
  },
};
