import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { Runtime } from '../dist/index.js';
import {
  AlreadyInitializedError,
  AmbiguousStateError,
  InvalidOriginError,
  NotInitializedError,
  UnsupportedVersionError,
  continuityPlugin,
  continuityService,
  initializeHikari,
  resolveOriginPath,
  restoreHikari,
} from '../dist/continuity/index.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const VALID_HIKARI_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const VALID_CREATED_AT = '2026-01-01T00:00:00.000Z';

function createRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'hikari-continuity-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function originText(overrides = {}) {
  return JSON.stringify({
    kind: 'hikari-origin',
    version: 1,
    hikariId: VALID_HIKARI_ID,
    createdAt: VALID_CREATED_AT,
    ...overrides,
  });
}

function writeOrigin(root, content) {
  mkdirSync(join(root, 'continuity'), { recursive: true });
  writeFileSync(resolveOriginPath(root), content);
}

async function observeIdentity(runtime, rootDir) {
  await runtime.loadPlugin(continuityPlugin, { rootDir });
  const observed = {};
  await runtime.loadPlugin({
    id: 'test.identity-observer',
    version: '1.0.0',
    requires: [continuityService],
    setup(context) {
      observed.service = context.services.get(continuityService);
      observed.current = observed.service.current;
    },
  });
  return observed;
}

test('initializeHikari creates an origin record in an empty directory', (t) => {
  const root = createRoot(t);

  const identity = initializeHikari({ rootDir: root });

  const stored = JSON.parse(readFileSync(resolveOriginPath(root), 'utf8'));
  assert.equal(stored.kind, 'hikari-origin');
  assert.equal(stored.version, 1);
  assert.equal(stored.hikariId, identity.hikariId);
  assert.equal(stored.createdAt, identity.createdAt);
});

test('initializeHikari returns a random UUID and an explicit UTC timestamp', (t) => {
  const other = initializeHikari({ rootDir: createRoot(t) });

  assert.match(other.hikariId, UUID_V4);
  assert.match(other.createdAt, UTC_TIMESTAMP);
  assert.equal(new Date(other.createdAt).toISOString(), other.createdAt);

  const identity = initializeHikari({ rootDir: createRoot(t) });
  assert.notEqual(identity.hikariId, other.hikariId);
});

test('initializeHikari refuses to replace an existing origin record', (t) => {
  const root = createRoot(t);
  const created = initializeHikari({ rootDir: root });
  const before = readFileSync(resolveOriginPath(root), 'utf8');

  assert.throws(() => initializeHikari({ rootDir: root }), AlreadyInitializedError);

  assert.equal(readFileSync(resolveOriginPath(root), 'utf8'), before);
  assert.equal(restoreHikari({ rootDir: root }).hikariId, created.hikariId);
});

test('initializeHikari refuses a damaged or unsupported record without overwriting it', (t) => {
  const damaged = createRoot(t);
  writeOrigin(damaged, '{ not JSON');
  assert.throws(() => initializeHikari({ rootDir: damaged }), InvalidOriginError);
  assert.equal(readFileSync(resolveOriginPath(damaged), 'utf8'), '{ not JSON');

  const unsupported = createRoot(t);
  writeOrigin(unsupported, originText({ version: 7 }));
  assert.throws(() => initializeHikari({ rootDir: unsupported }), UnsupportedVersionError);
  assert.equal(readFileSync(resolveOriginPath(unsupported), 'utf8'), originText({ version: 7 }));
});

test('restoreHikari returns the same identity outside the initializing call context', (t) => {
  const root = createRoot(t);
  const created = initializeHikari({ rootDir: root });

  const restored = restoreHikari({ rootDir: root });

  assert.equal(restored.hikariId, created.hikariId);
  assert.equal(restored.createdAt, created.createdAt);
  assert.deepEqual(restored, { hikariId: created.hikariId, createdAt: created.createdAt });
});

test('restoreHikari reports a missing origin record without creating anything', (t) => {
  const root = createRoot(t);

  assert.throws(() => restoreHikari({ rootDir: root }), NotInitializedError);

  assert.deepEqual(readdirSync(root), []);
});

