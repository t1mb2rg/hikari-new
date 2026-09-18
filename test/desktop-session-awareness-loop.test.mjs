import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

import { Runtime } from '../dist/index.js';
import { desktopSessionAwarenessService } from '../dist/desktop-session-awareness/index.js';
import {
  desktopSessionAwarenessAssessedEvent,
  desktopSessionAwarenessLoopPlugin,
} from '../dist/desktop-session-awareness-loop/index.js';

const SNAPSHOT_AT = '2026-03-01T09:00:00.000Z';
const LOOP = 'desktop-session-awareness-loop';
const AWARENESS_PROVIDER = 'test.awareness-provider';
const LISTENER = 'test.awareness-loop-listener';
const SECOND_LISTENER = 'test.awareness-loop-second-listener';
const BROKEN_LISTENER = 'test.awareness-loop-broken-listener';
const THROWING_LISTENER = 'test.awareness-loop-throwing-listener';

// No injection seam: the loop under test is the production plugin, and the capability it consumes is
// supplied by an ordinary fake plugin that the real Runtime dependency graph decides to activate.
function awarenessProvider(behaviour) {
  const counts = { calls: 0 };
  const definition = {
    id: AWARENESS_PROVIDER,
    version: '1.0.0',
    provides: [desktopSessionAwarenessService],
    setup(context) {
      context.services.provide(
        desktopSessionAwarenessService,
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

// A fresh assessment object per call, so that "the subscriber received this assessment" can be stated
// as identity rather than as deep equality. The loop is not an author of this data, so the tests below
// are about which object arrived, never about what is inside it.
function assessment() {
  return Object.freeze({
    kind: 'baseline',
    current: Object.freeze({
      snapshotAt: SNAPSHOT_AT,
      foreground: Object.freeze({ kind: 'unavailable' }),
      inputActivity: Object.freeze({ kind: 'unavailable' }),
    }),
  });
}

function awareness() {
  const published = [];
  const provider = awarenessProvider(() => {
    const value = assessment();
    published.push(value);
    return Promise.resolve(value);
  });
  return { ...provider, published };
}

function listener(pluginId, received, onEvent) {
  return {
    id: pluginId,
    version: '1.0.0',
    setup(context) {
      context.events.on(desktopSessionAwarenessAssessedEvent, (payload) => {
        received.push(payload);
        return onEvent === undefined ? undefined : onEvent(payload);
      });
    },
  };
}

// Yields one whole event-loop turn, which drains every pending microtask. A macrotask boundary is
// deterministic — unlike a sleep, it proves the pending work is finished rather than that it
// probably had enough time.
function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function idle(turns = 5) {
  for (let turn = 0; turn < turns; turn += 1) await nextTurn();
}

// Waits for an observable condition rather than for a duration, so a cadence test asserts that the
// cycles happened and never that they happened on time. The deadline turns a condition that can never
// hold into a failure instead of a hang.
async function until(condition, message, deadlineMs = 2000) {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > deadlineMs) assert.fail(message);
    await nextTurn();
  }
}

// Real elapsed time, used only where a test must show that something did *not* happen. A timer left
// armed after a deactivation is the one thing no number of loop turns can prove absent, so these
// waits are several multiples of the cadence under test and a surviving timer would have fired many
// times over.
function elapsed(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Collects rejections that reach the process, so that a test can show the cycle boundary absorbed one
// instead of leaving it to the runner's default, which is to crash the process.
function trapRejections(t) {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  t.after(() => process.off('unhandledRejection', onUnhandled));
  return unhandled;
}

test('the loop requires exactly the awareness capability and provides nothing', async (t) => {
  assert.deepEqual(desktopSessionAwarenessLoopPlugin.requires, [desktopSessionAwarenessService]);
  assert.deepEqual(desktopSessionAwarenessLoopPlugin.provides, []);
  assert.equal(desktopSessionAwarenessLoopPlugin.id, LOOP);
  assert.equal(desktopSessionAwarenessLoopPlugin.version, '1.0.0');
  assert.equal(desktopSessionAwarenessAssessedEvent.id, 'desktop-session-awareness-loop.assessed');
  assert.equal(desktopSessionAwarenessAssessedEvent.version, 1);

  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  assert.equal(await runtime.loadPlugin(desktopSessionAwarenessLoopPlugin, { delayMs: 5 }), 'waiting');
});

test('the cadence must be given explicitly and must be a positive integer', async (t) => {
  const rejected = [
    undefined,
    null,
    5,
    {},
    { delayMs: undefined },
    { delayMs: null },
    { delayMs: 0 },
    { delayMs: -1 },
    { delayMs: 1.5 },
    { delayMs: Number.NaN },
    { delayMs: Number.POSITIVE_INFINITY },
    { delayMs: Number.NEGATIVE_INFINITY },
    { delayMs: '5' },
  ];

  for (const input of rejected) {
    const runtime = new Runtime();
    await assert.rejects(
      () => runtime.loadPlugin(desktopSessionAwarenessLoopPlugin, input),
      `a cadence of ${JSON.stringify(input)} must be rejected`,
    );
    // Validation happens before the plugin is registered, so a rejected cadence leaves no record.
    assert.equal(runtime.getPluginState(LOOP), undefined);
  }

  const runtime = new Runtime();
  t.after(() => runtime.shutdown());
  await runtime.loadPlugin(desktopSessionAwarenessLoopPlugin, { delayMs: 1 });
  assert.equal(runtime.getPluginState(LOOP), 'waiting');
});

test('setup acquires nothing and the first cycle does not wait for a cadence', async (t) => {
  // A cadence far longer than this test. A first cycle that waited for it could not arrive inside the
  // deadline below, so the arrival is what proves the first cycle is scheduled on activation.
  const provider = awareness();
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());
  const received = [];
  await runtime.loadPlugin(provider.definition);
  await runtime.loadPlugin(listener(LISTENER, received));
  await runtime.loadPlugin(desktopSessionAwarenessLoopPlugin, { delayMs: 10_000 });

  assert.equal(provider.counts.calls, 0, 'setup must not acquire anything');
  assert.deepEqual(received, [], 'setup must not publish anything');

  await until(() => provider.counts.calls === 1, 'the first cycle never ran', 1000);
  await until(() => received.length === 1, 'the first assessment was never published', 1000);
});

test('the assessment is published by reference and unmodified', async (t) => {
  const provider = awareness();
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());
  const received = [];
  await runtime.loadPlugin(provider.definition);
  await runtime.loadPlugin(listener(LISTENER, received));
  await runtime.loadPlugin(desktopSessionAwarenessLoopPlugin, { delayMs: 2 });

  await until(() => received.length >= 2, 'two cycles never completed');

  assert.equal(received[0], provider.published[0]);
  assert.equal(received[1], provider.published[1]);
  assert.notEqual(received[0], received[1]);
  assert.deepEqual(Object.keys(received[0]), Object.keys(provider.published[0]));
});

test('a cycle with no subscribers is legal and the loop keeps running', async (t) => {
  const provider = awareness();
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());
  await runtime.loadPlugin(provider.definition);
  await runtime.loadPlugin(desktopSessionAwarenessLoopPlugin, { delayMs: 2 });

  await until(() => provider.counts.calls >= 3, 'the loop stopped without any subscriber');
});

