import type { ForegroundObservation } from '../foreground/index.js';
import type { InputActivityObservation } from '../input-activity/index.js';

export type DesktopSessionForegroundFacet =
  | {
      readonly kind: 'available';
      readonly observation: ForegroundObservation;
    }
  | {
      readonly kind: 'unavailable';
    };

export type DesktopSessionInputActivityFacet =
  | {
      readonly kind: 'available';
      readonly observation: InputActivityObservation;
    }
  | {
      readonly kind: 'unavailable';
    };

// `unavailable` deliberately carries no reason: the World does not own the failure taxonomy of the
// sources it composes, so a transport detail must not become part of this contract.
export interface DesktopSessionWorldSnapshot {
  readonly snapshotAt: string;
  readonly foreground: DesktopSessionForegroundFacet;
  readonly inputActivity: DesktopSessionInputActivityFacet;
}
