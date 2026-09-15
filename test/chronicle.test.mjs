import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { Runtime } from '../dist/index.js';
import {
  continuityPlugin,
  continuityService,
  initializeHikari,
  restoreHikari,
} from '../dist/continuity/index.js';
import {
  ChronicleAlreadyInitializedError,
  ChronicleAmbiguousStateError,
  ChronicleNotInitializedError,
  ChronicleOwnerMismatchError,
  ChroniclePersistenceError,
  InvalidChronicleStoreError,
  InvalidFactError,
  UnsupportedChronicleVersionError,
  chroniclePlugin,
  chronicleService,
  initializeChronicle,
  openChronicle,
  resolveChroniclePath,
} from '../dist/chronicle/index.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const VALID_HIKARI_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const OTHER_HIKARI_ID = '9c858901-8a57-4791-81fe-4c455b099bc9';
const VALID_FACT_ID = '11111111-1111-4111-8111-111111111111';
const VALID_OCCURRED_AT = '2026-01-01T00:00:00.000Z';

class Sample {
  constructor() {
    this.value = 1;
  }
}

function createRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'hikari-chronicle-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function createChronicle(t) {
  const root = createRoot(t);
  const identity = initializeHikari({ rootDir: root });
  initializeChronicle({ rootDir: root, identity });
  return { root, identity };
}

function headerText(overrides = {}) {
  return JSON.stringify({
    kind: 'hikari-chronicle',
    version: 1,
    owner: VALID_HIKARI_ID,
    ...overrides,
  });
}

function factText(overrides = {}) {
  return JSON.stringify({
    factId: VALID_FACT_ID,
    type: 'observation.noted',
    version: 1,
    occurredAt: VALID_OCCURRED_AT,
    recordedAt: VALID_OCCURRED_AT,
    source: { kind: 'test' },
    payload: { note: 'hello' },
    ...overrides,
  });
}

function writeStore(root, ...lines) {
  mkdirSync(join(root, 'chronicle'), { recursive: true });
  writeFileSync(resolveChroniclePath(root), lines.map((line) => `${line}\n`).join(''));
}

function draft(overrides = {}) {
  return {
    type: 'observation.noted',
    version: 1,
    occurredAt: VALID_OCCURRED_AT,
    source: { kind: 'test' },
    payload: { note: 'hello' },
    ...overrides,
  };
}

function circularPayload() {
  const node = { name: 'root' };
  node.self = node;
  return node;
}

async function observeChronicle(runtime) {
  const observed = {};
  await runtime.loadPlugin({
    id: 'test.chronicle-observer',
    version: '1.0.0',
    requires: [chronicleService],
    setup(context) {
      observed.service = context.services.get(chronicleService);
    },
  });
  return observed;
}

test('initializeChronicle writes a header-only store for the current identity', (t) => {
  const root = createRoot(t);
  const identity = initializeHikari({ rootDir: root });

  assert.equal(initializeChronicle({ rootDir: root, identity }), undefined);

  const text = readFileSync(resolveChroniclePath(root), 'utf8');
  assert.ok(text.endsWith('\n'));

  const lines = text.slice(0, -1).split('\n');
  assert.equal(lines.length, 1);

  const header = JSON.parse(lines[0]);
  assert.equal(header.kind, 'hikari-chronicle');
  assert.equal(header.version, 1);
  assert.equal(header.owner, identity.hikariId);
  assert.deepEqual(Object.keys(header).sort(), ['kind', 'owner', 'version']);
  assert.equal('createdAt' in header, false);
});

test('initializeChronicle refuses a second initialization', (t) => {
  const { root, identity } = createChronicle(t);
  const before = readFileSync(resolveChroniclePath(root), 'utf8');

  assert.throws(
    () => initializeChronicle({ rootDir: root, identity }),
    ChronicleAlreadyInitializedError,
  );

  assert.equal(readFileSync(resolveChroniclePath(root), 'utf8'), before);
});

test('initializeChronicle refuses to overwrite a damaged or unsupported store', (t) => {
  const damaged = createRoot(t);
  const damagedIdentity = initializeHikari({ rootDir: damaged });
  writeStore(damaged, '{ not JSON');
  assert.throws(
    () => initializeChronicle({ rootDir: damaged, identity: damagedIdentity }),
    InvalidChronicleStoreError,
  );
  assert.equal(readFileSync(resolveChroniclePath(damaged), 'utf8'), '{ not JSON\n');

  const unsupported = createRoot(t);
  const unsupportedIdentity = initializeHikari({ rootDir: unsupported });
  writeStore(unsupported, headerText({ version: 7 }));
  assert.throws(
    () => initializeChronicle({ rootDir: unsupported, identity: unsupportedIdentity }),
    UnsupportedChronicleVersionError,
  );
  assert.equal(
    readFileSync(resolveChroniclePath(unsupported), 'utf8'),
    `${headerText({ version: 7 })}\n`,
  );
});

