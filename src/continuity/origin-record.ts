import { randomUUID } from 'node:crypto';

import { InvalidOriginError, UnsupportedVersionError } from './errors.js';
import type { HikariIdentity, OriginRecordV1 } from './types.js';

const ORIGIN_KIND = 'hikari-origin';
const ORIGIN_VERSION = 1;
const ORIGIN_FIELDS = new Set(['kind', 'version', 'hikariId', 'createdAt']);
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function createOriginRecord(): OriginRecordV1 {
  const record: OriginRecordV1 = {
    kind: ORIGIN_KIND,
    version: ORIGIN_VERSION,
    hikariId: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  return Object.freeze(record);
}

export function serializeOriginRecord(record: OriginRecordV1): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

export function parseOriginRecord(text: string): OriginRecordV1 {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new InvalidOriginError('content is not valid JSON');
  }
  return validateOriginRecord(value);
}

export function validateOriginRecord(value: unknown): OriginRecordV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidOriginError('content is not a JSON object');
  }

  const candidate = value as Record<string, unknown>;

  if (candidate.kind !== ORIGIN_KIND) {
    throw new InvalidOriginError('kind is not hikari-origin');
  }
  if (candidate.version === undefined) {
    throw new InvalidOriginError('version is missing');
  }
  if (typeof candidate.version !== 'number') {
    throw new InvalidOriginError('version is not a number');
  }
  if (candidate.version !== ORIGIN_VERSION) {
    throw new UnsupportedVersionError(candidate.version);
  }

  const { hikariId, createdAt } = candidate;
  if (!isUuidV4(hikariId)) {
    throw new InvalidOriginError('hikariId is not a UUID');
  }
  if (!isUtcTimestamp(createdAt)) {
    throw new InvalidOriginError('createdAt is not a UTC timestamp');
  }

  const unknownField = Object.keys(candidate).find((field) => !ORIGIN_FIELDS.has(field));
  if (unknownField !== undefined) {
    throw new InvalidOriginError(`field ${unknownField} is not part of the v1 record`);
  }

  const record: OriginRecordV1 = {
    kind: ORIGIN_KIND,
    version: ORIGIN_VERSION,
    hikariId,
    createdAt,
  };
  return Object.freeze(record);
}

export function toIdentity(record: OriginRecordV1): HikariIdentity {
  const identity: HikariIdentity = {
    hikariId: record.hikariId,
    createdAt: record.createdAt,
  };
  return Object.freeze(identity);
}

export function originRecordsMatch(left: OriginRecordV1, right: OriginRecordV1): boolean {
  return (
    left.kind === right.kind &&
    left.version === right.version &&
    left.hikariId === right.hikariId &&
    left.createdAt === right.createdAt
  );
}

function isUuidV4(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4_PATTERN.test(value);
}

function isUtcTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !UTC_TIMESTAMP_PATTERN.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}
