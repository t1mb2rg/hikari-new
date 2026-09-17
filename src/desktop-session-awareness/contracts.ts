import { defineService } from '../runtime/contracts.js';
import type { DesktopSessionAwarenessAssessment } from './types.js';

export interface DesktopSessionAwarenessService {
  current(): Promise<DesktopSessionAwarenessAssessment>;
}

export const desktopSessionAwarenessService = defineService<DesktopSessionAwarenessService>(
  'desktop-session-awareness.current',
  1,
);
