// P3-05 — Phase 3 vertical slice acceptance.
//
// Two distinct chains are exercised in this file, and they must not be read as one another:
//
//   deterministic (the first six tests)
//     test-only perception providers -> production World -> production Awareness -> real Runtime
//
//   real production smoke (the last test)
//     production foregroundPlugin -> production inputActivityPlugin
//     -> production World -> production Awareness -> real Runtime
//
// The deterministic chain replaces both perception plugins and nothing else: the World and the
// Awareness in it are the production implementations. The last test is the only place where all
// four plugins are the production ones, and it runs on a real win32 host only.
//
// P3-04 already proved that the production World and the production Awareness compose under the
// real runtime. What is at stake here is the set of properties that acceptance did not reach: that
// the transient state this slice keeps — the awareness baseline — belongs to one runtime lifetime
// and never to the next, that payloads survive both production layers by reference, that a host
// without the platform capability converges honestly, and that the whole slice reads nothing until
// it is asked.

import assert from 'node:assert/strict';
import test from 'node:test';

import { Runtime } from '../dist/index.js';
import { chronicleService } from '../dist/chronicle/index.js';
import { continuityService } from '../dist/continuity/index.js';
import { ForegroundError, ForegroundObservationError, foregroundService } from '../dist/foreground/index.js';
import { InputActivityError, inputActivityService } from '../dist/input-activity/index.js';
import {
  desktopSessionWorldPlugin,
  desktopSessionWorldService,
} from '../dist/desktop-session-world/index.js';
import {
  desktopSessionAwarenessPlugin,
  desktopSessionAwarenessService,
} from '../dist/desktop-session-awareness/index.js';
import { foregroundPlugin } from '../dist/foreground/index.js';
import { inputActivityPlugin } from '../dist/input-activity/index.js';

const onWindows = process.platform === 'win32';

const OBSERVED_AT = '2026-02-01T08:30:00.000Z';
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const FOREGROUND_PROVIDER = 'test.vertical-slice-foreground';
const INPUT_ACTIVITY_PROVIDER = 'test.vertical-slice-input-activity';
const AWARENESS_OBSERVER = 'test.vertical-slice-awareness-observer';
const WORLD_OBSERVER = 'test.vertical-slice-world-observer';
const DURABLE_OBSERVER = 'test.vertical-slice-durable-observer';
const UNRELATED_OBSERVER = 'test.vertical-slice-unrelated-observer';

const SLICE_PLUGIN_IDS = [
  'desktop-session-world',
  'desktop-session-awareness',
];

// No injection seam: a test-only *provider* is an ordinary plugin, and the real Runtime dependency
// graph decides who becomes active. The World and the Awareness downstream of it are the production
// implementations.
function perception(pluginId, contract, behaviour) {
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

function serviceObserver(pluginId, contract, observed) {
  return {
    id: pluginId,
    version: '1.0.0',
    requires: [contract],
    setup(context) {
      observed.service = context.services.get(contract);
    },
  };
}

function foregroundObservation(target, observedAt = OBSERVED_AT) {
  return Object.freeze({ observedAt, source: 'foreground.windows', foreground: target });
}

function inputActivityObservation(lastInputTick, observedAt = OBSERVED_AT) {
  return Object.freeze({ observedAt, source: 'input-activity.windows', lastInputTick });
}

function presentTarget(fields = {}) {
  const target = { kind: 'present', processName: fields.processName ?? 'notepad' };
  if ('title' in fields) target.title = fields.title;
  return Object.freeze(target);
}

// Starts the deterministic slice. The two perceptions are supplied; everything downstream is the
// production implementation, reached through the same dependency graph the real deployment uses.
async function startSlice(t, foreground, inputActivity) {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());
  const awareness = {};
  const world = {};

  await runtime.loadPlugin(foreground.definition);
  await runtime.loadPlugin(inputActivity.definition);
  await runtime.loadPlugin(desktopSessionWorldPlugin);
  await runtime.loadPlugin(desktopSessionAwarenessPlugin);
  await runtime.loadPlugin(
    serviceObserver(AWARENESS_OBSERVER, desktopSessionAwarenessService, awareness),
  );
  await runtime.loadPlugin(serviceObserver(WORLD_OBSERVER, desktopSessionWorldService, world));

  return { runtime, awareness, world };
}

