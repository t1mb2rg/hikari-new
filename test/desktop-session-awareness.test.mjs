import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

import { Runtime } from '../dist/index.js';
import { foregroundService } from '../dist/foreground/index.js';
import { inputActivityService } from '../dist/input-activity/index.js';
import {
  desktopSessionWorldPlugin,
  desktopSessionWorldService,
} from '../dist/desktop-session-world/index.js';
import {
  desktopSessionAwarenessPlugin,
  desktopSessionAwarenessService,
} from '../dist/desktop-session-awareness/index.js';

const OBSERVED_AT = '2026-02-01T08:30:00.000Z';
const SNAPSHOT_AT = '2026-02-01T08:30:01.000Z';
const WORLD_PROVIDER = 'test.world-provider';
const FOREGROUND_PROVIDER = 'test.foreground-provider';
const INPUT_ACTIVITY_PROVIDER = 'test.input-activity-provider';
const OBSERVER = 'test.desktop-session-awareness-observer';

// No injection seam: the tests supply a fake *world provider* as an ordinary plugin and let the real
// Runtime dependency graph decide who is active. The Awareness plugin under test is the production
// one, and each fake snapshot is built by hand so that a given pair of snapshots is exact.
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

function worldProvider(behaviour) {
  return provider(WORLD_PROVIDER, desktopSessionWorldService, behaviour);
}

function foregroundObservation(target, observedAt = OBSERVED_AT) {
  return Object.freeze({ observedAt, source: 'foreground.windows', foreground: target });
}

function inputActivityObservation(lastInputTick, observedAt = OBSERVED_AT) {
  return Object.freeze({ observedAt, source: 'input-activity.windows', lastInputTick });
}

function available(observation) {
  return Object.freeze({ kind: 'available', observation });
}

function unavailable() {
  return Object.freeze({ kind: 'unavailable' });
}

function worldSnapshot({ foreground, inputActivity, snapshotAt = SNAPSHOT_AT }) {
  return Object.freeze({ snapshotAt, foreground, inputActivity });
}

// Builds a target from the two reported fields, always as a fresh object, so that a comparison of
// two equal targets is proven to be a comparison of values rather than of one shared reference.
// `title` is only set when the caller named it, which is what puts the third state — the property
// absent altogether — within reach of a test.
function presentTarget(fields = {}) {
  const target = { kind: 'present', processName: fields.processName ?? 'notepad' };
  if ('title' in fields) target.title = fields.title;
  return Object.freeze(target);
}

function observerDefinition(observed) {
  return {
    id: OBSERVER,
    version: '1.0.0',
    requires: [desktopSessionAwarenessService],
    setup(context) {
      observed.service = context.services.get(desktopSessionAwarenessService);
    },
  };
}

async function runningAwareness(t, world) {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());
  const observed = {};
  await runtime.loadPlugin(world.definition);
  await runtime.loadPlugin(desktopSessionAwarenessPlugin);
  await runtime.loadPlugin(observerDefinition(observed));
  return { runtime, observed };
}

// Yields one whole event-loop turn, which drains every pending microtask. A macrotask boundary is
// deterministic — unlike a sleep, it proves the pending work is finished rather than that it
// probably had enough time.
function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

// Replays a fixed sequence of snapshots, one per world call, so a test can state a whole series of
// assessments as a list of expected verdicts. A call past the end of the sequence is a mistake in
// the test, not a case to paper over, so it fails loudly rather than repeating the last entry.
function sequenceWorld(snapshots) {
  return worldProvider((call) => {
    assert.ok(call <= snapshots.length, `the world was called ${call} times, past the sequence`);
    return Promise.resolve(snapshots[call - 1]);
  });
}

// A world that reports the same snapshot on every call, for tests whose subject is something other
// than what differs between two readings.
function steadyWorld(snapshot) {
  return worldProvider(() => Promise.resolve(snapshot));
}

// States a whole series of assessments as a list, so a test can assert the sequence at once rather
// than one call at a time.
async function verdicts(observed, count, facet = 'foreground') {
  const collected = [];
  for (let call = 0; call < count; call += 1) {
    const assessment = await observed.service.current();
    collected.push(assessment.kind === 'baseline' ? 'baseline' : assessment[facet]);
  }
  return collected;
}

