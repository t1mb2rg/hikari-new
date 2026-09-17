import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';

import { Runtime } from '../dist/index.js';
import { chroniclePlugin, initializeChronicle, resolveChroniclePath } from '../dist/chronicle/index.js';
import { continuityPlugin, initializeHikari, resolveOriginPath } from '../dist/continuity/index.js';
import {
  ForegroundError,
  foregroundPlugin,
  foregroundService,
} from '../dist/foreground/index.js';
import {
  InputActivityError,
  InputActivityObservationError,
  inputActivityPlugin,
  inputActivityService,
} from '../dist/input-activity/index.js';

// The single named exception to the "tests import only public entry points" pattern, matching the
// one already accepted for foreground: the acquisition seam is internal, and supplying a fake
// acquirer is the only way to make these tests deterministic without reaching the real desktop.
import { createInputActivityPlugin } from '../dist/input-activity/plugin.js';

const ACQUIRED_AT = '2026-02-01T08:30:00.000Z';
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UINT32_MAX = 0xffffffff;

function createRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'hikari-input-activity-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function acquirerFrom(acquire) {
  const counts = { acquisitions: 0, disposals: 0 };
  const acquirer = {
    acquire() {
      counts.acquisitions += 1;
      const nth = counts.acquisitions;
      return Promise.resolve().then(() => acquire(nth));
    },
    dispose() {
      counts.disposals += 1;
      return Promise.resolve();
    },
  };
  return { acquirer, counts };
}

function acquisition(lastInputTick, observedAt = ACQUIRED_AT) {
  return { observedAt, lastInputTick };
}

async function observeInputActivity(runtime, acquirer) {
  const observed = {};
  await runtime.loadPlugin(createInputActivityPlugin(() => acquirer));
  await runtime.loadPlugin({
    id: 'test.input-activity-observer',
    version: '1.0.0',
    requires: [inputActivityService],
    setup(context) {
      observed.service = context.services.get(inputActivityService);
    },
  });
  return observed;
}

async function observeOnce(t, acquire) {
  const { acquirer, counts } = acquirerFrom(acquire);
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());
  const observed = await observeInputActivity(runtime, acquirer);
  return { observed, counts, runtime };
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

test('the input activity plugin requires nothing and provides input-activity.current@1', async () => {
  const { acquirer } = acquirerFrom(() => acquisition(0));
  const definition = createInputActivityPlugin(() => acquirer);

  assert.deepEqual(definition.requires, []);
  assert.deepEqual(definition.provides, [inputActivityService]);
  assert.equal(definition.id, 'input-activity.windows');
  assert.equal(definition.version, '1.0.0');
  assert.equal(inputActivityService.id, 'input-activity.current');
  assert.equal(inputActivityService.version, 1);

  const runtime = new Runtime();
  assert.equal(await runtime.loadPlugin(definition), 'active');
  await runtime.shutdown();
});

test('the input activity service is reachable through the plugin dependency graph', async (t) => {
  const { observed, runtime } = await observeOnce(t, () => acquisition(0));

  assert.equal(runtime.getPluginState('input-activity.windows'), 'active');
  assert.equal(runtime.getPluginState('test.input-activity-observer'), 'active');
  assert.deepEqual(Object.keys(observed.service), ['current']);
});

test('every current() call performs a new acquisition and returns a fresh observation', async (t) => {
  const { observed, counts } = await observeOnce(t, (nth) => acquisition(nth));

  const first = await observed.service.current();
  const second = await observed.service.current();
  const third = await observed.service.current();

  assert.equal(counts.acquisitions, 3);
  assert.equal(first.lastInputTick, 1);
  assert.equal(second.lastInputTick, 2);
  assert.equal(third.lastInputTick, 3);
  assert.notEqual(first, second);
});

test('the plugin performs no background observation while loaded, idle or shut down', async (t) => {
  const { counts, runtime } = await observeOnce(t, () => acquisition(0));

  assert.equal(counts.acquisitions, 0);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(counts.acquisitions, 0);

  await runtime.shutdown();
  assert.equal(counts.acquisitions, 0);
  assert.equal(counts.disposals, 1);
  assert.equal(runtime.getPluginState('input-activity.windows'), undefined);
});

test('plugin setup performs no input observation', async (t) => {
  const { acquirer, counts } = acquirerFrom(() => acquisition(0));
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  await runtime.loadPlugin(createInputActivityPlugin(() => acquirer));

  assert.equal(runtime.getPluginState('input-activity.windows'), 'active');
  assert.equal(counts.acquisitions, 0);
  assert.equal(counts.disposals, 0);
});

test('lastInputTick is passed through unchanged at the uint32 boundaries', async (t) => {
  for (const tick of [0, 1, 0xffffffff, 1234567890]) {
    const { observed, runtime } = await observeOnce(t, () => acquisition(tick));

    const observation = await observed.service.current();

    assert.equal(observation.lastInputTick, tick);
    assert.equal(Number.isInteger(observation.lastInputTick), true);
    assert.ok(observation.lastInputTick >= 0);
    assert.ok(observation.lastInputTick <= UINT32_MAX);

    await runtime.shutdown();
  }
});

test('a smaller tick after a larger one is reported as observed, not corrected', async (t) => {
  const ticks = [123456, 123400];
  let index = 0;
  const { observed } = await observeOnce(t, () => acquisition(ticks[index++]));

  const first = await observed.service.current();
  const second = await observed.service.current();

  assert.equal(first.lastInputTick, 123456);
  assert.equal(second.lastInputTick, 123400);
  assert.ok(second.lastInputTick < first.lastInputTick);
});