// Yields one whole event-loop turn, which drains every pending microtask. A macrotask boundary is
// deterministic — unlike a sleep, it proves the pending work is finished rather than that it
// probably had enough time.
function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('the production world and awareness carry an observation end to end without rebuilding it', async (t) => {
  const firstForeground = foregroundObservation(presentTarget({ title: 'Untitled - Notepad' }));
  const secondForeground = foregroundObservation(
    presentTarget({ title: 'report.md - Visual Studio Code', processName: 'Code' }),
  );
  const steadyInput = inputActivityObservation(7000);

  const foreground = perception(FOREGROUND_PROVIDER, foregroundService, (call) =>
    Promise.resolve(call === 1 ? firstForeground : secondForeground),
  );
  const inputActivity = perception(INPUT_ACTIVITY_PROVIDER, inputActivityService, () =>
    Promise.resolve(steadyInput),
  );

  const slice = await startSlice(t, foreground, inputActivity);

  const baseline = await slice.awareness.service.current();
  assert.equal(baseline.kind, 'baseline');

  const comparison = await slice.awareness.service.current();
  assert.equal(comparison.kind, 'comparison');

  // The comparison carries the very snapshot object the baseline carried, and a snapshot the World
  // assembled for the second reading — not the provider's object, and not a copy of the first.
  assert.equal(comparison.previous, baseline.current);
  assert.notEqual(comparison.current, baseline.current);
  assert.match(comparison.current.snapshotAt, UTC_TIMESTAMP);
  assert.notEqual(comparison.current.snapshotAt, OBSERVED_AT);

  // Every observation object the providers handed out is still the same object on the far side of
  // both production layers. A layer that cloned, rebuilt or re-wrapped a payload fails here.
  assert.equal(comparison.previous.foreground.observation, firstForeground);
  assert.equal(comparison.current.foreground.observation, secondForeground);
  assert.equal(comparison.previous.inputActivity.observation, steadyInput);
  assert.equal(comparison.current.inputActivity.observation, steadyInput);

  // Only the foreground moved. The side that did not move has to be reported as unchanged, or the
  // verdict would collapse into "something was read twice".
  assert.equal(comparison.foreground, 'changed');
  assert.equal(comparison.inputActivity, 'unchanged');
  assert.equal(comparison.change, 'changed');
});

test('a facet the production world could not fill reaches awareness as indeterminate', async (t) => {
  const failedForeground = perception(FOREGROUND_PROVIDER, foregroundService, () =>
    Promise.reject(new ForegroundObservationError('the foreground could not be observed')),
  );
  const steadyInput = inputActivityObservation(7000);
  const inputActivity = perception(INPUT_ACTIVITY_PROVIDER, inputActivityService, () =>
    Promise.resolve(steadyInput),
  );

  const slice = await startSlice(t, failedForeground, inputActivity);

  const baseline = await slice.awareness.service.current();
  assert.equal(baseline.kind, 'baseline');

  // The production World turns a source that failed into an unavailable facet, and keeps the other
  // source's reading intact ...
  assert.deepEqual(baseline.current.foreground, { kind: 'unavailable' });
  assert.equal(baseline.current.inputActivity.kind, 'available');
  assert.equal(baseline.current.inputActivity.observation, steadyInput);

  // ... and that is exactly the shape the production Awareness reads as incomparable. This is the
  // seam between the two modules, and it is asserted here rather than inside either module's own
  // suite, where the other side of the seam is built by hand.
  const comparison = await slice.awareness.service.current();
  assert.equal(comparison.foreground, 'indeterminate');
  assert.equal(comparison.inputActivity, 'unchanged');
  assert.equal(comparison.change, 'indeterminate');
});

