import { NotInitializedError } from './errors.js';
import { parseOriginRecord, toIdentity } from './origin-record.js';
import { readOriginText } from './storage.js';
import type { HikariIdentity } from './types.js';

export interface RestoreHikariOptions {
  readonly rootDir: string;
}

export function restoreHikari(options: RestoreHikariOptions): HikariIdentity {
  const text = readOriginText(options.rootDir);
  if (text === undefined) {
    throw new NotInitializedError();
  }
  return toIdentity(parseOriginRecord(text));
}