test('restoreHikari rejects a malformed origin record', (t) => {
  const cases = [
    'not JSON at all',
    '[]',
    originText({ kind: 'something-else' }),
    originText({ version: undefined }),
    originText({ version: '1' }),
    originText({ hikariId: 'not-a-uuid' }),
    originText({ hikariId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' }),
    originText({ createdAt: '2026-01-01' }),
    originText({ createdAt: '2026-13-01T00:00:00.000Z' }),
    originText({ extra: true }),
  ];

  for (const content of cases) {
    const root = createRoot(t);
    writeOrigin(root, content);
    assert.throws(
      () => restoreHikari({ rootDir: root }),
      InvalidOriginError,
      `expected InvalidOriginError for ${content}`,
    );
  }
});

test('restoreHikari rejects a missing origin field', (t) => {
  const root = createRoot(t);
  writeOrigin(
    root,
    JSON.stringify({ kind: 'hikari-origin', version: 1, createdAt: VALID_CREATED_AT }),
  );

  assert.throws(() => restoreHikari({ rootDir: root }), InvalidOriginError);
});

test('restoreHikari rejects an unsupported origin record version', (t) => {
  const root = createRoot(t);
  writeOrigin(root, originText({ version: 2 }));

  assert.throws(() => restoreHikari({ rootDir: root }), UnsupportedVersionError);
});

test('restoreHikari refuses an ambiguous continuity state', (t) => {
  const root = createRoot(t);
  mkdirSync(resolveOriginPath(root), { recursive: true });

  assert.throws(() => restoreHikari({ rootDir: root }), AmbiguousStateError);
  assert.throws(() => initializeHikari({ rootDir: root }), AmbiguousStateError);
});

test('restoreHikari never treats a leftover temporary file as an origin record', (t) => {
  const empty = createRoot(t);
  mkdirSync(join(empty, 'continuity'), { recursive: true });
  writeFileSync(join(empty, 'continuity', 'origin.json.tmp'), originText());
  assert.throws(() => restoreHikari({ rootDir: empty }), NotInitializedError);

  const initialized = createRoot(t);
  const created = initializeHikari({ rootDir: initialized });
  writeFileSync(
    join(initialized, 'continuity', 'origin.json.tmp'),
    originText({ hikariId: '11111111-1111-4111-8111-111111111111' }),
  );
  assert.equal(restoreHikari({ rootDir: initialized }).hikariId, created.hikariId);
});

test('restoreHikari does not create, modify or repair anything', (t) => {
  const root = createRoot(t);
  const created = initializeHikari({ rootDir: root });
  const before = readFileSync(resolveOriginPath(root), 'utf8');
  const listing = readdirSync(root, { recursive: true });

  const restored = restoreHikari({ rootDir: root });

  assert.equal(restored.hikariId, created.hikariId);
  assert.equal(readFileSync(resolveOriginPath(root), 'utf8'), before);
  assert.deepEqual(readdirSync(root, { recursive: true }), listing);
});

test('continuity plugin provides continuity.current through the runtime', async (t) => {
  const root = createRoot(t);
  const created = initializeHikari({ rootDir: root });
  const runtime = new Runtime();

  const observed = await observeIdentity(runtime, root);

  assert.equal(runtime.getPluginState('continuity'), 'active');
  assert.equal(runtime.getPluginState('test.identity-observer'), 'active');
  assert.equal(observed.current.hikariId, created.hikariId);
  assert.equal(observed.current.createdAt, created.createdAt);

  await runtime.shutdown();
});

test('continuity service exposes the identity and not the persisted record', async (t) => {
  const root = createRoot(t);
  initializeHikari({ rootDir: root });
  const runtime = new Runtime();

  const observed = await observeIdentity(runtime, root);

  assert.deepEqual(Object.keys(observed.service), ['current']);
  assert.deepEqual(Object.keys(observed.current).sort(), ['createdAt', 'hikariId']);
  assert.equal('kind' in observed.current, false);
  assert.equal('version' in observed.current, false);

  await runtime.shutdown();
});

test('a new runtime lifecycle restores the same long-lived subject', async (t) => {
  const root = createRoot(t);
  const created = initializeHikari({ rootDir: root });

  const first = new Runtime();
  const before = await observeIdentity(first, root);
  await first.shutdown();

  const second = new Runtime();
  const after = await observeIdentity(second, root);
  await second.shutdown();

  assert.equal(before.current.hikariId, created.hikariId);
  assert.equal(after.current.hikariId, created.hikariId);
  assert.equal(after.current.createdAt, created.createdAt);
  assert.notEqual(before.current, after.current);
});

test('continuity plugin fails instead of creating a Hikari when no origin exists', async (t) => {
  const root = createRoot(t);
  const runtime = new Runtime();

  await runtime.loadPlugin(continuityPlugin, { rootDir: root });

  assert.equal(runtime.getPluginState('continuity'), 'failed');
  assert.ok(runtime.getPluginError('continuity') instanceof NotInitializedError);
  assert.deepEqual(readdirSync(root), []);
});

test('continuity plugin requires an explicit storage root', async () => {
  const runtime = new Runtime();

  await assert.rejects(() => runtime.loadPlugin(continuityPlugin), /config object/);
  await assert.rejects(
    () => runtime.loadPlugin(continuityPlugin, { rootDir: '   ' }),
    /non-empty rootDir/,
  );
  assert.equal(runtime.getPluginState('continuity'), undefined);
});