test('initializeChronicle refuses an ambiguous state', (t) => {
  const shadowed = createRoot(t);
  const shadowedIdentity = initializeHikari({ rootDir: shadowed });
  mkdirSync(resolveChroniclePath(shadowed), { recursive: true });
  assert.throws(
    () => initializeChronicle({ rootDir: shadowed, identity: shadowedIdentity }),
    ChronicleAmbiguousStateError,
  );

  const interrupted = createRoot(t);
  const interruptedIdentity = initializeHikari({ rootDir: interrupted });
  mkdirSync(join(interrupted, 'chronicle'), { recursive: true });
  writeFileSync(join(interrupted, 'chronicle', 'chronicle.jsonl.tmp'), headerText());
  assert.throws(
    () => initializeChronicle({ rootDir: interrupted, identity: interruptedIdentity }),
    ChronicleAmbiguousStateError,
  );
  assert.equal(existsSync(resolveChroniclePath(interrupted)), false);
});

test('openChronicle reports a missing store without creating anything', (t) => {
  const root = createRoot(t);
  const identity = initializeHikari({ rootDir: root });
  const listing = readdirSync(root, { recursive: true });

  assert.throws(() => openChronicle({ rootDir: root, identity }), ChronicleNotInitializedError);

  assert.deepEqual(readdirSync(root, { recursive: true }), listing);
});

test('openChronicle rejects a store owned by another Hikari', (t) => {
  const root = createRoot(t);
  const identity = initializeHikari({ rootDir: root });
  writeStore(root, headerText({ owner: OTHER_HIKARI_ID }));

  assert.throws(
    () => openChronicle({ rootDir: root, identity }),
    ChronicleOwnerMismatchError,
  );
});

test('openChronicle rejects an unsupported store version', (t) => {
  const root = createRoot(t);
  const identity = initializeHikari({ rootDir: root });
  writeStore(root, headerText({ version: 2 }));

  assert.throws(
    () => openChronicle({ rootDir: root, identity }),
    UnsupportedChronicleVersionError,
  );
});

test('openChronicle rejects a damaged header', (t) => {
  const cases = [
    'not JSON at all',
    '[]',
    headerText({ kind: 'something-else' }),
    headerText({ version: undefined }),
    headerText({ version: '1' }),
    headerText({ owner: undefined }),
    headerText({ owner: '' }),
    headerText({ owner: 42 }),
    headerText({ createdAt: VALID_OCCURRED_AT }),
  ];

  for (const content of cases) {
    const root = createRoot(t);
    const identity = initializeHikari({ rootDir: root });
    writeStore(root, content);
    assert.throws(
      () => openChronicle({ rootDir: root, identity }),
      InvalidChronicleStoreError,
      `expected InvalidChronicleStoreError for ${content}`,
    );
  }
});