test('cycles keep running at the configured cadence', async (t) => {
  const provider = awareness();
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());
  await runtime.loadPlugin(provider.definition);
  await runtime.loadPlugin(desktopSessionAwarenessLoopPlugin, { delayMs: 2 });

  await until(() => provider.counts.calls >= 4, 'the loop did not reach four cycles');
  assert.ok(provider.published.length >= 4);
});

test('an acquisition slower than the cadence never overlaps the next one', async (t) => {
  const gates = [];
  const provider = awarenessProvider(() => {
    const gate = deferred();
    gates.push(gate);
    return gate.promise;
  });
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());
  const received = [];
  await runtime.loadPlugin(provider.definition);
  await runtime.loadPlugin(listener(LISTENER, received));
  // A cadence far shorter than the acquisitions below, so scheduling that armed the next cycle on a
  // clock rather than on completion would have started several more by the time each check runs.
  await runtime.loadPlugin(desktopSessionAwarenessLoopPlugin, { delayMs: 1 });

  await until(() => provider.counts.calls === 1, 'the first cycle never started');
  await elapsed(40);
  assert.equal(provider.counts.calls, 1, 'a second cycle started while the first was in flight');

  gates[0].resolve(assessment());
  await until(() => provider.counts.calls === 2, 'the second cycle never started');
  await elapsed(40);
  assert.equal(provider.counts.calls, 2, 'a third cycle started while the second was in flight');
  assert.equal(received.length, 1, 'the in-flight cycle published before it completed');

  gates[1].resolve(assessment());
  await until(() => received.length === 2, 'the second assessment was never published');
});

