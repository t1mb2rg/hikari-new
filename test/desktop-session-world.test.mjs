import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';

import { Runtime } from '../dist/index.js';
import { chroniclePlugin, initializeChronicle, resolveChroniclePath } from '../dist/chronicle/index.js';
import { continuityPlugin, initializeHikari, resolveOriginPath } from '../dist/continuity/index.js';
import { ForegroundObservationError, foregroundService } from '../dist/foreground/index.js';
import { InputActivityObservationError, inputActivityService } from '../dist/input-activity/index.js';
import {
  desktopSessionWorldPlugin,
  desktopSessionWorldService,
} from '../dist/desktop-session-world/index.js';

const OBSERVED_AT = '2026-02-01T08:30:00.000Z';
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const FOREGROUND_PROVIDER = 'test.foreground-provider';
const INPUT_ACTIVITY_PROVIDER = 'test.input-activity-provider';
const OBSERVER = 'test.desktop-session-world-observer';

// No injection seam: the tests supply fake *providers* as ordinary plugins and let the real Runtime
// dependency graph decide who is active. The World plugin under test is the production one.
function provider(pluginId, contract, behaviour) {
  const counts = { calls: 0 };
  const definition = {
    id: pluginId,
    version: '1.0.0',
    provides: [contract],
    setup(context) {
      context.services.provide(
        contract,
        Object.freeze({
          current() {
            counts.calls += 1;
            return behaviour(counts.calls);
          },
        }),
      );
    },
  };
  return { definition, counts };
}

function foregroundProvider(behaviour) {
  return provider(FOREGROUND_PROVIDER, foregroundService, behaviour);
}

function inputActivityProvider(behaviour) {
  return provider(INPUT_ACTIVITY_PROVIDER, inputActivityService, behaviour);
}

function foregroundObservation(target = { kind: 'absent' }, observedAt = OBSERVED_AT) {
  return Object.freeze({ observedAt, source: 'foreground.windows', foreground: target });
}

function inputActivityObservation(lastInputTick = 123456, observedAt = OBSERVED_AT) {
  return Object.freeze({ observedAt, source: 'input-activity.windows', lastInputTick });
}

function observerDefinition(observed) {
  return {
    id: OBSERVER,
    version: '1.0.0',
    requires: [desktopSessionWorldService],
    setup(context) {
      observed.service = context.services.get(desktopSessionWorldService);
    },
  };
}

async function loadAll(runtime, foreground, inputActivity) {
  const observed = {};
  await runtime.loadPlugin(foreground.definition);
  await runtime.loadPlugin(inputActivity.definition);
  await runtime.loadPlugin(desktopSessionWorldPlugin);
  await runtime.loadPlugin(observerDefinition(observed));
  return observed;
}

async function runningWorld(t, foreground, inputActivity) {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());
  const observed = await loadAll(runtime, foreground, inputActivity);
  return { runtime, observed };
}

function succeeding(foreground, inputActivity) {
  return [
    foregroundProvider(() => Promise.resolve(foregroundObservation(foreground))),
    inputActivityProvider(() => Promise.resolve(inputActivityObservation(inputActivity))),
  ];
}

// Yields one whole event-loop turn, which drains every pending microtask. A macrotask boundary is
// deterministic — unlike a sleep, it proves the pending work is finished rather than that it
// probably had enough time.
function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

// Returns once the wall clock has left the millisecond it was called in, and hands back the new
// reading. This waits on the clock itself rather than on a guessed duration, so the returned value
// is provably greater than any timestamp taken before the call. It exists because the whole world
// snapshot runs in well under a millisecond: without crossing a millisecond boundary, a stamp taken
// before the sources settle and one taken after are indistinguishable.
async function nextMillisecond() {
  const started = Date.now();
  let current = started;
  while (current === started) {
    await nextTurn();
    current = Date.now();
  }
  return current;
}

function listFiles(root) {
  return readdirSync(root, { recursive: true })
    .map((entry) => join(root, entry))
    .filter((full) => statSync(full).isFile())
    .map((full) => relative(root, full))
    .sort();
}

function snapshot(root) {
  return listFiles(root).map((file) => `${file}:${readFileSync(join(root, file), 'utf8')}`);
}

test('the world plugin requires exactly the two perception capabilities and provides its own', async (t) => {
  assert.deepEqual(desktopSessionWorldPlugin.requires, [foregroundService, inputActivityService]);
  assert.deepEqual(desktopSessionWorldPlugin.provides, [desktopSessionWorldService]);
  assert.equal(desktopSessionWorldPlugin.id, 'desktop-session-world');
  assert.equal(desktopSessionWorldPlugin.version, '1.0.0');
  assert.equal(desktopSessionWorldService.id, 'desktop-session-world.current');
  assert.equal(desktopSessionWorldService.version, 1);

  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  assert.equal(await runtime.loadPlugin(desktopSessionWorldPlugin), 'waiting');
});

