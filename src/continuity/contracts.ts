import { defineService } from '../runtime/contracts.js';
import type { HikariIdentity } from './types.js';

export interface ContinuityService {
  readonly current: HikariIdentity;
}

export const continuityService = defineService<ContinuityService>('continuity.current', 1);