test('openChronicle rejects a damaged fact', (t) => {
  const withoutRecordedAt = JSON.stringify({
    factId: VALID_FACT_ID,
    type: 'observation.noted',
    version: 1,
    occurredAt: VALID_OCCURRED_AT,
    source: { kind: 'test' },
    payload: { note: 'hello' },
  });
  const withoutPayload = JSON.stringify({
    factId: VALID_FACT_ID,
    type: 'observation.noted',
    version: 1,
    occurredAt: VALID_OCCURRED_AT,
    recordedAt: VALID_OCCURRED_AT,
    source: { kind: 'test' },
  });

  const cases = [
    'not JSON at all',
    '[]',
    factText({ factId: 'not-a-uuid' }),
    factText({ factId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' }),
    factText({ type: '' }),
    factText({ type: 42 }),
    factText({ version: 0 }),
    factText({ version: '1' }),
    factText({ occurredAt: '2026-01-01' }),
    factText({ occurredAt: '2026-13-01T00:00:00.000Z' }),
    factText({ source: null }),
    factText({ source: { kind: '' } }),
    factText({ source: { kind: 'test', extra: true } }),
    factText({ extra: true }),
    withoutRecordedAt,
    withoutPayload,
  ];

  for (const content of cases) {
    const root = createRoot(t);
    const identity = initializeHikari({ rootDir: root });
    writeStore(root, headerText({ owner: identity.hikariId }), content);
    assert.throws(
      () => openChronicle({ rootDir: root, identity }),
      InvalidChronicleStoreError,
      `expected InvalidChronicleStoreError for ${content}`,
    );
  }
});

test('openChronicle rejects a store whose last line is unterminated', (t) => {
  const root = createRoot(t);
  const identity = initializeHikari({ rootDir: root });
  mkdirSync(join(root, 'chronicle'), { recursive: true });
  writeFileSync(
    resolveChroniclePath(root),
    `${headerText({ owner: identity.hikariId })}\n${factText()}`,
  );

  assert.throws(
    () => openChronicle({ rootDir: root, identity }),
    InvalidChronicleStoreError,
  );
});

test('openChronicle rejects a store with a repeated factId', (t) => {
  const root = createRoot(t);
  const identity = initializeHikari({ rootDir: root });
  writeStore(
    root,
    headerText({ owner: identity.hikariId }),
    factText(),
    factText({ type: 'other.type' }),
  );

  assert.throws(
    () => openChronicle({ rootDir: root, identity }),
    InvalidChronicleStoreError,
  );
});

test('openChronicle ignores a leftover temporary file', (t) => {
  const { root, identity } = createChronicle(t);
  writeFileSync(
    join(root, 'chronicle', 'chronicle.jsonl.tmp'),
    headerText({ owner: OTHER_HIKARI_ID }),
  );

  const service = openChronicle({ rootDir: root, identity });

  assert.deepEqual(Object.keys(service).sort(), ['append', 'get', 'read']);
});

test('initializeChronicle reports an existing store even when temporary residue remains', (t) => {
  const { root, identity } = createChronicle(t);
  writeFileSync(join(root, 'chronicle', 'chronicle.jsonl.tmp'), headerText());

  assert.throws(
    () => initializeChronicle({ rootDir: root, identity }),
    ChronicleAlreadyInitializedError,
  );
});

test('openChronicle opens without writing anything', (t) => {
  const { root, identity } = createChronicle(t);
  const service = openChronicle({ rootDir: root, identity });
  assert.ok(service);
  const listing = readdirSync(root, { recursive: true });
  const before = readFileSync(resolveChroniclePath(root), 'utf8');

  openChronicle({ rootDir: root, identity });

  assert.equal(readFileSync(resolveChroniclePath(root), 'utf8'), before);
  assert.deepEqual(readdirSync(root, { recursive: true }), listing);
});

test('append returns a durable fact generated by the chronicle', async (t) => {
  const { root, identity } = createChronicle(t);
  const service = openChronicle({ rootDir: root, identity });

  const first = await service.append(
    draft({ source: { kind: 'test', reference: 'unit-1' }, payload: { nested: [1, 'two', null] } }),
  );
  const second = await service.append(draft());

  assert.match(first.factId, UUID_V4);
  assert.match(first.recordedAt, UTC_TIMESTAMP);
  assert.equal(new Date(first.recordedAt).toISOString(), first.recordedAt);
  assert.notEqual(first.factId, second.factId);

  assert.equal(first.type, 'observation.noted');
  assert.equal(first.version, 1);
  assert.equal(first.occurredAt, VALID_OCCURRED_AT);
  assert.deepEqual(first.source, { kind: 'test', reference: 'unit-1' });
  assert.deepEqual(first.payload, { nested: [1, 'two', null] });

  assert.deepEqual(Object.keys(first).sort(), [
    'factId',
    'occurredAt',
    'payload',
    'recordedAt',
    'source',
    'type',
    'version',
  ]);
  assert.equal('hikariId' in first, false);
});

test('append persists exactly the fact it returns', async (t) => {
  const { root, identity } = createChronicle(t);
  const service = openChronicle({ rootDir: root, identity });

  const fact = await service.append(draft({ payload: { note: 'persisted' } }));

  const lines = readFileSync(resolveChroniclePath(root), 'utf8').slice(0, -1).split('\n');
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[1]), fact);
});

test('read returns facts in append order rather than by occurredAt', async (t) => {
  const { root, identity } = createChronicle(t);
  const service = openChronicle({ rootDir: root, identity });

  const first = await service.append(
    draft({ type: 'a', occurredAt: '2026-03-01T00:00:00.000Z' }),
  );
  const second = await service.append(
    draft({ type: 'b', occurredAt: '2026-02-01T00:00:00.000Z' }),
  );
  const third = await service.append(
    draft({ type: 'c', occurredAt: '2026-01-01T00:00:00.000Z' }),
  );

  const expected = [first.factId, second.factId, third.factId];
  assert.deepEqual((await service.read()).map((fact) => fact.factId), expected);
  assert.deepEqual(
    (await openChronicle({ rootDir: root, identity }).read()).map((fact) => fact.factId),
    expected,
  );
});