test('the awareness plugin requires exactly the world capability and provides its own', async (t) => {
  assert.deepEqual(desktopSessionAwarenessPlugin.requires, [desktopSessionWorldService]);
  assert.deepEqual(desktopSessionAwarenessPlugin.provides, [desktopSessionAwarenessService]);
  assert.equal(desktopSessionAwarenessPlugin.id, 'desktop-session-awareness');
  assert.equal(desktopSessionAwarenessPlugin.version, '1.0.0');
  assert.equal(desktopSessionAwarenessService.id, 'desktop-session-awareness.current');
  assert.equal(desktopSessionAwarenessService.version, 1);

  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  assert.equal(await runtime.loadPlugin(desktopSessionAwarenessPlugin), 'waiting');
});

test('the awareness service is reachable through the plugin dependency graph', async (t) => {
  const world = sequenceWorld([worldSnapshot({ foreground: available(foregroundObservation(presentTarget())), inputActivity: available(inputActivityObservation(1)) })]);
  const { runtime, observed } = await runningAwareness(t, world);

  assert.equal(runtime.getPluginState('desktop-session-awareness'), 'active');
  assert.equal(runtime.getPluginState(OBSERVER), 'active');
  assert.deepEqual(Object.keys(observed.service), ['current']);
});

test('awareness waits when the world disappears and activates again when it returns', async (t) => {
  const world = sequenceWorld([worldSnapshot({ foreground: available(foregroundObservation(presentTarget())), inputActivity: available(inputActivityObservation(1)) })]);
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());
  const observed = {};
  await runtime.loadPlugin(world.definition);
  await runtime.loadPlugin(desktopSessionAwarenessPlugin);
  await runtime.loadPlugin(observerDefinition(observed));

  assert.equal(runtime.getPluginState('desktop-session-awareness'), 'active');

  await runtime.unloadPlugin(WORLD_PROVIDER);
  assert.equal(runtime.getPluginState('desktop-session-awareness'), 'waiting');
  assert.equal(runtime.getPluginState(OBSERVER), 'waiting');

  await runtime.loadPlugin(world.definition);
  assert.equal(runtime.getPluginState('desktop-session-awareness'), 'active');
  assert.equal(runtime.getPluginState(OBSERVER), 'active');
});

test('the first assessment is a baseline carrying the world snapshot by reference', async (t) => {
  const first = worldSnapshot({ foreground: available(foregroundObservation(presentTarget())), inputActivity: available(inputActivityObservation(1)) });
  const { observed } = await runningAwareness(t, sequenceWorld([first]));

  const assessment = await observed.service.current();

  assert.equal(assessment.kind, 'baseline');
  assert.equal(assessment.current, first);
  assert.equal('previous' in assessment, false);
  assert.deepEqual(Object.keys(assessment), ['kind', 'current']);
});

test('awareness calls the world exactly once per assessment and never on its own', async (t) => {
  const world = steadyWorld(
    worldSnapshot({
      foreground: available(foregroundObservation(presentTarget())),
      inputActivity: available(inputActivityObservation(1)),
    }),
  );
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());
  const observed = {};
  await runtime.loadPlugin(world.definition);
  await runtime.loadPlugin(desktopSessionAwarenessPlugin);
  await runtime.loadPlugin(observerDefinition(observed));

  assert.equal(world.counts.calls, 0, 'setup must not acquire anything');
  await nextTurn();
  assert.equal(world.counts.calls, 0, 'an active but unasked awareness must not acquire anything');

  await observed.service.current();
  assert.equal(world.counts.calls, 1);
  await observed.service.current();
  assert.equal(world.counts.calls, 2);
  await observed.service.current();
  assert.equal(world.counts.calls, 3);

  await runtime.shutdown();
  assert.equal(world.counts.calls, 3, 'shutdown must not acquire anything');
  assert.equal(runtime.getPluginState('desktop-session-awareness'), undefined);
});

test('identical payloads under different timestamps are stable', async (t) => {
  const build = (observedAt, snapshotAt) =>
    worldSnapshot({
      snapshotAt,
      foreground: available(foregroundObservation(presentTarget({ title: 'Untitled - Notepad' }), observedAt)),
      inputActivity: available(inputActivityObservation(5000, observedAt)),
    });
  const world = sequenceWorld([
    build('2026-02-01T10:00:00.000Z', '2026-02-01T10:00:01.000Z'),
    build('2026-02-01T10:05:00.000Z', '2026-02-01T10:05:01.000Z'),
  ]);
  const { observed } = await runningAwareness(t, world);

  await observed.service.current();
  const assessment = await observed.service.current();

  assert.equal(assessment.kind, 'comparison');
  assert.equal(assessment.foreground, 'unchanged');
  assert.equal(assessment.inputActivity, 'unchanged');
  assert.equal(assessment.change, 'stable');
  // The two snapshots really do differ in every timestamp, so the verdict above is not an artefact
  // of the pair being byte-identical.
  assert.notEqual(assessment.previous.snapshotAt, assessment.current.snapshotAt);
  assert.notEqual(
    assessment.previous.foreground.observation.observedAt,
    assessment.current.foreground.observation.observedAt,
  );
});

