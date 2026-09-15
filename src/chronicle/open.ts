import type { HikariIdentity } from '../continuity/types.js';
import type { ChronicleService } from './contracts.js';
import { createChronicleService } from './service.js';
import { readStoreForOwner } from './store.js';

export interface OpenChronicleOptions {
  readonly rootDir: string;
  readonly identity: HikariIdentity;
}

export function openChronicle(options: OpenChronicleOptions): ChronicleService {
  readStoreForOwner(options.rootDir, options.identity.hikariId);
  return createChronicleService(options);
}
