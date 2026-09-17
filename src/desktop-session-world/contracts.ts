import { defineService } from '../runtime/contracts.js';
import type { DesktopSessionWorldSnapshot } from './types.js';

export interface DesktopSessionWorldService {
  current(): Promise<DesktopSessionWorldSnapshot>;
}

export const desktopSessionWorldService = defineService<DesktopSessionWorldService>(
  'desktop-session-world.current',
  1,
);
