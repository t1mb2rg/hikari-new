import { randomUUID } from 'node:crypto';

import { InvalidChronicleStoreError, InvalidFactError } from './errors.js';
import type { DurableFact, FactDraft, FactSource, JsonValue } from './types.js';

const DRAFT_FIELDS = new Set(['type', 'version', 'occurredAt', 'source', 'payload']);
const FACT_FIELDS = new Set([
  'factId',
  'type',
  'version',
  'occurredAt',
  'recordedAt',
  'source',
  'payload',
]);
const SOURCE_FIELDS = new Set(['kind', 'reference']);
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

type Rejection = (reason: string) => Error;

export function validateFactDraft(value: unknown): FactDraft {
  return inspectFactDraft(value, factRejection);
}

export function createDurableFact(draft: FactDraft): DurableFact {
  return inspectDurableFact(
    {
      factId: randomUUID(),
      type: draft.type,
      version: draft.version,
      occurredAt: draft.occurredAt,
      recordedAt: new Date().toISOString(),
      source: draft.source,
      payload: draft.payload,
    },
    factRejection,
  );
}

export function parseFactLine(text: string): DurableFact {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new InvalidChronicleStoreError('fact line is not valid JSON');
  }
  return inspectDurableFact(value, storeRejection);
}

export function serializeFact(fact: DurableFact): string {
  return `${JSON.stringify(fact)}\n`;
}

function factRejection(reason: string): Error {
  return new InvalidFactError(reason);
}

function storeRejection(reason: string): Error {
  return new InvalidChronicleStoreError(reason);
}

function inspectFactDraft(value: unknown, rejection: Rejection): FactDraft {
  const candidate = readFactObject(value, rejection, DRAFT_FIELDS);
  return Object.freeze({
    type: readType(candidate, rejection),
    version: readVersion(candidate, rejection),
    occurredAt: readTimestamp(candidate, 'occurredAt', rejection),
    source: readSource(candidate, rejection),
    payload: readPayload(candidate, rejection),
  });
}

function inspectDurableFact(value: unknown, rejection: Rejection): DurableFact {
  const candidate = readFactObject(value, rejection, FACT_FIELDS);
  const factId = candidate.factId;
  if (typeof factId !== 'string' || !UUID_V4_PATTERN.test(factId)) {
    throw rejection('factId is not a UUID');
  }
  return Object.freeze({
    factId,
    type: readType(candidate, rejection),
    version: readVersion(candidate, rejection),
    occurredAt: readTimestamp(candidate, 'occurredAt', rejection),
    recordedAt: readTimestamp(candidate, 'recordedAt', rejection),
    source: readSource(candidate, rejection),
    payload: readPayload(candidate, rejection),
  });
}

function readFactObject(
  value: unknown,
  rejection: Rejection,
  fields: Set<string>,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw rejection('content is not a JSON object');
  }

  const candidate = value as Record<string, unknown>;
  const unknownField = Object.keys(candidate).find((field) => !fields.has(field));
  if (unknownField !== undefined) {
    throw rejection(`field ${unknownField} is not part of the v1 fact`);
  }
  return candidate;
}

function readType(candidate: Record<string, unknown>, rejection: Rejection): string {
  const type = candidate.type;
  if (typeof type !== 'string' || !type.trim()) {
    throw rejection('type is not a non-empty string');
  }
  return type;
}

function readVersion(candidate: Record<string, unknown>, rejection: Rejection): number {
  const version = candidate.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version <= 0) {
    throw rejection('version is not a positive integer');
  }
  return version;
}

function readTimestamp(
  candidate: Record<string, unknown>,
  field: string,
  rejection: Rejection,
): string {
  const timestamp = candidate[field];
  if (!isUtcTimestamp(timestamp)) {
    throw rejection(`${field} is not a UTC timestamp`);
  }
  return timestamp;
}

function readSource(candidate: Record<string, unknown>, rejection: Rejection): FactSource {
  const source = candidate.source;
  if (typeof source !== 'object' || source === null || Array.isArray(source)) {
    throw rejection('source is not a JSON object');
  }

  const entry = source as Record<string, unknown>;
  const unknownField = Object.keys(entry).find((field) => !SOURCE_FIELDS.has(field));
  if (unknownField !== undefined) {
    throw rejection(`source field ${unknownField} is not part of the v1 fact`);
  }

  const kind = entry.kind;
  if (typeof kind !== 'string' || !kind.trim()) {
    throw rejection('source.kind is not a non-empty string');
  }

  const reference = entry.reference;
  if (reference === undefined) {
    return Object.freeze({ kind });
  }
  if (typeof reference !== 'string' || !reference.trim()) {
    throw rejection('source.reference is not a non-empty string');
  }
  return Object.freeze({ kind, reference });
}

function readPayload(candidate: Record<string, unknown>, rejection: Rejection): JsonValue {
  if (!('payload' in candidate)) {
    throw rejection('payload is missing');
  }
  return rebuildJsonValue(candidate.payload, rejection, 'payload', new Set<object>());
}

function rebuildJsonValue(
  value: unknown,
  rejection: Rejection,
  path: string,
  seen: Set<object>,
): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw rejection(`${path} is not a finite number`);
    if (Object.is(value, -0)) throw rejection(`${path} is negative zero`);
    return value;
  }

  if (typeof value === 'bigint') throw rejection(`${path} is a BigInt`);
  if (typeof value === 'function') throw rejection(`${path} is a function`);
  if (typeof value === 'symbol') throw rejection(`${path} is a symbol`);
  if (typeof value !== 'object') throw rejection(`${path} is undefined`);

  if (seen.has(value)) throw rejection(`${path} contains a circular reference`);

  if (Array.isArray(value)) {
    seen.add(value);
    const items = value.map((item, index) =>
      rebuildJsonValue(item, rejection, `${path}[${index}]`, seen),
    );
    seen.delete(value);
    return Object.freeze(items);
  }

  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw rejection(`${path} is a ${describeInstance(prototype)} instance`);
  }

  seen.add(value);
  const entries = Object.entries(value as Record<string, unknown>).map(
    ([key, item]) => [key, rebuildJsonValue(item, rejection, `${path}.${key}`, seen)] as const,
  );
  seen.delete(value);
  return Object.freeze(Object.fromEntries(entries));
}

function describeInstance(prototype: unknown): string {
  const name = (prototype as { constructor?: { name?: unknown } } | null)?.constructor?.name;
  return typeof name === 'string' ? name : 'non-plain';
}

function isUtcTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !UTC_TIMESTAMP_PATTERN.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}