test('the whole slice acquires nothing until it is asked, and its first answer is a baseline', async (t) => {
  const foreground = perception(FOREGROUND_PROVIDER, foregroundService, () =>
    Promise.resolve(foregroundObservation(presentTarget())),
  );
  const inputActivity = perception(INPUT_ACTIVITY_PROVIDER, inputActivityService, () =>
    Promise.resolve(inputActivityObservation(7000)),
  );

  const slice = await startSlice(t, foreground, inputActivity);

  assert.equal(slice.runtime.getPluginState('desktop-session-world'), 'active');
  assert.equal(slice.runtime.getPluginState('desktop-session-awareness'), 'active');

  // Activating the slice reads nothing about the desktop, and neither does an idle runtime.
  await nextTurn();
  await nextTurn();
  assert.equal(foreground.counts.calls, 0);
  assert.equal(inputActivity.counts.calls, 0);

  // One ask is one reading from each source, and it opens the sequence rather than continuing one.
  // An awareness that sampled the world while activating would have made this a comparison, and the
  // call counts would have been non-zero before it was asked.
  const baseline = await slice.awareness.service.current();
  assert.equal(baseline.kind, 'baseline');
  assert.equal(foreground.counts.calls, 1);
  assert.equal(inputActivity.counts.calls, 1);

  // Retiring the slice reads nothing either.
  await slice.runtime.shutdown();
  assert.equal(foreground.counts.calls, 1);
  assert.equal(inputActivity.counts.calls, 1);
  assert.equal(slice.runtime.getPluginState('desktop-session-awareness'), undefined);
});

test('two simultaneously live runtimes never share an awareness baseline', async (t) => {
  const foregroundA = perception(FOREGROUND_PROVIDER, foregroundService, (call) =>
    Promise.resolve(
      foregroundObservation(
        call === 1
          ? presentTarget({ title: 'first - Runtime A' })
          : presentTarget({ title: 'second - Runtime A' }),
      ),
    ),
  );
  const inputActivityA = perception(INPUT_ACTIVITY_PROVIDER, inputActivityService, () =>
    Promise.resolve(inputActivityObservation(7000)),
  );
  const sliceA = await startSlice(t, foregroundA, inputActivityA);

  // Runtime A reaches a comparison that reports a change, so it is holding a baseline that differs
  // from its latest reading. Anything shared would be visible from here on.
  const baselineA = await sliceA.awareness.service.current();
  assert.equal(baselineA.kind, 'baseline');
  const comparisonA = await sliceA.awareness.service.current();
  assert.equal(comparisonA.kind, 'comparison');
  assert.equal(comparisonA.change, 'changed');

  // Runtime B is built from scratch while A is still alive and still mid-sequence.
  const foregroundB = perception(FOREGROUND_PROVIDER, foregroundService, () =>
    Promise.resolve(presentTarget({ title: 'only - Runtime B' })),
  );
  const inputActivityB = perception(INPUT_ACTIVITY_PROVIDER, inputActivityService, () =>
    Promise.resolve(inputActivityObservation(999_999)),
  );
  const sliceB = await startSlice(t, foregroundB, inputActivityB);

  assert.notEqual(sliceA.runtime, sliceB.runtime);
  assert.notEqual(sliceA.world.service, sliceB.world.service);
  assert.notEqual(sliceA.awareness.service, sliceB.awareness.service);

  // Two live runtimes in one process: B's first reading is a baseline, not a comparison against
  // whatever A was in the middle of. A module-level binding behind either service would be caught
  // here, because both instances are alive at the same moment.
  const baselineB = await sliceB.awareness.service.current();
  assert.equal(baselineB.kind, 'baseline');

  // And A's own sequence is undisturbed by B's arrival.
  const comparisonA2 = await sliceA.awareness.service.current();
  assert.equal(comparisonA2.kind, 'comparison');
  assert.equal(comparisonA2.previous, comparisonA.current);
});