test('an acquisition rejection neither stops the loop nor escapes it', async (t) => {
  const unhandled = trapRejections(t);
  const failure = new Error('awareness could not be read');
  const provider = awarenessProvider((call) =>
    call === 2 ? Promise.reject(failure) : Promise.resolve(assessment()),
  );
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());
  const received = [];
  await runtime.loadPlugin(provider.definition);
  await runtime.loadPlugin(listener(LISTENER, received));
  await runtime.loadPlugin(desktopSessionAwarenessLoopPlugin, { delayMs: 2 });

  // Calls 1, 3, 4 and 5 each publish, so four arrivals also prove the loop carried on past call 2.
  await until(() => received.length >= 4, 'the loop did not continue past the rejected cycle');
  await idle();
  assert.deepEqual(unhandled, []);
});

test('a failing subscriber does not stop the loop', async (t) => {
  const unhandled = trapRejections(t);
  const provider = awareness();
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());
  const healthy = [];
  const broken = [];
  await runtime.loadPlugin(provider.definition);
  await runtime.loadPlugin(listener(LISTENER, healthy));
  await runtime.loadPlugin(listener(BROKEN_LISTENER, broken, () => Promise.reject(new Error('this subscriber always fails'))));
  await runtime.loadPlugin(desktopSessionAwarenessLoopPlugin, { delayMs: 2 });

  // The rejection reaches the producer as an AggregateError. It is this cycle's publication failure
  // and nothing more: a subscriber does not get to decide whether the loop continues.
  await until(() => healthy.length >= 3, 'the loop stopped because a subscriber failed');
  assert.equal(broken.length, healthy.length, 'the failing subscriber was not offered every assessment');
  await idle();
  assert.deepEqual(unhandled, [], 'a failed publication must not become an unhandled rejection');
});

test('a subscriber that throws synchronously does not stop the loop', async (t) => {
  const unhandled = trapRejections(t);
  const provider = awareness();
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());
  const throwing = [];
  await runtime.loadPlugin(provider.definition);
  await runtime.loadPlugin(
    listener(THROWING_LISTENER, throwing, () => {
      throw new Error('this subscriber always throws');
    }),
  );
  await runtime.loadPlugin(desktopSessionAwarenessLoopPlugin, { delayMs: 2 });

  await until(() => throwing.length >= 3, 'the loop stopped because a subscriber threw');
  await idle();
  assert.deepEqual(unhandled, []);
});

test('an unload with a cycle pending cancels it', async (t) => {
  const provider = awareness();
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());
  await runtime.loadPlugin(provider.definition);
  await runtime.loadPlugin(desktopSessionAwarenessLoopPlugin, { delayMs: 40 });

  await until(() => provider.counts.calls === 1, 'the first cycle never ran');
  // The cadence timer for the second cycle is armed at this point, with 40ms still to run.
  await runtime.unloadPlugin(LOOP);
  assert.equal(runtime.getPluginState(LOOP), undefined);

  await elapsed(160);
  assert.equal(provider.counts.calls, 1, 'a cleared timer ran a cycle after deactivation');
});

test('an unload during an in-flight cycle waits for it and publishes nothing', async (t) => {
  const gate = deferred();
  const provider = awarenessProvider(() => gate.promise);
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());
  const received = [];
  await runtime.loadPlugin(provider.definition);
  await runtime.loadPlugin(listener(LISTENER, received));
  await runtime.loadPlugin(desktopSessionAwarenessLoopPlugin, { delayMs: 1 });

  await until(() => provider.counts.calls === 1, 'the first cycle never started');

  let unloaded = false;
  const unloading = runtime.unloadPlugin(LOOP).then(() => {
    unloaded = true;
  });
  await idle();
  assert.equal(unloaded, false, 'the unload did not wait for the in-flight cycle');

  // The acquisition was never cancelled, so it still completes — and the loop must still not publish
  // it. The work being already underway is not what makes the result this activation's to announce.
  gate.resolve(assessment());
  await unloading;

  assert.deepEqual(received, [], 'a cycle that resolved after deactivation published');
  await elapsed(40);
  assert.equal(provider.counts.calls, 1, 'a deactivated loop scheduled another cycle');
});

test('an in-flight cycle that rejects during unload still lets the unload finish', async (t) => {
  const unhandled = trapRejections(t);
  const gate = deferred();
  const provider = awarenessProvider(() => gate.promise);
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());
  await runtime.loadPlugin(provider.definition);
  await runtime.loadPlugin(desktopSessionAwarenessLoopPlugin, { delayMs: 1 });

  await until(() => provider.counts.calls === 1, 'the first cycle never started');
  const unloading = runtime.unloadPlugin(LOOP);

  gate.reject(new Error('awareness failed while the loop was being deactivated'));
  await unloading;

  assert.equal(runtime.getPluginState(LOOP), undefined);
  await idle();
  assert.deepEqual(unhandled, []);
});