test('a foreground that appears or disappears is a change', async (t) => {
  const world = sequenceWorld([
    worldSnapshot({ foreground: available(foregroundObservation({ kind: 'absent' })), inputActivity: available(inputActivityObservation(1)) }),
    worldSnapshot({ foreground: available(foregroundObservation(presentTarget())), inputActivity: available(inputActivityObservation(1)) }),
    worldSnapshot({ foreground: available(foregroundObservation({ kind: 'absent' })), inputActivity: available(inputActivityObservation(1)) }),
    worldSnapshot({ foreground: available(foregroundObservation({ kind: 'absent' })), inputActivity: available(inputActivityObservation(1)) }),
  ]);
  const { observed } = await runningAwareness(t, world);

  const collected = [];
  for (let call = 0; call < 4; call += 1) {
    const assessment = await observed.service.current();
    collected.push(
      assessment.kind === 'baseline' ? 'baseline' : `${assessment.foreground}/${assessment.change}`,
    );
  }

  assert.deepEqual(collected, ['baseline', 'changed/changed', 'changed/changed', 'unchanged/stable']);
});

test('a changed title or process name is a change, and an equal pair is not', async (t) => {
  const world = sequenceWorld([
    worldSnapshot({ foreground: available(foregroundObservation(presentTarget({ title: 'Untitled - Notepad' }))), inputActivity: available(inputActivityObservation(1)) }),
    worldSnapshot({ foreground: available(foregroundObservation(presentTarget({ title: 'report.md - Visual Studio Code', processName: 'Code' }))), inputActivity: available(inputActivityObservation(1)) }),
    worldSnapshot({ foreground: available(foregroundObservation(presentTarget({ title: 'report.md - Visual Studio Code', processName: 'Code' }))), inputActivity: available(inputActivityObservation(1)) }),
    worldSnapshot({ foreground: available(foregroundObservation(presentTarget({ title: 'notes.md - Visual Studio Code', processName: 'Code' }))), inputActivity: available(inputActivityObservation(1)) }),
    worldSnapshot({ foreground: available(foregroundObservation(presentTarget({ title: 'notes.md - Visual Studio Code', processName: 'notepad' }))), inputActivity: available(inputActivityObservation(1)) }),
  ]);
  const { observed } = await runningAwareness(t, world);

  assert.deepEqual(await verdicts(observed, 5), [
    'baseline',
    'changed',
    'unchanged',
    'changed',
    'changed',
  ]);
});

test('overlapping assessments resolve in order, each against the reading before it', async (t) => {
  // The baseline is captured after the world call returns and overwritten immediately, so two
  // assessments in flight at once cannot both read the same baseline: whichever resolves first
  // becomes the other's previous reading.
  const snapshots = [
    worldSnapshot({ foreground: available(foregroundObservation({ kind: 'absent' })), inputActivity: available(inputActivityObservation(5000)) }),
    worldSnapshot({ foreground: available(foregroundObservation(presentTarget())), inputActivity: available(inputActivityObservation(5000)) }),
    worldSnapshot({ foreground: available(foregroundObservation(presentTarget({ title: 'Untitled - Notepad' }))), inputActivity: available(inputActivityObservation(5001)) }),
  ];
  const { observed } = await runningAwareness(t, sequenceWorld(snapshots));

  const [first, second, third] = await Promise.all([
    observed.service.current(),
    observed.service.current(),
    observed.service.current(),
  ]);

  assert.deepEqual([first.kind, second.kind, third.kind], ['baseline', 'comparison', 'comparison']);
  assert.equal(second.previous, snapshots[0]);
  assert.equal(second.current, snapshots[1]);
  assert.equal(second.change, 'changed');
  assert.equal(third.previous, snapshots[1]);
  assert.equal(third.current, snapshots[2]);
  assert.equal(third.change, 'changed');
});