test('get finds a fact by id and returns undefined for an unknown id', async (t) => {
  const { root, identity } = createChronicle(t);
  const service = openChronicle({ rootDir: root, identity });
  const fact = await service.append(draft());

  assert.deepEqual(await service.get(fact.factId), fact);
  assert.equal(await service.get(VALID_FACT_ID), undefined);
});

test('chronicle operations report a missing store instead of recreating it', async (t) => {
  const { root, identity } = createChronicle(t);
  const service = openChronicle({ rootDir: root, identity });
  await service.append(draft());

  rmSync(resolveChroniclePath(root));

  await assert.rejects(() => service.append(draft()), ChronicleNotInitializedError);
  await assert.rejects(() => service.read(), ChronicleNotInitializedError);
  await assert.rejects(() => service.get(VALID_FACT_ID), ChronicleNotInitializedError);
  assert.equal(existsSync(resolveChroniclePath(root)), false);
});

test('append refuses to grow a damaged store', async (t) => {
  const { root, identity } = createChronicle(t);
  const service = openChronicle({ rootDir: root, identity });
  await service.append(draft());

  const damaged = readFileSync(resolveChroniclePath(root), 'utf8').slice(0, -1);
  writeFileSync(resolveChroniclePath(root), damaged);

  await assert.rejects(() => service.append(draft()), InvalidChronicleStoreError);
  assert.equal(readFileSync(resolveChroniclePath(root), 'utf8'), damaged);
});

test('a failed append never reports success', async (t) => {
  const { root, identity } = createChronicle(t);
  const service = openChronicle({ rootDir: root, identity });
  const before = readFileSync(resolveChroniclePath(root), 'utf8');

  chmodSync(resolveChroniclePath(root), 0o444);
  try {
    await assert.rejects(() => service.append(draft()), ChroniclePersistenceError);
  } finally {
    chmodSync(resolveChroniclePath(root), 0o666);
  }

  assert.equal(readFileSync(resolveChroniclePath(root), 'utf8'), before);
});

test('append rejects a payload that is not JSON-native', async (t) => {
  const { root, identity } = createChronicle(t);
  const service = openChronicle({ rootDir: root, identity });
  const before = readFileSync(resolveChroniclePath(root), 'utf8');

  const cases = [
    { note: undefined },
    { note: NaN },
    { note: Infinity },
    { note: -Infinity },
    { note: -0 },
    { note: 10n },
    { note: new Date() },
    { note: new Map() },
    { note: new Set() },
    { note: () => 1 },
    { note: new Sample() },
    { note: { deep: [undefined] } },
    circularPayload(),
  ];

  for (const payload of cases) {
    await assert.rejects(
      () => service.append(draft({ payload })),
      InvalidFactError,
      `expected InvalidFactError for ${String(payload)}`,
    );
  }

  assert.equal(readFileSync(resolveChroniclePath(root), 'utf8'), before);
});

test('append rejects a draft that is not a valid fact', async (t) => {
  const { root, identity } = createChronicle(t);
  const service = openChronicle({ rootDir: root, identity });

  const cases = [
    draft({ type: '' }),
    draft({ type: 42 }),
    draft({ version: 0 }),
    draft({ version: 1.5 }),
    draft({ version: '1' }),
    draft({ occurredAt: '2026-01-01' }),
    draft({ occurredAt: '2026-13-01T00:00:00.000Z' }),
    draft({ source: null }),
    draft({ source: { kind: '' } }),
    draft({ source: { kind: 'test', extra: true } }),
    draft({ factId: VALID_FACT_ID }),
    draft({ recordedAt: VALID_OCCURRED_AT }),
    draft({ hikariId: VALID_HIKARI_ID }),
    {},
  ];

  for (const invalid of cases) {
    await assert.rejects(
      () => service.append(invalid),
      InvalidFactError,
      `expected InvalidFactError for ${JSON.stringify(invalid)}`,
    );
  }
});

test('an unknown fact type is not an error and time order is not enforced', async (t) => {
  const { root, identity } = createChronicle(t);
  const service = openChronicle({ rootDir: root, identity });

  const fact = await service.append(
    draft({ type: 'never.registered.before', occurredAt: '2099-01-01T00:00:00.000Z' }),
  );

  assert.equal(fact.type, 'never.registered.before');
  assert.deepEqual((await service.read()).map((entry) => entry.factId), [fact.factId]);
});

