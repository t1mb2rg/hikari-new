import type { HikariIdentity } from '../continuity/types.js';
import { ChronicleAlreadyInitializedError, ChronicleAmbiguousStateError } from './errors.js';
import {
  createStoreHeader,
  hasLeftoverTemporaryFile,
  headersMatch,
  parseChronicleStore,
  readStoreText,
  serializeChronicleStore,
  writeStoreAtomically,
} from './store.js';

export interface InitializeChronicleOptions {
  readonly rootDir: string;
  readonly identity: HikariIdentity;
}

export function initializeChronicle(options: InitializeChronicleOptions): void {
  const { rootDir, identity } = options;

  const existingText = readStoreText(rootDir);
  if (existingText !== undefined) {
    const existing = parseChronicleStore(existingText);
    throw new ChronicleAlreadyInitializedError(existing.header.owner);
  }

  if (hasLeftoverTemporaryFile(rootDir)) {
    throw new ChronicleAmbiguousStateError(
      'a temporary store file was left behind by an interrupted write',
    );
  }

  const header = createStoreHeader(identity.hikariId);
  writeStoreAtomically(rootDir, serializeChronicleStore(header, []));

  const confirmedText = readStoreText(rootDir);
  if (confirmedText === undefined) {
    throw new ChronicleAmbiguousStateError('chronicle store disappeared after it was written');
  }

  const confirmed = parseChronicleStore(confirmedText);
  if (!headersMatch(header, confirmed.header) || confirmed.facts.length !== 0) {
    throw new ChronicleAmbiguousStateError(
      'chronicle store on disk differs from the store that was written',
    );
  }
}