test('the world service is reachable through the plugin dependency graph', async (t) => {
  const [foreground, inputActivity] = succeeding({ kind: 'absent' }, 1);
  const { runtime, observed } = await runningWorld(t, foreground, inputActivity);

  assert.equal(runtime.getPluginState('desktop-session-world'), 'active');
  assert.equal(runtime.getPluginState(OBSERVER), 'active');
  assert.deepEqual(Object.keys(observed.service), ['current']);
});

test('the world waits for both capabilities and converges without continuity or chronicle', async (t) => {
  const [foreground, inputActivity] = succeeding({ kind: 'absent' }, 1);
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  await runtime.loadPlugin(desktopSessionWorldPlugin);
  assert.equal(runtime.getPluginState('desktop-session-world'), 'waiting');

  await runtime.loadPlugin(foreground.definition);
  assert.equal(runtime.getPluginState('desktop-session-world'), 'waiting');

  await runtime.loadPlugin(inputActivity.definition);
  assert.equal(runtime.getPluginState('desktop-session-world'), 'active');

  assert.equal(runtime.getPluginState('continuity'), undefined);
  assert.equal(runtime.getPluginState('chronicle'), undefined);
});

test('the world returns to waiting when a required provider disappears and activates again when it returns', async (t) => {
  const [foreground, inputActivity] = succeeding({ kind: 'absent' }, 1);
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  await runtime.loadPlugin(foreground.definition);
  await runtime.loadPlugin(inputActivity.definition);
  await runtime.loadPlugin(desktopSessionWorldPlugin);
  assert.equal(runtime.getPluginState('desktop-session-world'), 'active');

  await runtime.unloadPlugin(FOREGROUND_PROVIDER);
  assert.equal(runtime.getPluginState('desktop-session-world'), 'waiting');

  await runtime.loadPlugin(foreground.definition);
  assert.equal(runtime.getPluginState('desktop-session-world'), 'active');
});

test('a successful snapshot carries both source observations unchanged', async (t) => {
  const foregroundValue = foregroundObservation({
    kind: 'present',
    title: 'Untitled - Notepad',
    processName: 'notepad',
  });
  const inputActivityValue = inputActivityObservation(123456);
  const { observed } = await runningWorld(
    t,
    foregroundProvider(() => Promise.resolve(foregroundValue)),
    inputActivityProvider(() => Promise.resolve(inputActivityValue)),
  );

  const result = await observed.service.current();

  assert.equal(result.foreground.kind, 'available');
  assert.equal(result.inputActivity.kind, 'available');

  // Reference identity, not deep equality: the World composes the observations it was handed and
  // never rebuilds them.
  assert.equal(result.foreground.observation, foregroundValue);
  assert.equal(result.inputActivity.observation, inputActivityValue);

  assert.equal(result.foreground.observation.source, 'foreground.windows');
  assert.equal(result.inputActivity.observation.source, 'input-activity.windows');
  assert.equal(result.foreground.observation.observedAt, OBSERVED_AT);
  assert.equal(result.inputActivity.observation.observedAt, OBSERVED_AT);

  // The sources' timestamps are historical, so anything the World re-stamped would be visible here.
  assert.ok(Math.abs(Date.now() - Date.parse(OBSERVED_AT)) > 60_000);
});

test('snapshotAt is a world timestamp produced after both facets settle', async (t) => {
  let releaseInputActivity;
  const inputActivityGate = new Promise((resolve) => {
    releaseInputActivity = resolve;
  });
  let finalSettlementAt = 0;

  const { observed } = await runningWorld(
    t,
    foregroundProvider(() => Promise.resolve(foregroundObservation())),
    inputActivityProvider(() =>
      inputActivityGate.then(() => {
        finalSettlementAt = Date.now();
        return inputActivityObservation();
      }),
    ),
  );

  const before = Date.now();
  const pending = observed.service.current();

  await nextTurn();
  assert.equal(finalSettlementAt, 0, 'the gated source settled before it was released');

  // Cross a millisecond boundary while the last source is still held open. Anything stamped before
  // the sources settle now lands in a strictly earlier millisecond than anything stamped after.
  const boundary = await nextMillisecond();
  assert.ok(boundary > before, 'the clock never advanced, so this test could not discriminate');

  releaseInputActivity();
  const result = await pending;

  assert.match(result.snapshotAt, UTC_TIMESTAMP);
  assert.notEqual(result.snapshotAt, OBSERVED_AT);
  assert.ok(finalSettlementAt > 0, 'the gated source never settled');
  assert.ok(Date.parse(result.snapshotAt) >= before, 'snapshotAt predates the call');
  assert.ok(
    Date.parse(result.snapshotAt) >= boundary,
    `snapshotAt ${result.snapshotAt} was taken before the last source settled at ${finalSettlementAt}`,
  );
});