test('a runtime that starts after the previous one is gone opens on a baseline again', async (t) => {
  const firstForeground = perception(FOREGROUND_PROVIDER, foregroundService, (call) =>
    Promise.resolve(
      foregroundObservation(
        call === 1 ? presentTarget({ title: 'before' }) : presentTarget({ title: 'after' }),
      ),
    ),
  );
  const firstInput = perception(INPUT_ACTIVITY_PROVIDER, inputActivityService, () =>
    Promise.resolve(inputActivityObservation(7000)),
  );
  const first = await startSlice(t, firstForeground, firstInput);

  const openedOn = await first.awareness.service.current();
  assert.equal(openedOn.kind, 'baseline');
  const moved = await first.awareness.service.current();
  assert.equal(moved.change, 'changed');

  await first.runtime.shutdown();
  for (const id of SLICE_PLUGIN_IDS) {
    assert.equal(first.runtime.getPluginState(id), undefined);
  }

  // The first runtime is gone, and nothing in this chain could have carried its reading forward:
  // the slice provides neither durable capability, so no consumer inside it can even ask for one.
  const durable = {};
  await first.runtime.loadPlugin({
    id: DURABLE_OBSERVER,
    version: '1.0.0',
    requires: [continuityService, chronicleService],
    setup(context) {
      durable.continuity = context.services.get(continuityService);
      durable.chronicle = context.services.get(chronicleService);
    },
  });
  assert.equal(first.runtime.getPluginState(DURABLE_OBSERVER), 'waiting');
  assert.equal(durable.continuity, undefined);
  assert.equal(durable.chronicle, undefined);

  // A second runtime over entirely different readings still opens on a baseline. Had the previous
  // reading survived anywhere — on disk, in a module, in a shared service — this first call would
  // have been a comparison, and a changed one at that.
  const secondForeground = perception(FOREGROUND_PROVIDER, foregroundService, () =>
    Promise.resolve(presentTarget({ title: 'unrelated to the first runtime', processName: 'Code' })),
  );
  const secondInput = perception(INPUT_ACTIVITY_PROVIDER, inputActivityService, () =>
    Promise.resolve(inputActivityObservation(1)),
  );
  const second = await startSlice(t, secondForeground, secondInput);

  const reopened = await second.awareness.service.current();
  assert.equal(reopened.kind, 'baseline');
});

test('shutdown retires the slice so no consumer can reach it any more', async (t) => {
  const foreground = perception(FOREGROUND_PROVIDER, foregroundService, () =>
    Promise.resolve(foregroundObservation(presentTarget())),
  );
  const inputActivity = perception(INPUT_ACTIVITY_PROVIDER, inputActivityService, () =>
    Promise.resolve(inputActivityObservation(7000)),
  );
  const slice = await startSlice(t, foreground, inputActivity);

  const opened = await slice.awareness.service.current();
  assert.equal(opened.kind, 'baseline');

  // Held on purpose, so the assertion below can say what is and is not true of it.
  const detached = slice.awareness.service;

  await slice.runtime.shutdown();
  for (const id of SLICE_PLUGIN_IDS) {
    assert.equal(slice.runtime.getPluginState(id), undefined);
  }

  // A consumer that arrives after the shutdown waits, because nothing provides the capability now.
  const late = {};
  await slice.runtime.loadPlugin(
    serviceObserver(AWARENESS_OBSERVER, desktopSessionAwarenessService, late),
  );
  assert.equal(slice.runtime.getPluginState(AWARENESS_OBSERVER), 'waiting');
  assert.equal(late.service, undefined);

  // The captured object is deliberately not asserted dead: it still closes over the baseline it was
  // built with and would still answer with it. What a shutdown ends is its reachability through the
  // runtime, which is what the assertions above state. Asserting more than that would be a lie that
  // a later reader would trust.
  assert.equal(typeof detached.current, 'function');
});

test('the four production plugins converge to the states this host actually supports', async (t) => {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  await runtime.loadPlugin(foregroundPlugin);
  await runtime.loadPlugin(inputActivityPlugin);
  await runtime.loadPlugin(desktopSessionWorldPlugin);
  await runtime.loadPlugin(desktopSessionAwarenessPlugin);

  if (onWindows) {
    assert.equal(runtime.getPluginState('foreground.windows'), 'active');
    assert.equal(runtime.getPluginState('input-activity.windows'), 'active');
    assert.equal(runtime.getPluginState('desktop-session-world'), 'active');
    assert.equal(runtime.getPluginState('desktop-session-awareness'), 'active');
  } else {
    // A host without the platform capability fails at the perception, and the failure propagates
    // one level at a time: the world cannot get its sources, and the awareness cannot get its
    // world. Neither invents a reading to keep the chain looking alive.
    assert.equal(runtime.getPluginState('foreground.windows'), 'failed');
    assert.equal(runtime.getPluginState('input-activity.windows'), 'failed');
    assert.equal(runtime.getPluginState('desktop-session-world'), 'waiting');
    assert.equal(runtime.getPluginState('desktop-session-awareness'), 'waiting');

    // The failure is the named domain error the module defines, not a generic crash.
    assert.ok(runtime.getPluginError('foreground.windows') instanceof ForegroundError);
    assert.ok(runtime.getPluginError('input-activity.windows') instanceof InputActivityError);
  }

  // Whichever way it went, the runtime itself survived and still serves unrelated plugins.
  await runtime.loadPlugin({ id: UNRELATED_OBSERVER, version: '1.0.0', setup() {} });
  assert.equal(runtime.getPluginState(UNRELATED_OBSERVER), 'active');

  await runtime.shutdown();
});