test('the three title states stay distinct across a comparison', async (t) => {
  // `title` has three observable states in production: the property is absent, the property is
  // present as null, or it holds a string. Absent and null are not the same report — one says the
  // source had no title to give, the other says it read one and it was empty — so a comparison must
  // not fold them together. `undefined !== null` keeps them apart under `===`.
  const world = sequenceWorld([
    worldSnapshot({ foreground: available(foregroundObservation({ kind: 'present', processName: 'notepad' })), inputActivity: available(inputActivityObservation(1)) }),
    worldSnapshot({ foreground: available(foregroundObservation({ kind: 'present', title: null, processName: 'notepad' })), inputActivity: available(inputActivityObservation(1)) }),
    worldSnapshot({ foreground: available(foregroundObservation({ kind: 'present', title: null, processName: 'notepad' })), inputActivity: available(inputActivityObservation(1)) }),
    worldSnapshot({ foreground: available(foregroundObservation({ kind: 'present', processName: 'notepad' })), inputActivity: available(inputActivityObservation(1)) }),
    worldSnapshot({ foreground: available(foregroundObservation({ kind: 'present', processName: 'notepad' })), inputActivity: available(inputActivityObservation(1)) }),
  ]);
  const { observed } = await runningAwareness(t, world);

  assert.deepEqual(await verdicts(observed, 5), [
    'baseline',
    'changed',
    'unchanged',
    'changed',
    'unchanged',
  ]);
});

test('the input tick is compared for inequality only, never as a progression', async (t) => {
  // The tick is the platform's counter. A decrease is a difference like any other and this layer
  // must not read it as a rewind to correct, nor a delta as a duration.
  const world = sequenceWorld([5000, 5000, 4000, 5000, 5001].map((tick) =>
    worldSnapshot({ foreground: available(foregroundObservation({ kind: 'absent' })), inputActivity: available(inputActivityObservation(tick)) }),
  ));
  const { observed } = await runningAwareness(t, world);

  assert.deepEqual(await verdicts(observed, 5, 'inputActivity'), [
    'baseline',
    'unchanged',
    'changed',
    'changed',
    'changed',
  ]);
});

test('an unavailable facet on either side makes that facet indeterminate', async (t) => {
  const target = () => available(foregroundObservation({ kind: 'absent' }));
  const tick = () => available(inputActivityObservation(5000));
  const world = sequenceWorld([
    worldSnapshot({ foreground: unavailable(), inputActivity: unavailable() }),
    worldSnapshot({ foreground: target(), inputActivity: tick() }),
    worldSnapshot({ foreground: target(), inputActivity: tick() }),
    worldSnapshot({ foreground: unavailable(), inputActivity: tick() }),
    worldSnapshot({ foreground: target(), inputActivity: tick() }),
  ]);
  const { observed } = await runningAwareness(t, world);

  const first = await observed.service.current();
  assert.equal(first.kind, 'baseline');

  // unavailable -> available, on both facets at once.
  const second = await observed.service.current();
  assert.equal(second.foreground, 'indeterminate');
  assert.equal(second.inputActivity, 'indeterminate');
  assert.equal(second.change, 'indeterminate');

  const third = await observed.service.current();
  assert.equal(third.foreground, 'unchanged');
  assert.equal(third.inputActivity, 'unchanged');
  assert.equal(third.change, 'stable');

  // available -> unavailable, on the foreground only.
  const fourth = await observed.service.current();
  assert.equal(fourth.foreground, 'indeterminate');
  assert.equal(fourth.inputActivity, 'unchanged');
  assert.equal(fourth.change, 'indeterminate');

  // unavailable -> available again, on the foreground only.
  const fifth = await observed.service.current();
  assert.equal(fifth.foreground, 'indeterminate');
  assert.equal(fifth.inputActivity, 'unchanged');
  assert.equal(fifth.change, 'indeterminate');
});

test('a difference in one facet is a change even when the other is indeterminate', async (t) => {
  const world = sequenceWorld([
    worldSnapshot({ foreground: available(foregroundObservation({ kind: 'absent' })), inputActivity: unavailable() }),
    worldSnapshot({ foreground: available(foregroundObservation(presentTarget())), inputActivity: available(inputActivityObservation(5000)) }),
  ]);
  const { observed } = await runningAwareness(t, world);

  await observed.service.current();
  const assessment = await observed.service.current();

  assert.equal(assessment.foreground, 'changed');
  assert.equal(assessment.inputActivity, 'indeterminate');
  assert.equal(assessment.change, 'changed');
});