test('the snapshot and both facet wrappers are frozen', async (t) => {
  const [availableForeground, availableInputActivity] = succeeding({ kind: 'absent' }, 1);
  const available = await runningWorld(t, availableForeground, availableInputActivity);
  const availableResult = await available.observed.service.current();

  assert.equal(Object.isFrozen(availableResult), true);
  assert.equal(Object.isFrozen(availableResult.foreground), true);
  assert.equal(Object.isFrozen(availableResult.inputActivity), true);

  const { observed } = await runningWorld(
    t,
    foregroundProvider(() => Promise.reject(new ForegroundObservationError('exited with code 1'))),
    inputActivityProvider(() => Promise.reject(new InputActivityObservationError('exited with code 1'))),
  );
  const unavailableResult = await observed.service.current();

  assert.equal(Object.isFrozen(unavailableResult), true);
  assert.equal(Object.isFrozen(unavailableResult.foreground), true);
  assert.equal(Object.isFrozen(unavailableResult.inputActivity), true);
});

test('every current() call performs a fresh acquisition of both facets', async (t) => {
  const { observed } = await runningWorld(
    t,
    foregroundProvider((nth) =>
      Promise.resolve(foregroundObservation({ kind: 'present', title: `observation ${nth}` })),
    ),
    inputActivityProvider((nth) => Promise.resolve(inputActivityObservation(nth))),
  );

  const first = await observed.service.current();
  const second = await observed.service.current();

  assert.equal(first.foreground.observation.foreground.title, 'observation 1');
  assert.equal(second.foreground.observation.foreground.title, 'observation 2');
  assert.equal(first.inputActivity.observation.lastInputTick, 1);
  assert.equal(second.inputActivity.observation.lastInputTick, 2);
  assert.notEqual(first, second);
});

test('a foreground failure makes only the foreground facet unavailable', async (t) => {
  const { observed } = await runningWorld(
    t,
    foregroundProvider(() =>
      Promise.reject(new ForegroundObservationError('the acquisition process exited with code 1')),
    ),
    inputActivityProvider(() => Promise.resolve(inputActivityObservation(42))),
  );

  const result = await observed.service.current();

  assert.equal(result.foreground.kind, 'unavailable');
  assert.deepEqual(Object.keys(result.foreground), ['kind']);
  assert.equal(result.inputActivity.kind, 'available');
  assert.equal(result.inputActivity.observation.lastInputTick, 42);
});

test('an input activity failure makes only the input activity facet unavailable', async (t) => {
  const { observed } = await runningWorld(
    t,
    foregroundProvider(() => Promise.resolve(foregroundObservation({ kind: 'present', title: 'x' }))),
    inputActivityProvider(() =>
      Promise.reject(new InputActivityObservationError('the acquisition process did not finish in time')),
    ),
  );

  const result = await observed.service.current();

  assert.equal(result.foreground.kind, 'available');
  assert.equal(result.foreground.observation.foreground.title, 'x');
  assert.equal(result.inputActivity.kind, 'unavailable');
  assert.deepEqual(Object.keys(result.inputActivity), ['kind']);
});

test('both sources failing still resolves with both facets unavailable', async (t) => {
  const { observed } = await runningWorld(
    t,
    foregroundProvider(() => Promise.reject(new ForegroundObservationError('exited with code 1'))),
    inputActivityProvider(() => Promise.reject(new InputActivityObservationError('exited with code 1'))),
  );

  const settled = await observed.service.current().then(
    (result) => ({ outcome: 'resolved', result }),
    (error) => ({ outcome: 'rejected', error }),
  );

  assert.equal(settled.outcome, 'resolved');
  assert.equal(settled.result.foreground.kind, 'unavailable');
  assert.equal(settled.result.inputActivity.kind, 'unavailable');
  assert.match(settled.result.snapshotAt, UTC_TIMESTAMP);
});

test('a source that throws synchronously is recorded as unavailability, never classified', async (t) => {
  const { observed } = await runningWorld(
    t,
    foregroundProvider(() => {
      throw new Error('something nobody modelled yet');
    }),
    inputActivityProvider(() => Promise.resolve(inputActivityObservation(7))),
  );

  const result = await observed.service.current();

  // The World reads the settlement status and nothing else, so an unmodelled throw lands in exactly
  // the same place a typed observation error would.
  assert.equal(result.foreground.kind, 'unavailable');
  assert.equal(result.inputActivity.kind, 'available');
  assert.equal(result.inputActivity.observation.lastInputTick, 7);
});

