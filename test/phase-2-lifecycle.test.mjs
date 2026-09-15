import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';

import { Runtime } from '../dist/index.js';
import {
  InvalidOriginError,
  continuityPlugin,
  continuityService,
  initializeHikari,
  resolveOriginPath,
  restoreHikari,
} from '../dist/continuity/index.js';
import {
  ChronicleNotInitializedError,
  ChronicleOwnerMismatchError,
  InvalidChronicleStoreError,
  chroniclePlugin,
  chronicleService,
  initializeChronicle,
  resolveChroniclePath,
} from '../dist/chronicle/index.js';

const CLI = join(import.meta.dirname, '..', 'dist', 'cli', 'main.js');
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OTHER_HIKARI_ID = '9c858901-8a57-4791-81fe-4c455b099bc9';

const FACT_A = Object.freeze({
  type: 'lifecycle.observed',
  version: 1,
  occurredAt: '2026-02-01T08:30:00.000Z',
  source: { kind: 'phase-2-lifecycle', reference: 'runtime-a' },
  payload: {
    note: 'Runtime A appended this fact',
    nested: { list: [1, 'two', false, null], depth: { value: 3 } },
  },
});

const ALL_ACTIVE = {
  continuity: 'active',
  chronicle: 'active',
  continuityProbe: 'active',
  probe: 'active',
};

function createRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'hikari-lifecycle-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function snapshot(root) {
  const files = {};
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else files[relative(root, full).replaceAll('\\', '/')] = readFileSync(full, 'utf8');
    }
  };
  walk(root);
  return files;
}

// Probes are test-only: they never enter src/, and they reach the domain
// services exclusively through the ordinary Plugin Context.
//
// Two probes are needed because they observe different graph states:
//   - observer: requires continuity only, so it still activates when the
//     fact history is refused, proving the subject itself was restored;
//   - probe: requires both, so it activates only when the whole Phase 2
//     composition converged.
function createContinuityObserver() {
  const captured = { context: undefined, continuity: undefined };
  const definition = {
    id: 'test.continuity-observer',
    version: '1.0.0',
    requires: [continuityService],
    setup(context) {
      captured.context = context;
      captured.continuity = context.services.get(continuityService);
    },
  };
  return { definition, captured };
}

function createProbe() {
  const captured = { context: undefined, continuity: undefined, chronicle: undefined };
  const definition = {
    id: 'test.probe',
    version: '1.0.0',
    requires: [continuityService, chronicleService],
    setup(context) {
      captured.context = context;
      captured.continuity = context.services.get(continuityService);
      captured.chronicle = context.services.get(chronicleService);
    },
  };
  return { definition, captured };
}

function createHandle() {
  return {
    runtime: new Runtime(),
    observer: createContinuityObserver(),
    probe: createProbe(),
  };
}

// One real Runtime lifecycle: the domain plugins converge through the
// dependency graph, then the probes report whatever the graph produced.
async function mount(root, handle = createHandle()) {
  const { runtime, observer, probe } = handle;
  const states = {
    continuity: await runtime.loadPlugin(continuityPlugin, { rootDir: root }),
    chronicle: await runtime.loadPlugin(chroniclePlugin, { rootDir: root }),
    continuityProbe: await runtime.loadPlugin(observer.definition),
    probe: await runtime.loadPlugin(probe.definition),
  };
  return {
    runtime,
    definition: probe.definition,
    captured: probe.captured,
    observed: observer.captured,
    states,
  };
}

async function mountAndReport(root) {
  const mounted = await mount(root);
  const error = mounted.runtime.getPluginError('chronicle');
  await mounted.runtime.shutdown();
  return { ...mounted, error };
}

function seed(root) {
  const identity = initializeHikari({ rootDir: root });
  initializeChronicle({ rootDir: root, identity });
  return identity;
}

// Runtime A appends FACT_A through the dependency graph, then shuts down.
async function runRuntimeA(root) {
  const a = await mount(root);
  assert.deepEqual(a.states, ALL_ACTIVE);
  const factA = await a.captured.chronicle.append(FACT_A);
  await a.runtime.shutdown();
  return { ...a, factA };
}

