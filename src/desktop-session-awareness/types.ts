import type { DesktopSessionWorldSnapshot } from '../desktop-session-world/index.js';

export type DesktopSessionFacetChange = 'changed' | 'unchanged' | 'indeterminate';

export type DesktopSessionChange = 'changed' | 'stable' | 'indeterminate';

// `stable` says only that neither comparable payload differed between the two snapshots; it is not
// a claim that nothing happened on the desktop. `changed` says only that at least one comparable
// payload differed; it is not a claim that the difference matters. Neither verdict decides whether
// to remember, notify, or act, and this layer makes no such decision.
export type DesktopSessionAwarenessAssessment =
  | {
      readonly kind: 'baseline';
      readonly current: DesktopSessionWorldSnapshot;
    }
  | {
      readonly kind: 'comparison';
      readonly previous: DesktopSessionWorldSnapshot;
      readonly current: DesktopSessionWorldSnapshot;
      readonly foreground: DesktopSessionFacetChange;
      readonly inputActivity: DesktopSessionFacetChange;
      readonly change: DesktopSessionChange;
    };
