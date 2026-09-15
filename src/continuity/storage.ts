import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { AmbiguousStateError } from './errors.js';

const ORIGIN_DIRECTORY = 'continuity';
const ORIGIN_FILE = 'origin.json';
const ORIGIN_TEMP_FILE = 'origin.json.tmp';

export function resolveOriginPath(rootDir: string): string {
  return join(rootDir, ORIGIN_DIRECTORY, ORIGIN_FILE);
}

export function readOriginText(rootDir: string): string | undefined {
  try {
    return readFileSync(resolveOriginPath(rootDir), 'utf8');
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw new AmbiguousStateError(`origin record cannot be read: ${describeError(error)}`);
  }
}

export function writeOriginAtomically(rootDir: string, text: string): void {
  const directory = join(rootDir, ORIGIN_DIRECTORY);
  const temporary = join(directory, ORIGIN_TEMP_FILE);

  mkdirSync(directory, { recursive: true });
  writeTemporaryFile(temporary, text);

  try {
    renameSync(temporary, resolveOriginPath(rootDir));
  } catch (error) {
    throw new AmbiguousStateError(`origin record cannot be committed: ${describeError(error)}`);
  }
}

function writeTemporaryFile(path: string, text: string): void {
  const handle = openSync(path, 'w');
  try {
    writeFileSync(handle, text);
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
