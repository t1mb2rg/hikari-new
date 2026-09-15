import { defineService } from '../runtime/contracts.js';
import type { DurableFact, FactDraft } from './types.js';

export interface ChronicleService {
  append(draft: FactDraft): Promise<DurableFact>;
  get(factId: string): Promise<DurableFact | undefined>;
  read(): Promise<readonly DurableFact[]>;
}

export const chronicleService = defineService<ChronicleService>('chronicle', 1);
