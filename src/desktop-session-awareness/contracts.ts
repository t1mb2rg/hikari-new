import { defineService } from '../runtime/contracts.js';
import type { DesktopSessionAwarenessAssessment } from './types.js';

export interface DesktopSessionAwarenessService {
  /**
   * Assesses the world now, against the last snapshot this instance consumed.
   *
   * **This read is consumptive, and the contract says so because callers depend on it.** A successful
   * call advances the baseline: the next `current()`, whoever makes it, compares against the snapshot
   * this one returned. So two callers share one baseline rather than each keeping their own — a
   * caller that asks more often does not get fresher judgements than a caller that asks less; it
   * shortens the window every other caller's verdict covers. Concretely, the human-facing
   * `desktop-session-observe` plugin and the periodic awareness loop interleave on this one field.
   *
   * The consequence is worth knowing before adding a third caller, or before calling this twice in a
   * row to render two things: the second call is not a re-read of the first, it is a new comparison
   * against what the first returned.
   *
   * A rejection does not advance the baseline — `src/desktop-session-awareness/plugin.ts` assigns
   * only after the world read settles — so a failed acquisition leaves the next comparison intact.
   */
  current(): Promise<DesktopSessionAwarenessAssessment>;
}

export const desktopSessionAwarenessService = defineService<DesktopSessionAwarenessService>(
  'desktop-session-awareness.current',
  1,
);