test(
  'the four production plugins observe a real desktop end to end',
  { skip: onWindows ? false : 'requires a win32 host' },
  async (t) => {
    const runtime = new Runtime();
    t.after(() => runtime.shutdown());

    // Unlike every other test in this file, all four plugins here are the production ones and the
    // readings come from a real desktop. Nothing about the desktop's current state is assumed: the
    // assertions below are about shape, reference and legal values only.
    await runtime.loadPlugin(foregroundPlugin);
    await runtime.loadPlugin(inputActivityPlugin);
    await runtime.loadPlugin(desktopSessionWorldPlugin);
    await runtime.loadPlugin(desktopSessionAwarenessPlugin);

    for (const id of [
      'foreground.windows',
      'input-activity.windows',
      ...SLICE_PLUGIN_IDS,
    ]) {
      assert.equal(runtime.getPluginState(id), 'active');
    }

    const observed = {};
    await runtime.loadPlugin(
      serviceObserver(AWARENESS_OBSERVER, desktopSessionAwarenessService, observed),
    );

    const baseline = await observed.service.current();
    assert.equal(baseline.kind, 'baseline');
    assert.match(baseline.current.snapshotAt, UTC_TIMESTAMP);
    assertForegroundFacet(baseline.current.foreground);
    assertInputActivityFacet(baseline.current.inputActivity);

    const comparison = await observed.service.current();
    assert.equal(comparison.kind, 'comparison');
    assert.equal(comparison.previous, baseline.current);
    assert.match(comparison.current.snapshotAt, UTC_TIMESTAMP);
    assertForegroundFacet(comparison.current.foreground);
    assertInputActivityFacet(comparison.current.inputActivity);

    // Legal values only. Whether anything actually changed between the two readings depends on what
    // a person was doing to this machine, so it is not asserted.
    assert.ok(['changed', 'unchanged', 'indeterminate'].includes(comparison.foreground));
    assert.ok(['changed', 'unchanged', 'indeterminate'].includes(comparison.inputActivity));
    assert.ok(['changed', 'stable', 'indeterminate'].includes(comparison.change));
    assert.ok(Object.isFrozen(comparison));
    assert.ok(Object.isFrozen(comparison.current));
    assert.ok(Object.isFrozen(comparison.previous));

    await runtime.shutdown();
    for (const id of ['foreground.windows', 'input-activity.windows', ...SLICE_PLUGIN_IDS]) {
      assert.equal(runtime.getPluginState(id), undefined);
    }
  },
);

function assertForegroundFacet(facet) {
  assert.ok(['available', 'unavailable'].includes(facet.kind));
  if (facet.kind === 'unavailable') return;

  const { observation } = facet;
  assert.equal(observation.source, 'foreground.windows');
  assert.match(observation.observedAt, UTC_TIMESTAMP);
  assert.ok(!Number.isNaN(Date.parse(observation.observedAt)));

  const { foreground } = observation;
  assert.ok(['present', 'absent'].includes(foreground.kind));
  if (foreground.kind === 'absent') return;

  for (const key of Object.keys(foreground)) {
    assert.ok(['kind', 'processName', 'title'].includes(key));
  }
  assert.equal(typeof foreground.processName, 'string');
  // A title has three states — reported as a string, reported as nothing, or not reported at all —
  // and the two that are not a string must stay distinguishable from one another.
  if ('title' in foreground) {
    assert.ok(foreground.title === null || typeof foreground.title === 'string');
  }
}

function assertInputActivityFacet(facet) {
  assert.ok(['available', 'unavailable'].includes(facet.kind));
  if (facet.kind === 'unavailable') return;

  const { observation } = facet;
  assert.equal(observation.source, 'input-activity.windows');
  assert.match(observation.observedAt, UTC_TIMESTAMP);
  assert.ok(!Number.isNaN(Date.parse(observation.observedAt)));

  assert.equal(typeof observation.lastInputTick, 'number');
  assert.ok(Number.isInteger(observation.lastInputTick));
  assert.ok(observation.lastInputTick >= 0 && observation.lastInputTick <= 4_294_967_295);
}
