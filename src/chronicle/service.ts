import type { HikariIdentity } from '../continuity/types.js';
import type { ChronicleService } from './contracts.js';
import { createDurableFact, serializeFact, validateFactDraft } from './fact.js';
import { appendStoreLine, readStoreForOwner } from './store.js';
import type { DurableFact, FactDraft } from './types.js';

export interface CreateChronicleServiceOptions {
  readonly rootDir: string;
  readonly identity: HikariIdentity;
}

export function createChronicleService(options: CreateChronicleServiceOptions): ChronicleService {
  const { rootDir, identity } = options;

  return Object.freeze({
    async append(draft: FactDraft): Promise<DurableFact> {
      readStoreForOwner(rootDir, identity.hikariId);
      const fact = createDurableFact(validateFactDraft(draft));
      appendStoreLine(rootDir, serializeFact(fact));
      return fact;
    },
    async get(factId: string): Promise<DurableFact | undefined> {
      const store = readStoreForOwner(rootDir, identity.hikariId);
      return store.facts.find((fact) => fact.factId === factId);
    },
    async read(): Promise<readonly DurableFact[]> {
      return readStoreForOwner(rootDir, identity.hikariId).facts;
    },
  });
}