test('a successfully observed absent foreground target stays available', async (t) => {
  const [foreground, inputActivity] = succeeding({ kind: 'absent' }, 5);
  const { observed } = await runningWorld(t, foreground, inputActivity);

  const result = await observed.service.current();

  // Observed absence and failure-to-observe are different facts and must never collapse into one.
  assert.equal(result.foreground.kind, 'available');
  assert.equal(result.foreground.observation.foreground.kind, 'absent');
  assert.deepEqual(result.foreground.observation.foreground, { kind: 'absent' });
});

test('both perceptions are started before either one settles', async (t) => {
  let releaseForeground;
  const foregroundGate = new Promise((resolve) => {
    releaseForeground = resolve;
  });

  const foreground = foregroundProvider(() => foregroundGate.then(() => foregroundObservation()));
  const inputActivity = inputActivityProvider(() => Promise.resolve(inputActivityObservation()));
  const { observed } = await runningWorld(t, foreground, inputActivity);

  let settled = false;
  const pending = observed.service.current().then((result) => {
    settled = true;
    return result;
  });

  await nextTurn();

  assert.equal(foreground.counts.calls, 1);
  assert.equal(
    inputActivity.counts.calls,
    1,
    'the second perception was not started before the first one settled',
  );
  assert.equal(settled, false, 'the snapshot resolved while a source was still pending');

  releaseForeground();
  const result = await pending;

  assert.equal(result.foreground.kind, 'available');
  assert.equal(result.inputActivity.kind, 'available');
  assert.equal(foreground.counts.calls, 1);
  assert.equal(inputActivity.counts.calls, 1);
});

test('the world performs no observation at setup, while idle, or at shutdown', async (t) => {
  const [foreground, inputActivity] = succeeding({ kind: 'absent' }, 1);
  const runtime = new Runtime();

  const observed = await loadAll(runtime, foreground, inputActivity);

  assert.equal(runtime.getPluginState('desktop-session-world'), 'active');
  assert.equal(typeof observed.service.current, 'function');
  assert.equal(foreground.counts.calls, 0);
  assert.equal(inputActivity.counts.calls, 0);

  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(foreground.counts.calls, 0);
  assert.equal(inputActivity.counts.calls, 0);

  await runtime.shutdown();
  assert.equal(foreground.counts.calls, 0);
  assert.equal(inputActivity.counts.calls, 0);
  assert.equal(runtime.getPluginState('desktop-session-world'), undefined);
});

test('world snapshots leave continuity and chronicle storage untouched', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'hikari-desktop-session-world-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const identity = initializeHikari({ rootDir: root });
  initializeChronicle({ rootDir: root, identity });
  const before = snapshot(root);

  const runtime = new Runtime();
  await runtime.loadPlugin(continuityPlugin, { rootDir: root });
  await runtime.loadPlugin(chroniclePlugin, { rootDir: root });
  const [foreground, inputActivity] = succeeding({ kind: 'present', title: 'x' }, 123456);
  const observed = await loadAll(runtime, foreground, inputActivity);

  await observed.service.current();
  await observed.service.current();
  assert.deepEqual(snapshot(root), before);

  await runtime.shutdown();
  assert.deepEqual(snapshot(root), before);
  assert.deepEqual(listFiles(root), [
    join('chronicle', 'chronicle.jsonl'),
    join('continuity', 'origin.json'),
  ]);
  assert.equal(resolveOriginPath(root).endsWith('origin.json'), true);
  assert.equal(resolveChroniclePath(root).endsWith('chronicle.jsonl'), true);
});

test('the world module depends only on the two public perception contracts', () => {
  const dir = new URL('../src/desktop-session-world/', import.meta.url);
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.ts'))
    .sort();
  assert.deepEqual(files, ['contracts.ts', 'index.ts', 'plugin.ts', 'types.ts']);

  const publicEntryPoints = new Set([
    '../foreground/index.js',
    '../input-activity/index.js',
    '../runtime/contracts.js',
    '../runtime/plugin.js',
  ]);

  for (const name of files) {
    const source = readFileSync(new URL(name, dir), 'utf8');
    for (const [, specifier] of source.matchAll(/from\s+'([^']+)'/g)) {
      assert.ok(
        specifier.startsWith('./') || publicEntryPoints.has(specifier),
        `${name} reaches ${specifier}, which is not a public entry point`,
      );
    }
  }

  // The World composes two capabilities; it owns no platform transport of its own. Only
  // unambiguous identifiers appear here — the file list above already covers a stray acquisition
  // layer, and a common English noun would just force prose to be written around it.
  const combined = files.map((name) => readFileSync(new URL(name, dir), 'utf8')).join('\n');
  for (const token of [
    'process.platform',
    'powershell',
    'PowerShell',
    'execFile',
    'LASTINPUTINFO',
    'HWND',
  ]) {
    assert.equal(combined.includes(token), false, `the world module must not contain "${token}"`);
  }
});