function runCli(...args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  assert.equal(result.error, undefined);
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function withOwner(text, owner) {
  const lines = text.split('\n');
  const header = JSON.parse(lines[0]);
  lines[0] = JSON.stringify({ ...header, owner });
  return lines.join('\n');
}

test('Runtime A appends Fact A and an entirely new Runtime B recovers the same Hikari and the same fact', async (t) => {
  const root = createRoot(t);
  const seeded = seed(root);

  const originPath = resolveOriginPath(root);
  const storePath = resolveChroniclePath(root);
  const originBefore = readFileSync(originPath, 'utf8');

  // ---- Runtime A ----
  const a = await runRuntimeA(root);
  const identityA = a.captured.continuity.current;
  const storeAfterAppend = readFileSync(storePath, 'utf8');

  assert.match(identityA.hikariId, UUID_V4);
  assert.equal(identityA.hikariId, seeded.hikariId);
  assert.match(storeAfterAppend, new RegExp(a.factA.factId));

  // Requirement 5: Runtime A shutdown neither deletes nor modifies Origin / Chronicle.
  assert.equal(readFileSync(originPath, 'utf8'), originBefore);
  assert.equal(readFileSync(storePath, 'utf8'), storeAfterAppend);

  // ---- Runtime B: a brand new Runtime instance ----
  const beforeB = snapshot(root);
  const b = await mount(root);
  assert.deepEqual(b.states, ALL_ACTIVE);

  const identityB = b.captured.continuity.current;
  const factB = await b.captured.chronicle.get(a.factA.factId);
  const factsB = await b.captured.chronicle.read();

  // Requirement 2: the same hikariId across two independent Runtime lifecycles.
  assert.equal(identityB.hikariId, identityA.hikariId);
  assert.equal(identityB.createdAt, identityA.createdAt);
  assert.equal(identityB.hikariId, seeded.hikariId);
  assert.equal(identityB.hikariId, JSON.parse(originBefore).hikariId);
  assert.equal(identityB.hikariId, restoreHikari({ rootDir: root }).hikariId);

  // Requirement 3: Fact A is recoverable across Runtime lifecycles.
  assert.notEqual(factB, undefined);
  assert.equal(factsB.length, 1);
  assert.deepEqual(factsB, [factB]);
  assert.equal(factB.factId, a.factA.factId);

  // Requirement 4: every DurableFact field survives the restart unchanged.
  assert.deepEqual(factB, a.factA);
  assert.equal(factB.factId, a.factA.factId);
  assert.equal(factB.type, a.factA.type);
  assert.equal(factB.version, a.factA.version);
  assert.equal(factB.occurredAt, a.factA.occurredAt);
  assert.equal(factB.recordedAt, a.factA.recordedAt);
  assert.deepEqual(factB.source, a.factA.source);
  assert.deepEqual(factB.payload, a.factA.payload);
  assert.equal(factB.type, FACT_A.type);
  assert.equal(factB.source.reference, 'runtime-a');
  assert.deepEqual(factB.payload, FACT_A.payload);
  assert.deepEqual(Object.keys(factB).sort(), [
    'factId',
    'occurredAt',
    'payload',
    'recordedAt',
    'source',
    'type',
    'version',
  ]);

  await b.runtime.shutdown();

  // Requirement 6: Runtime B recovery is byte-for-byte pure.
  assert.equal(readFileSync(originPath, 'utf8'), originBefore);
  assert.equal(readFileSync(storePath, 'utf8'), storeAfterAppend);
  assert.deepEqual(snapshot(root), beforeB);
  assert.deepEqual(Object.keys(snapshot(root)).sort(), [
    'chronicle/chronicle.jsonl',
    'continuity/origin.json',
  ]);
});

test('Runtime A and Runtime B share no Runtime, Context, Plugin or Service instance', async (t) => {
  const root = createRoot(t);
  seed(root);

  const a = await runRuntimeA(root);
  const b = await mount(root);

  // Requirement 1: two fully independent Runtime instances.
  assert.notEqual(a.runtime, b.runtime);

  // Requirement 7: no Context and no Plugin instance is reused.
  assert.notEqual(a.captured.context, b.captured.context);
  assert.equal(a.captured.context.pluginId, 'test.probe');
  assert.equal(b.captured.context.pluginId, 'test.probe');
  assert.notEqual(a.definition, b.definition);

  // Requirement 7: no Service instance is reused, even though the recovered
  // identity carries the same value.
  assert.notEqual(a.captured.continuity, b.captured.continuity);
  assert.notEqual(a.captured.chronicle, b.captured.chronicle);
  assert.notEqual(a.captured.continuity.current, b.captured.continuity.current);
  assert.equal(a.captured.continuity.current.hikariId, b.captured.continuity.current.hikariId);

  // The fact B sees comes from B's own service reading B's own store handle.
  const factsB = await b.captured.chronicle.read();
  assert.deepEqual(
    factsB.map((fact) => fact.factId),
    [a.factA.factId],
  );
  assert.deepEqual(await a.captured.chronicle.read(), factsB);

  await b.runtime.shutdown();
});

test('Runtime B reports the fact as it is on disk, not as Runtime A left it in memory', async (t) => {
  const root = createRoot(t);
  seed(root);

  const a = await runRuntimeA(root);
  const storePath = resolveChroniclePath(root);
  const REWRITTEN = 'rewritten on disk after Runtime A ended';

  // Runtime A is gone, but its Service objects are still referenced by this
  // test. Rewrite the stored fact into a different, still-valid fact: a
  // Runtime answering from reconstructed memory would report Runtime A's value.
  const [header, factLine] = readFileSync(storePath, 'utf8').split('\n');
  const onDisk = JSON.parse(factLine);
  const rewritten = {
    ...onDisk,
    payload: { ...onDisk.payload, note: REWRITTEN },
  };
  writeFileSync(storePath, `${header}\n${JSON.stringify(rewritten)}\n`);
  const rewrittenBytes = readFileSync(storePath, 'utf8');

  const before = snapshot(root);
  const b = await mount(root);
  assert.deepEqual(b.states, ALL_ACTIVE);

  const viaGet = await b.captured.chronicle.get(a.factA.factId);
  const viaRead = await b.captured.chronicle.read();
  await b.runtime.shutdown();

  assert.equal(viaGet.payload.note, REWRITTEN);
  assert.equal(viaRead.length, 1);
  assert.equal(viaRead[0].payload.note, REWRITTEN);
  assert.notEqual(viaRead[0].payload.note, a.factA.payload.note);

  // The rewrite touched the payload only: the rest of Runtime A's fact is intact.
  assert.equal(viaGet.factId, a.factA.factId);
  assert.equal(viaGet.type, a.factA.type);
  assert.equal(viaGet.version, a.factA.version);
  assert.equal(viaGet.occurredAt, a.factA.occurredAt);
  assert.equal(viaGet.recordedAt, a.factA.recordedAt);
  assert.deepEqual(viaGet.source, a.factA.source);

  assert.deepEqual(snapshot(root), before);
  assert.equal(readFileSync(storePath, 'utf8'), rewrittenBytes);
});

test('a store damaged after Runtime A ended is refused by Runtime B', async (t) => {
  const root = createRoot(t);
  seed(root);

  const a = await runRuntimeA(root);
  const storePath = resolveChroniclePath(root);

  const lines = readFileSync(storePath, 'utf8').split('\n');
  lines[1] = '{ not valid json }';
  writeFileSync(storePath, lines.join('\n'));

  const before = snapshot(root);
  const b = await mountAndReport(root);

  assert.equal(b.states.continuity, 'active');
  assert.equal(b.states.continuityProbe, 'active');
  assert.equal(b.observed.continuity.current.hikariId, a.captured.continuity.current.hikariId);

  assert.equal(b.states.chronicle, 'failed');
  assert.equal(b.states.probe, 'waiting');
  assert.ok(b.error instanceof InvalidChronicleStoreError);
  assert.match(b.error.message, /fact line is not valid JSON/);

  // The full probe never activated, so no service could hand back a remembered fact.
  assert.equal(b.captured.chronicle, undefined);
  assert.deepEqual(snapshot(root), before);
});

test('data created by the real CLI binary is recovered by the Runtime lifecycle', async (t) => {
  const root = createRoot(t);

  assert.equal(runCli('init', '--data-dir', root).code, 0);
  assert.equal(runCli('chronicle', 'init', '--data-dir', root).code, 0);

  const originPath = resolveOriginPath(root);
  const storePath = resolveChroniclePath(root);
  const originBefore = readFileSync(originPath, 'utf8');

  const a = await runRuntimeA(root);
  const storeAfterAppend = readFileSync(storePath, 'utf8');

  const b = await mount(root);
  const factB = await b.captured.chronicle.get(a.factA.factId);
  await b.runtime.shutdown();

  assert.notEqual(factB, undefined);
  assert.deepEqual(factB, a.factA);
  assert.equal(readFileSync(originPath, 'utf8'), originBefore);
  assert.equal(readFileSync(storePath, 'utf8'), storeAfterAppend);

  // The CLI start path still recognises the data written across both Runtimes.
  const started = runCli('start', '--data-dir', root);
  assert.equal(started.code, 0);
  assert.match(started.stdout, /continuity 状态：active/);
  assert.match(started.stdout, /chronicle 状态：active/);
  assert.equal(readFileSync(originPath, 'utf8'), originBefore);
  assert.equal(readFileSync(storePath, 'utf8'), storeAfterAppend);
});

const CORRUPTIONS = [
  {
    label: 'store truncated mid-fact',
    corrupt: (text) => text.slice(0, text.length - 24),
    error: InvalidChronicleStoreError,
    reason: /store does not end with a newline/,
  },
  {
    label: 'store is empty',
    corrupt: () => '',
    error: InvalidChronicleStoreError,
    reason: /store does not end with a newline/,
  },
  {
    label: 'header is not valid JSON',
    corrupt: (text) => `{ not json }\n${text.split('\n').slice(1).join('\n')}`,
    error: InvalidChronicleStoreError,
    reason: /header is not valid JSON/,
  },
  {
    label: 'header line is blank',
    corrupt: (text) => `\n${text.split('\n').slice(1).join('\n')}`,
    error: InvalidChronicleStoreError,
    reason: /header is not valid JSON/,
  },
  {
    label: 'header kind is wrong',
    corrupt: (text) => text.replace('"hikari-chronicle"', '"hikari-other"'),
    error: InvalidChronicleStoreError,
    reason: /header kind is not hikari-chronicle/,
  },
  {
    label: 'fact line is not valid JSON',
    corrupt: (text) => `${text.split('\n')[0]}\n{ broken }\n`,
    error: InvalidChronicleStoreError,
    reason: /fact line is not valid JSON/,
  },
  {
    label: 'store belongs to another Hikari',
    corrupt: (text) => withOwner(text, OTHER_HIKARI_ID),
    error: ChronicleOwnerMismatchError,
    reason: /belongs to .*not to/,
  },
];

for (const { label, corrupt, error, reason } of CORRUPTIONS) {
  test(`a new Runtime refuses to run on a damaged chronicle store: ${label}`, async (t) => {
    const root = createRoot(t);
    seed(root);
    const a = await runRuntimeA(root);
    const identityA = a.captured.continuity.current;

    const storePath = resolveChroniclePath(root);
    writeFileSync(storePath, corrupt(readFileSync(storePath, 'utf8')));
    const damaged = readFileSync(storePath, 'utf8');
    const before = snapshot(root);

    const b = await mountAndReport(root);

    // Requirement 8: the failure is honest and localized. The subject is
    // restored through the same dependency graph; only the fact history is
    // refused, and the refusal is reported as the real domain error.
    assert.equal(b.states.continuity, 'active');
    assert.equal(b.states.continuityProbe, 'active');
    assert.equal(b.observed.continuity.current.hikariId, identityA.hikariId);
    assert.equal(b.observed.continuity.current.createdAt, identityA.createdAt);

    assert.equal(b.states.chronicle, 'failed');
    assert.equal(b.states.probe, 'waiting');
    assert.ok(b.error instanceof error, `expected ${error.name}, got ${b.error}`);
    assert.match(b.error.message, reason);

    // No service was handed out, so an empty history cannot be observed either.
    assert.equal(b.captured.chronicle, undefined);

    // No automatic creation, repair, truncation or rewriting.
    assert.equal(readFileSync(storePath, 'utf8'), damaged);
    assert.deepEqual(snapshot(root), before);
  });
}

// Documented limit, not an asserted guarantee. Chronicle v1 carries no
// integrity marker (no fact count, no chain hash, no tombstone), so a store
// whose fact lines were removed is structurally identical to the store
// initializeChronicle() writes. The Runtime must not invent a mechanism to
// guess the difference, so this case is recorded for what it actually is.
test('documented limit: a well-formed store with its facts removed is indistinguishable from a fresh store', async (t) => {
  const root = createRoot(t);
  seed(root);
  const a = await runRuntimeA(root);

  const storePath = resolveChroniclePath(root);
  const headerOnly = `${readFileSync(storePath, 'utf8').split('\n')[0]}\n`;
  writeFileSync(storePath, headerOnly);

  const before = snapshot(root);
  const b = await mount(root);

  assert.deepEqual(b.states, ALL_ACTIVE);
  assert.deepEqual(await b.captured.chronicle.read(), []);
  assert.equal(await b.captured.chronicle.get(a.factA.factId), undefined);

  await b.runtime.shutdown();

  // The Runtime still writes nothing: it reports an empty history, it does not
  // delete, extend or "repair" the file it was given.
  assert.equal(readFileSync(storePath, 'utf8'), headerOnly);
  assert.deepEqual(snapshot(root), before);
});

test('a new Runtime never recreates a deleted chronicle store', async (t) => {
  const root = createRoot(t);
  seed(root);
  await runRuntimeA(root);

  const storePath = resolveChroniclePath(root);
  rmSync(storePath);
  const before = snapshot(root);

  const b = await mountAndReport(root);

  assert.equal(b.states.continuity, 'active');
  assert.equal(b.states.continuityProbe, 'active');
  assert.equal(b.states.chronicle, 'failed');
  assert.equal(b.states.probe, 'waiting');
  assert.ok(b.error instanceof ChronicleNotInitializedError);
  assert.match(b.error.message, /Chronicle store does not exist/);
  assert.equal(b.captured.chronicle, undefined);

  assert.equal(existsSync(storePath), false);
  assert.deepEqual(snapshot(root), before);
});

test('a new Runtime never recreates a deleted origin record', async (t) => {
  const root = createRoot(t);
  seed(root);

  const originPath = resolveOriginPath(root);
  const storePath = resolveChroniclePath(root);
  rmSync(originPath);
  const storeBefore = readFileSync(storePath, 'utf8');

  const mounted = await mount(root);
  const error = mounted.runtime.getPluginError('continuity');
  await mounted.runtime.shutdown();

  // Nothing converges: without the subject there is no fact history either,
  // and neither plugin is reported as active.
  assert.equal(mounted.states.continuity, 'failed');
  assert.equal(mounted.states.continuityProbe, 'waiting');
  assert.equal(mounted.states.chronicle, 'waiting');
  assert.equal(mounted.states.probe, 'waiting');
  assert.match(String(error), /origin record does not exist/);
  assert.equal(mounted.captured.chronicle, undefined);
  assert.equal(mounted.observed.continuity, undefined);

  assert.equal(existsSync(originPath), false);
  assert.equal(readFileSync(storePath, 'utf8'), storeBefore);
});

test('a new Runtime refuses to run on a damaged origin record without repairing it', async (t) => {
  const root = createRoot(t);
  seed(root);

  const originPath = resolveOriginPath(root);
  const storePath = resolveChroniclePath(root);
  const damaged = readFileSync(originPath, 'utf8').replace('"hikari-origin"', '"hikari-other"');
  writeFileSync(originPath, damaged);
  const storeBefore = readFileSync(storePath, 'utf8');

  const mounted = await mount(root);
  const error = mounted.runtime.getPluginError('continuity');
  await mounted.runtime.shutdown();

  assert.equal(mounted.states.continuity, 'failed');
  assert.equal(mounted.states.continuityProbe, 'waiting');
  assert.equal(mounted.states.chronicle, 'waiting');
  assert.equal(mounted.states.probe, 'waiting');
  assert.ok(error instanceof InvalidOriginError);
  assert.match(error.message, /kind is not hikari-origin/);

  assert.equal(readFileSync(originPath, 'utf8'), damaged);
  assert.equal(readFileSync(storePath, 'utf8'), storeBefore);
});