test('sameness in one facet is not enough when the other is indeterminate', async (t) => {
  const target = () => available(foregroundObservation({ kind: 'absent' }));
  const world = sequenceWorld([
    worldSnapshot({ foreground: target(), inputActivity: available(inputActivityObservation(5000)) }),
    worldSnapshot({ foreground: target(), inputActivity: unavailable() }),
    worldSnapshot({ foreground: unavailable(), inputActivity: unavailable() }),
  ]);
  const { observed } = await runningAwareness(t, world);

  await observed.service.current();

  const second = await observed.service.current();
  assert.equal(second.foreground, 'unchanged');
  assert.equal(second.inputActivity, 'indeterminate');
  assert.equal(second.change, 'indeterminate');

  const third = await observed.service.current();
  assert.equal(third.foreground, 'indeterminate');
  assert.equal(third.inputActivity, 'indeterminate');
  assert.equal(third.change, 'indeterminate');
});

test('a comparison carries the two world snapshots by reference', async (t) => {
  const first = worldSnapshot({ foreground: available(foregroundObservation({ kind: 'absent' })), inputActivity: available(inputActivityObservation(5000)) });
  const second = worldSnapshot({ foreground: available(foregroundObservation(presentTarget())), inputActivity: available(inputActivityObservation(5000)) });
  const { observed } = await runningAwareness(t, sequenceWorld([first, second]));

  const baseline = await observed.service.current();
  assert.equal(baseline.current, first);

  const assessment = await observed.service.current();
  assert.equal(assessment.kind, 'comparison');
  assert.equal(assessment.previous, first);
  assert.equal(assessment.current, second);
  assert.deepEqual(Object.keys(assessment), [
    'kind',
    'previous',
    'current',
    'foreground',
    'inputActivity',
    'change',
  ]);
});

test('a partially filled snapshot still becomes the baseline', async (t) => {
  const partial = worldSnapshot({ foreground: unavailable(), inputActivity: unavailable() });
  const world = sequenceWorld([
    worldSnapshot({ foreground: available(foregroundObservation({ kind: 'absent' })), inputActivity: available(inputActivityObservation(5000)) }),
    partial,
    partial,
  ]);
  const { observed } = await runningAwareness(t, world);

  await observed.service.current();

  const second = await observed.service.current();
  assert.equal(second.kind, 'comparison');
  assert.equal(second.change, 'indeterminate');

  // The third snapshot is identical to the second, yet it is still compared against it rather than
  // being handed out as a baseline: a snapshot of unknown content is still the previous reading.
  const third = await observed.service.current();
  assert.equal(third.kind, 'comparison');
  assert.equal(third.previous, partial);
  assert.equal(third.foreground, 'indeterminate');
  assert.equal(third.inputActivity, 'indeterminate');
  assert.equal(third.change, 'indeterminate');
});

test('a reactivated awareness starts from a baseline again', async (t) => {
  const world = steadyWorld(
    worldSnapshot({
      foreground: available(foregroundObservation({ kind: 'absent' })),
      inputActivity: available(inputActivityObservation(5000)),
    }),
  );
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());
  const observed = {};
  await runtime.loadPlugin(world.definition);
  await runtime.loadPlugin(desktopSessionAwarenessPlugin);
  await runtime.loadPlugin(observerDefinition(observed));

  await observed.service.current();
  assert.equal((await observed.service.current()).kind, 'comparison');
  const beforeDeactivation = observed.service;

  await runtime.unloadPlugin(WORLD_PROVIDER);
  assert.equal(runtime.getPluginState('desktop-session-awareness'), 'waiting');
  await runtime.loadPlugin(world.definition);

  // The observer is re-run on reactivation and picks up the new service instance. Without this the
  // assertions below would be reading a stale object and would not discriminate.
  assert.notEqual(observed.service, beforeDeactivation, 'the service was not rebuilt');

  const assessment = await observed.service.current();
  assert.equal(assessment.kind, 'baseline');
});

test('a world rejection propagates out of the assessment unchanged', async (t) => {
  const failure = new Error('the world could not be observed');
  const { observed } = await runningAwareness(t, worldProvider(() => Promise.reject(failure)));

  await assert.rejects(
    () => observed.service.current(),
    (error) => error === failure,
  );
});