test('the loop waits when awareness disappears and restarts fresh when it returns', async (t) => {
  // A cadence far longer than this test, so that a first cycle arriving quickly is what distinguishes
  // "scheduled on activation" from "resumed part way through a cadence".
  const provider = awareness();
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());
  await runtime.loadPlugin(provider.definition);
  await runtime.loadPlugin(desktopSessionAwarenessLoopPlugin, { delayMs: 10_000 });

  await until(() => provider.counts.calls === 1, 'the first cycle never ran', 1000);
  assert.equal(runtime.getPluginState(LOOP), 'active');

  await runtime.unloadPlugin(AWARENESS_PROVIDER);
  assert.equal(runtime.getPluginState(LOOP), 'waiting');

  const beforeGap = provider.counts.calls;
  await elapsed(40);
  assert.equal(provider.counts.calls, beforeGap, 'a waiting loop drove a capability it no longer has');

  const revived = awareness();
  await runtime.loadPlugin(revived.definition);
  assert.equal(runtime.getPluginState(LOOP), 'active');
  await until(() => revived.counts.calls === 1, 'the reactivated loop never ran its first cycle', 1000);
});

test('consumers fan out through the event without calling the awareness service', async (t) => {
  const provider = awareness();
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());
  const first = [];
  const second = [];
  await runtime.loadPlugin(provider.definition);
  await runtime.loadPlugin(listener(LISTENER, first));
  await runtime.loadPlugin(listener(SECOND_LISTENER, second));
  await runtime.loadPlugin(desktopSessionAwarenessLoopPlugin, { delayMs: 2 });

  await until(() => first.length >= 3 && second.length >= 3, 'both consumers were never served');

  assert.equal(first[0], second[0], 'the two consumers were handed different assessments');
  assert.deepEqual(first, second);
  // The discriminator: acquisitions track cycles, not consumers. Were each consumer driving its own,
  // the count would be at least twice the number of assessments either of them received.
  assert.ok(
    provider.counts.calls <= first.length + 1,
    `${provider.counts.calls} acquisitions served ${first.length} published assessments`,
  );
});

test('the loop module depends only on public entry points', () => {
  const dir = new URL('../src/desktop-session-awareness-loop/', import.meta.url);
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.ts'))
    .sort();
  assert.deepEqual(files, ['contracts.ts', 'index.ts', 'plugin.ts']);

  const publicEntryPoints = new Set([
    '../desktop-session-awareness/index.js',
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

test('the loop module carries no policy, platform, or storage vocabulary', () => {
  const dir = new URL('../src/desktop-session-awareness-loop/', import.meta.url);
  const combined = readdirSync(dir)
    .filter((name) => name.endsWith('.ts'))
    .sort()
    .map((name) => readFileSync(new URL(name, dir), 'utf8'))
    .join('\n');

  // Word-formed identifiers and platform strings only, for the same reason the awareness module's
  // equivalents are: a bare English root would fire on a comment explaining what this layer refuses
  // to do, and a comment has to be free to name the thing it refuses.
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
    'salience',
    'importance',
    'priority',
    'notify',
    'memory',
    'action',
    'isIdle',
    'isAway',
    'userPresent',
    'userAway',
    'idleFor',
    'health',
  ]) {
    assert.equal(combined.includes(token), false, `the loop module must not contain "${token}"`);
  }
});

test('the loop added no file to any module it depends on', () => {
  const expected = new Map([
    [
      'runtime',
      [
        'contracts.ts',
        'effect-scope.ts',
        'errors.ts',
        'event-bus.ts',
        'plugin-context.ts',
        'plugin.ts',
        'runtime.ts',
        'service-registry.ts',
      ],
    ],
    [
      'foreground',
      ['acquisition.ts', 'contracts.ts', 'errors.ts', 'index.ts', 'plugin.ts', 'types.ts', 'windows.ts'],
    ],
    [
      'input-activity',
      ['acquisition.ts', 'contracts.ts', 'errors.ts', 'index.ts', 'plugin.ts', 'types.ts', 'windows.ts'],
    ],
    ['desktop-session-world', ['contracts.ts', 'index.ts', 'plugin.ts', 'types.ts']],
    ['desktop-session-awareness', ['contracts.ts', 'index.ts', 'plugin.ts', 'types.ts']],
  ]);

  for (const [module, files] of expected) {
    const dir = new URL(`../src/${module}/`, import.meta.url);
    assert.deepEqual(
      readdirSync(dir)
        .filter((name) => name.endsWith('.ts'))
        .sort(),
      files,
      `${module} gained or lost a file`,
    );
  }
});
