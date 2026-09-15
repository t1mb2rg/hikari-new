import { AlreadyInitializedError, AmbiguousStateError } from './errors.js';
import {
  createOriginRecord,
  originRecordsMatch,
  parseOriginRecord,
  serializeOriginRecord,
  toIdentity,
} from './origin-record.js';
import { readOriginText, writeOriginAtomically } from './storage.js';
import type { HikariIdentity } from './types.js';

export interface InitializeHikariOptions {
  readonly rootDir: string;
}

export function initializeHikari(options: InitializeHikariOptions): HikariIdentity {
  const { rootDir } = options;

  const existingText = readOriginText(rootDir);
  if (existingText !== undefined) {
    const existing = parseOriginRecord(existingText);
    throw new AlreadyInitializedError(existing.hikariId);
  }

  const created = createOriginRecord();
  writeOriginAtomically(rootDir, serializeOriginRecord(created));

  const confirmedText = readOriginText(rootDir);
  if (confirmedText === undefined) {
    throw new AmbiguousStateError('origin record disappeared after it was written');
  }

  const confirmed = parseOriginRecord(confirmedText);
  if (!originRecordsMatch(created, confirmed)) {
    throw new AmbiguousStateError('origin record on disk differs from the record that was written');
  }

  return toIdentity(confirmed);
}
