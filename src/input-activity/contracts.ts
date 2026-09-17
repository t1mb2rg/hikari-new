import { defineService } from '../runtime/contracts.js';
import type { InputActivityObservation } from './types.js';

export interface InputActivityService {
  current(): Promise<InputActivityObservation>;
}

export const inputActivityService = defineService<InputActivityService>('input-activity.current', 1);
