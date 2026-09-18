import { defineEvent } from '../runtime/contracts.js';
import type { DesktopSessionAwarenessAssessment } from '../desktop-session-awareness/index.js';

// The owner of this occurrence is the loop, not the awareness provider: it is published when a loop
// cycle has driven one assessment to completion. Naming it after awareness would claim the provider
// had started pushing, and the provider stays pull-only — this only says who asked, and when.
//
// The payload is the assessment type itself, carried by reference. There is no loop-specific copy of
// it, no field added to it, and no second timestamp: a publisher that restated what it was handed
// would be a second authority on that data's shape.
export const desktopSessionAwarenessAssessedEvent =
  defineEvent<DesktopSessionAwarenessAssessment>('desktop-session-awareness-loop.assessed', 1);
