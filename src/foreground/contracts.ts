import { defineService } from '../runtime/contracts.js';
import type { ForegroundObservation } from './types.js';

export interface ForegroundService {
  current(): Promise<ForegroundObservation>;
}

export const foregroundService = defineService<ForegroundService>('foreground.current', 1);
