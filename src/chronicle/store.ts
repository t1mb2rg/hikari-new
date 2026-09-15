import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';

import {
  ChronicleAmbiguousStateError,
  ChronicleNotInitializedError,
  ChronicleOwnerMismatchError,
  ChroniclePersistenceError,
  InvalidChronicleStoreError,
  UnsupportedChronicleVersionError,
} from './errors.js';
import { parseFactLine, serializeFact } from './fact.js';
import type { ChronicleStoreHeaderV1, DurableFact } from './types.js';

const CHRONICLE_DIRECTORY = 'chronicle';
const CHRONICLE_FILE = 'chronicle.jsonl';
const CHRONICLE_TEMP_FILE = 'chronicle.jsonl.tmp';
const HEADER_KIND = 'hikari-chronicle';
const HEADER_VERSION = 1;
const HEADER_FIELDS = new Set(['kind', 'version', 'owner']);

export interface ChronicleStore {
  readonly header: ChronicleStoreHeaderV1;
  readonly facts: readonly DurableFact[];
}

export function resolveChroniclePath(rootDir: string): string {
  return join(rootDir, CHRONICLE_DIRECTORY, CHRONICLE_FILE);
}

export function createStoreHeader(owner: string): ChronicleStoreHeaderV1 {
  return Object.freeze({ kind: HEADER_KIND, version: HEADER_VERSION, owner });
}

export function headersMatch(
  left: ChronicleStoreHeaderV1,
  right: ChronicleStoreHeaderV1,
): boolean {
  return left.kind === right.kind && left.version === right.version && left.owner === right.owner;
}

export function serializeChronicleStore(
  header: ChronicleStoreHeaderV1,
  facts: readonly DurableFact[],
): string {
  const lines = [`${JSON.stringify(header)}\n`, ...facts.map(serializeFact)];
  return lines.join('');
}

export function parseChronicleStore(text: string): ChronicleStore {
  const lines = splitStoreLines(text);
  return Object.freeze({
    header: parseStoreHeader(lines[0]),
    facts: parseStoreFacts(lines.slice(1)),
  });
}

export function readStoreForOwner(rootDir: string, owner: string): ChronicleStore {
  const text = readStoreText(rootDir);
  if (text === undefined) {
    throw new ChronicleNotInitializedError();
  }

  const lines = splitStoreLines(text);
  const header = parseStoreHeader(lines[0]);
  if (header.owner !== owner) {
    throw new ChronicleOwnerMismatchError(owner, header.owner);
  }
  return Object.freeze({ header, facts: parseStoreFacts(lines.slice(1)) });
}

export function readStoreText(rootDir: string): string | undefined {
  try {
    return readFileSync(resolveChroniclePath(rootDir), 'utf8');
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw new ChronicleAmbiguousStateError(
      `chronicle store cannot be read: ${describeError(error)}`,
    );
  }
}

export function hasLeftoverTemporaryFile(rootDir: string): boolean {
  try {
    statSync(resolveTemporaryPath(rootDir));
    return true;
  } catch (error) {
    if (isMissingFile(error)) return false;
    throw new ChronicleAmbiguousStateError(
      `chronicle temporary file cannot be inspected: ${describeError(error)}`,
    );
  }
}

export function writeStoreAtomically(rootDir: string, text: string): void {
  const temporary = resolveTemporaryPath(rootDir);

  mkdirSync(join(rootDir, CHRONICLE_DIRECTORY), { recursive: true });
  writeTemporaryFile(temporary, text);

  try {
    renameSync(temporary, resolveChroniclePath(rootDir));
  } catch (error) {
    throw new ChronicleAmbiguousStateError(
      `chronicle store cannot be committed: ${describeError(error)}`,
    );
  }
}

export function appendStoreLine(rootDir: string, line: string): void {
  const handle = openAppendHandle(rootDir);
  try {
    writeFully(handle, line);
    fsyncSync(handle);
  } catch (error) {
    throw new ChroniclePersistenceError(describeError(error));
  } finally {
    closeSync(handle);
  }
}

function splitStoreLines(text: string): readonly string[] {
  if (!text.endsWith('\n')) {
    throw new InvalidChronicleStoreError('store does not end with a newline');
  }
  return text.slice(0, -1).split('\n');
}

function parseStoreHeader(line: string | undefined): ChronicleStoreHeaderV1 {
  if (line === undefined) {
    throw new InvalidChronicleStoreError('store has no header line');
  }

  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new InvalidChronicleStoreError('header is not valid JSON');
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidChronicleStoreError('header is not a JSON object');
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.kind !== HEADER_KIND) {
    throw new InvalidChronicleStoreError('header kind is not hikari-chronicle');
  }
  if (candidate.version === undefined) {
    throw new InvalidChronicleStoreError('header version is missing');
  }
  if (typeof candidate.version !== 'number') {
    throw new InvalidChronicleStoreError('header version is not a number');
  }
  if (candidate.version !== HEADER_VERSION) {
    throw new UnsupportedChronicleVersionError(candidate.version);
  }

  const { owner } = candidate;
  if (typeof owner !== 'string' || !owner.trim()) {
    throw new InvalidChronicleStoreError('header owner is not a non-empty string');
  }

  const unknownField = Object.keys(candidate).find((field) => !HEADER_FIELDS.has(field));
  if (unknownField !== undefined) {
    throw new InvalidChronicleStoreError(`header field ${unknownField} is not part of v1`);
  }
  return Object.freeze({ kind: HEADER_KIND, version: HEADER_VERSION, owner });
}

function parseStoreFacts(lines: readonly string[]): readonly DurableFact[] {
  const facts = lines.map(parseFactLine);
  const seen = new Set<string>();

  for (const fact of facts) {
    if (seen.has(fact.factId)) {
      throw new InvalidChronicleStoreError(`factId ${fact.factId} appears more than once`);
    }
    seen.add(fact.factId);
  }
  return Object.freeze(facts);
}

function resolveTemporaryPath(rootDir: string): string {
  return join(rootDir, CHRONICLE_DIRECTORY, CHRONICLE_TEMP_FILE);
}

function openAppendHandle(rootDir: string): number {
  try {
    return openSync(resolveChroniclePath(rootDir), 'a');
  } catch (error) {
    throw new ChroniclePersistenceError(`store cannot be opened: ${describeError(error)}`);
  }
}

function writeTemporaryFile(path: string, text: string): void {
  const handle = openSync(path, 'w');
  try {
    writeFully(handle, text);
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
}

function writeFully(handle: number, text: string): void {
  const buffer = Buffer.from(text, 'utf8');
  let written = 0;
  while (written < buffer.length) {
    const count = writeSync(handle, buffer, written, buffer.length - written);
    if (count === 0) throw new Error('write made no progress');
    written += count;
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