test('the observation carries its own source identity', async (t) => {
  const { observed } = await observeOnce(t, () => acquisition(0));

  const observation = await observed.service.current();

  assert.equal(observation.source, 'input-activity.windows');
});

test('observedAt is passed through and never re-stamped by the plugin', async (t) => {
  const historical = '2026-02-01T08:30:00.000Z';
  const { observed } = await observeOnce(t, () => acquisition(0, historical));

  const observation = await observed.service.current();

  assert.equal(observation.observedAt, historical);
  assert.match(observation.observedAt, UTC_TIMESTAMP);
  assert.ok(Math.abs(Date.now() - Date.parse(historical)) > 60_000);
});

test('the observation is frozen', async (t) => {
  const { observed } = await observeOnce(t, () => acquisition(7));

  const observation = await observed.service.current();

  assert.equal(Object.isFrozen(observation), true);
});

test('a failed acquisition rejects and never resolves into an observation', async (t) => {
  const { observed } = await observeOnce(t, () => {
    throw new InputActivityObservationError('the acquisition process exited with code 1');
  });

  await assert.rejects(() => observed.service.current(), InputActivityObservationError);
});

test('an unexpected acquisition failure still rejects instead of collapsing', async (t) => {
  const { observed } = await observeOnce(t, () => {
    throw new Error('something nobody modelled yet');
  });

  const settled = await observed.service.current().then(
    () => 'resolved',
    () => 'rejected',
  );

  assert.equal(settled, 'rejected');
});

test('input activity converges without continuity, chronicle or foreground loaded', async (t) => {
  const runtime = new Runtime();
  const observed = await observeInputActivity(
    runtime,
    acquirerFrom(() => acquisition(42)).acquirer,
  );

  const observation = await observed.service.current();

  assert.equal(runtime.getPluginState('input-activity.windows'), 'active');
  assert.equal(observation.lastInputTick, 42);
  assert.equal(runtime.getPluginState('continuity'), undefined);
  assert.equal(runtime.getPluginState('chronicle'), undefined);
  assert.equal(runtime.getPluginState('foreground.windows'), undefined);

  await runtime.shutdown();
});

test('input activity observation leaves continuity and chronicle storage untouched', async (t) => {
  const root = createRoot(t);
  const identity = initializeHikari({ rootDir: root });
  initializeChronicle({ rootDir: root, identity });
  const before = snapshot(root);

  const runtime = new Runtime();
  await runtime.loadPlugin(continuityPlugin, { rootDir: root });
  await runtime.loadPlugin(chroniclePlugin, { rootDir: root });
  const observed = await observeInputActivity(
    runtime,
    acquirerFrom(() => acquisition(123456)).acquirer,
  );

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

test('foreground and input activity coexist as two independent perceptions', async (t) => {
  // Neither perception declares a dependency on the other, and nothing above them composes
  // them: each one is satisfied by the Runtime entirely on its own terms.
  assert.deepEqual(foregroundPlugin.requires, []);
  assert.deepEqual(inputActivityPlugin.requires, []);
  assert.deepEqual(foregroundPlugin.provides, [foregroundService]);
  assert.deepEqual(inputActivityPlugin.provides, [inputActivityService]);
  assert.notEqual(foregroundService.id, inputActivityService.id);

  const runtime = new Runtime();
  t.after(() => runtime.shutdown());
  const seen = {};

  const foregroundState = await runtime.loadPlugin(foregroundPlugin);
  const inputState = await runtime.loadPlugin(inputActivityPlugin);

  for (const [id, contract] of [
    ['test.foreground-observer', foregroundService],
    ['test.input-activity-observer', inputActivityService],
  ]) {
    await runtime.loadPlugin({
      id,
      version: '1.0.0',
      requires: [contract],
      setup(context) {
        seen[contract.id] = context.services.get(contract);
      },
    });
  }

  const providerState = process.platform === 'win32' ? 'active' : 'failed';
  const consumerState = process.platform === 'win32' ? 'active' : 'waiting';

  assert.equal(foregroundState, providerState);
  assert.equal(inputState, providerState);
  assert.equal(runtime.getPluginState('test.foreground-observer'), consumerState);
  assert.equal(runtime.getPluginState('test.input-activity-observer'), consumerState);

  if (providerState === 'active') {
    const foreground = await seen['foreground.current'].current();
    const input = await seen['input-activity.current'].current();

    assert.equal(foreground.source, 'foreground.windows');
    assert.equal(input.source, 'input-activity.windows');
    assert.notEqual(foreground, input);
  } else {
    // Each perception fails on its own terms, and neither failure disturbs the other.
    assert.ok(runtime.getPluginError('foreground.windows') instanceof ForegroundError);
    assert.ok(runtime.getPluginError('input-activity.windows') instanceof InputActivityError);
  }
});

test('production plugin availability matches the host platform', async (t) => {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());
  const observed = {};

  const state = await runtime.loadPlugin(inputActivityPlugin);
  await runtime.loadPlugin({
    id: 'test.input-activity-observer',
    version: '1.0.0',
    requires: [inputActivityService],
    setup(context) {
      observed.service = context.services.get(inputActivityService);
    },
  });

  if (process.platform === 'win32') {
    assert.equal(state, 'active');
    assert.equal(runtime.getPluginState('test.input-activity-observer'), 'active');
    assert.equal(observed.service.current instanceof Function, true);
  } else {
    assert.equal(state, 'failed');
    assert.ok(runtime.getPluginError('input-activity.windows') instanceof InputActivityError);
    assert.equal(runtime.getPluginState('test.input-activity-observer'), 'waiting');
    assert.equal(observed.service, undefined);
  }
});