test('chronicle and continuity share one data directory without interference', async (t) => {
  const { root, identity } = createChronicle(t);
  const service = openChronicle({ rootDir: root, identity });
  await service.append(draft());

  assert.equal(restoreHikari({ rootDir: root }).hikariId, identity.hikariId);
  assert.deepEqual(readdirSync(root).sort(), ['chronicle', 'continuity']);
});

test('append, get and read keep an asynchronous contract', async (t) => {
  const { root, identity } = createChronicle(t);
  const service = openChronicle({ rootDir: root, identity });

  const appended = service.append(draft());
  assert.ok(appended instanceof Promise);
  await appended;

  const missing = service.get(VALID_FACT_ID);
  assert.ok(missing instanceof Promise);
  assert.equal(await missing, undefined);

  const everything = service.read();
  assert.ok(everything instanceof Promise);
  assert.equal((await everything).length, 1);
});

test('the chronicle service exposes only the contract', async (t) => {
  const { root, identity } = createChronicle(t);
  const service = openChronicle({ rootDir: root, identity });

  assert.deepEqual(Object.keys(service).sort(), ['append', 'get', 'read']);
});

test('the chronicle plugin activates once continuity is active', async (t) => {
  const { root } = createChronicle(t);
  const runtime = new Runtime();

  await runtime.loadPlugin(continuityPlugin, { rootDir: root });
  await runtime.loadPlugin(chroniclePlugin, { rootDir: root });

  assert.equal(runtime.getPluginState('continuity'), 'active');
  assert.equal(runtime.getPluginState('chronicle'), 'active');

  const observed = await observeChronicle(runtime);
  const fact = await observed.service.append(draft({ payload: { via: 'runtime' } }));

  assert.equal(runtime.getPluginState('test.chronicle-observer'), 'active');
  assert.deepEqual((await observed.service.read()).map((entry) => entry.factId), [fact.factId]);

  await runtime.shutdown();
});

test('the chronicle plugin waits while continuity is missing', async (t) => {
  const { root } = createChronicle(t);
  const runtime = new Runtime();

  await runtime.loadPlugin(chroniclePlugin, { rootDir: root });

  assert.equal(runtime.getPluginState('chronicle'), 'waiting');
  assert.equal(runtime.getPluginError('chronicle'), undefined);

  await runtime.shutdown();
});

test('the chronicle plugin fails instead of creating a missing store', async (t) => {
  const root = createRoot(t);
  initializeHikari({ rootDir: root });
  const runtime = new Runtime();

  await runtime.loadPlugin(continuityPlugin, { rootDir: root });
  await runtime.loadPlugin(chroniclePlugin, { rootDir: root });

  assert.equal(runtime.getPluginState('continuity'), 'active');
  assert.equal(runtime.getPluginState('chronicle'), 'failed');
  assert.ok(runtime.getPluginError('chronicle') instanceof ChronicleNotInitializedError);
  assert.deepEqual(readdirSync(root), ['continuity']);

  await runtime.shutdown();
});

test('a new runtime lifecycle reads back the facts of the previous one', async (t) => {
  const { root } = createChronicle(t);

  const first = new Runtime();
  await first.loadPlugin(continuityPlugin, { rootDir: root });
  await first.loadPlugin(chroniclePlugin, { rootDir: root });
  const before = await observeChronicle(first);
  const written = await before.service.append(draft({ payload: { note: 'durable' } }));
  await first.shutdown();

  const second = new Runtime();
  await second.loadPlugin(continuityPlugin, { rootDir: root });
  await second.loadPlugin(chroniclePlugin, { rootDir: root });
  const after = await observeChronicle(second);
  const facts = await after.service.read();
  await second.shutdown();

  assert.equal(facts.length, 1);
  assert.deepEqual(facts[0], written);
});

test('continuity does not depend on chronicle being present', async (t) => {
  const { root } = createChronicle(t);
  const runtime = new Runtime();

  await runtime.loadPlugin(continuityPlugin, { rootDir: root });

  assert.equal(runtime.getPluginState('continuity'), 'active');
  assert.equal(runtime.getPluginState('chronicle'), undefined);

  await runtime.shutdown();
});

test('the chronicle plugin requires an explicit storage root', async () => {
  const runtime = new Runtime();

  await assert.rejects(() => runtime.loadPlugin(chroniclePlugin), /config object/);
  await assert.rejects(
    () => runtime.loadPlugin(chroniclePlugin, { rootDir: '   ' }),
    /non-empty rootDir/,
  );
  assert.equal(runtime.getPluginState('chronicle'), undefined);
});