test('a rejected world call leaves the baseline untouched', async (t) => {
  const first = worldSnapshot({ foreground: available(foregroundObservation({ kind: 'absent' })), inputActivity: available(inputActivityObservation(5000)) });
  const second = worldSnapshot({ foreground: available(foregroundObservation(presentTarget())), inputActivity: available(inputActivityObservation(5000)) });
  const failure = new Error('the world could not be observed');
  // Built lazily per call: an array literal would evaluate the rejection on every call, including
  // the ones that must succeed, and strand an unhandled rejection outside the test's await.
  const { observed } = await runningAwareness(
    t,
    worldProvider((call) => {
      if (call === 2) return Promise.reject(failure);
      return Promise.resolve(call === 1 ? first : second);
    }),
  );

  const baseline = await observed.service.current();
  assert.equal(baseline.kind, 'baseline');
  assert.equal(baseline.current, first);

  await assert.rejects(() => observed.service.current(), (error) => error === failure);

  const assessment = await observed.service.current();
  assert.equal(assessment.kind, 'comparison');
  assert.equal(assessment.previous, first, 'the failed call must not have moved the baseline');
  assert.equal(assessment.current, second);
  assert.equal(assessment.foreground, 'changed');
});

test('the awareness module depends only on the public world contract', () => {
  const dir = new URL('../src/desktop-session-awareness/', import.meta.url);
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.ts'))
    .sort();
  assert.deepEqual(files, ['contracts.ts', 'index.ts', 'plugin.ts', 'types.ts']);

  // The two perception entry points are deliberately absent: this layer composes the World snapshot
  // and must not reach past it into the sources the World already composed.
  const publicEntryPoints = new Set([
    '../desktop-session-world/index.js',
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
});

test('the awareness module carries no platform, storage, scheduling, or policy knowledge', () => {
  const dir = new URL('../src/desktop-session-awareness/', import.meta.url);
  const combined = readdirSync(dir)
    .filter((name) => name.endsWith('.ts'))
    .sort()
    .map((name) => readFileSync(new URL(name, dir), 'utf8'))
    .join('\n');

  // Every token here is either a platform string or a word-formed identifier, because those are the
  // only things that cannot turn up in prose. A bare English root would be a false positive twice
  // over: `present` is itself a legitimate Foreground domain value, and a comment that explains
  // what this layer refuses to do has to be free to name the thing it refuses. `isIdle` and its
  // siblings are the policy vocabulary this layer must never grow, and camel case keeps them out of
  // a sentence.
  for (const token of [
    'process.platform',
    'powershell',
    'PowerShell',
    'execFile',
    'win32',
    'chronicle',
    'Chronicle',
    'continuity',
    'Continuity',
    'writeFile',
    'setInterval',
    'setTimeout',
    'isIdle',
    'isAway',
    'userPresent',
    'userAway',
    'idleFor',
  ]) {
    assert.equal(combined.includes(token), false, `the awareness module must not contain "${token}"`);
  }
});

test('the production world and awareness plugins compose under the real runtime', async (t) => {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  const foreground = provider(FOREGROUND_PROVIDER, foregroundService, (call) =>
    Promise.resolve(
      foregroundObservation(
        call === 1 ? presentTarget({ title: 'Untitled - Notepad' }) : presentTarget({ title: 'report.md - Visual Studio Code', processName: 'Code' }),
      ),
    ),
  );
  const inputActivity = provider(INPUT_ACTIVITY_PROVIDER, inputActivityService, (call) =>
    Promise.resolve(inputActivityObservation(call === 1 ? 5000 : 5001)),
  );

  await runtime.loadPlugin(foreground.definition);
  await runtime.loadPlugin(inputActivity.definition);
  await runtime.loadPlugin(desktopSessionWorldPlugin);
  await runtime.loadPlugin(desktopSessionAwarenessPlugin);
  const observed = {};
  await runtime.loadPlugin(observerDefinition(observed));

  assert.equal(runtime.getPluginState('desktop-session-world'), 'active');
  assert.equal(runtime.getPluginState('desktop-session-awareness'), 'active');

  const baseline = await observed.service.current();
  assert.equal(baseline.kind, 'baseline');
  assert.equal(baseline.current.foreground.kind, 'available');
  assert.equal(baseline.current.inputActivity.kind, 'available');

  const assessment = await observed.service.current();
  assert.equal(assessment.kind, 'comparison');
  assert.equal(assessment.foreground, 'changed');
  assert.equal(assessment.inputActivity, 'changed');
  assert.equal(assessment.change, 'changed');
  assert.equal(assessment.current.foreground.observation.foreground.title, 'report.md - Visual Studio Code');
});
