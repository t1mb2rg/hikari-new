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
  ForegroundObservationError,
  foregroundPlugin,
  foregroundService,
} from '../dist/foreground/index.js';

// The single named exception to the "tests import only public entry points" pattern: the
// acquisition seam is internal, and supplying a fake acquirer is the only way to make these
// tests deterministic without reaching the real desktop.
import { createForegroundPlugin } from '../dist/foreground/plugin.js';

const ACQUIRED_AT = '2026-02-01T08:30:00.000Z';
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function createRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'hikari-foreground-'));
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

function acquisition(target, observedAt = ACQUIRED_AT) {
  return { observedAt, target };
}

async function observeForeground(runtime, acquirer) {
  const observed = {};
  await runtime.loadPlugin(createForegroundPlugin(() => acquirer));
  await runtime.loadPlugin({
    id: 'test.foreground-observer',
    version: '1.0.0',
    requires: [foregroundService],
    setup(context) {
      observed.service = context.services.get(foregroundService);
    },
  });
  return observed;
}

async function observeOnce(t, acquire) {
  const { acquirer, counts } = acquirerFrom(acquire);
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());
  const observed = await observeForeground(runtime, acquirer);
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

test('the foreground plugin requires nothing and provides foreground.current@1', async (t) => {
  const { acquirer } = acquirerFrom(() => acquisition({ kind: 'absent' }));
  const definition = createForegroundPlugin(() => acquirer);

  assert.deepEqual(definition.requires, []);
  assert.deepEqual(definition.provides, [foregroundService]);
  assert.equal(foregroundService.id, 'foreground.current');
  assert.equal(foregroundService.version, 1);

  const runtime = new Runtime();
  assert.equal(await runtime.loadPlugin(definition), 'active');
  await runtime.shutdown();
});

test('the foreground service is reachable through the plugin dependency graph', async (t) => {
  const { observed, runtime } = await observeOnce(t, () => acquisition({ kind: 'absent' }));

  assert.equal(runtime.getPluginState('foreground.windows'), 'active');
  assert.equal(runtime.getPluginState('test.foreground-observer'), 'active');
  assert.deepEqual(Object.keys(observed.service), ['current']);
});

test('every current() call performs a new acquisition and returns a fresh observation', async (t) => {
  const { observed, counts } = await observeOnce(t, (nth) =>
    acquisition({ kind: 'present', title: `observation ${nth}` }),
  );

  const first = await observed.service.current();
  const second = await observed.service.current();
  const third = await observed.service.current();

  assert.equal(counts.acquisitions, 3);
  assert.equal(first.foreground.title, 'observation 1');
  assert.equal(second.foreground.title, 'observation 2');
  assert.equal(third.foreground.title, 'observation 3');
  assert.notEqual(first, second);
});

test('the plugin performs no background observation while loaded, idle or shut down', async (t) => {
  const { observed, counts, runtime } = await observeOnce(t, () => acquisition({ kind: 'absent' }));

  assert.equal(counts.acquisitions, 0);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(counts.acquisitions, 0);

  await runtime.shutdown();
  assert.equal(counts.acquisitions, 0);
  assert.equal(counts.disposals, 1);
  assert.equal(runtime.getPluginState('foreground.windows'), undefined);
});

test('an absent foreground target is a successful observation', async (t) => {
  const { observed } = await observeOnce(t, () => acquisition({ kind: 'absent' }));

  const observation = await observed.service.current();

  assert.deepEqual(observation.foreground, { kind: 'absent' });
  assert.equal('title' in observation.foreground, false);
  assert.equal('processName' in observation.foreground, false);
});

test('a present foreground target is observed with the metadata that is available', async (t) => {
  const { observed } = await observeOnce(t, () =>
    acquisition({ kind: 'present', title: 'Visual Studio Code', processName: 'Code' }),
  );

  const observation = await observed.service.current();

  assert.deepEqual(observation.foreground, {
    kind: 'present',
    title: 'Visual Studio Code',
    processName: 'Code',
  });
});

test('a failed acquisition rejects and never resolves into an absent observation', async (t) => {
  const { observed } = await observeOnce(t, () => {
    throw new ForegroundObservationError('the acquisition process exited with code 1');
  });

  await assert.rejects(() => observed.service.current(), ForegroundObservationError);
});

test('an unexpected acquisition failure still rejects instead of collapsing into absence', async (t) => {
  const { observed } = await observeOnce(t, () => {
    throw new Error('something nobody modelled yet');
  });

  const settled = await observed.service.current().then(
    () => 'resolved',
    () => 'rejected',
  );

  assert.equal(settled, 'rejected');
});

test('title distinguishes text, confirmed absence of text and unavailability', async (t) => {
  const cases = [
    { target: { kind: 'present', title: 'Untitled - Notepad' }, value: 'Untitled - Notepad' },
    { target: { kind: 'present', title: null }, value: null },
    { target: { kind: 'present' }, value: undefined },
  ];

  for (const { target, value } of cases) {
    const { observed, runtime } = await observeOnce(t, () => acquisition(target));

    const observation = await observed.service.current();

    assert.equal(observation.foreground.kind, 'present');
    assert.equal(observation.foreground.title, value);
    assert.equal('title' in observation.foreground, value !== undefined);

    await runtime.shutdown();
  }
});

test('processName is omitted when it cannot be obtained', async (t) => {
  const { observed } = await observeOnce(t, () =>
    acquisition({ kind: 'present', title: 'Untitled - Notepad' }),
  );

  const observation = await observed.service.current();

  assert.equal(observation.foreground.kind, 'present');
  assert.equal(observation.foreground.title, 'Untitled - Notepad');
  assert.equal('processName' in observation.foreground, false);
});

test('metadata missing does not overturn an observation whose target was acquired', async (t) => {
  const { observed, counts } = await observeOnce(t, () =>
    acquisition({ kind: 'present', title: null }),
  );

  const observation = await observed.service.current();

  assert.equal(observation.foreground.kind, 'present');
  assert.equal(observation.foreground.title, null);
  assert.equal('processName' in observation.foreground, false);
  assert.equal(counts.acquisitions, 1);
});

test('the observation carries its own source identity', async (t) => {
  const { observed } = await observeOnce(t, () => acquisition({ kind: 'absent' }));

  const observation = await observed.service.current();

  assert.equal(observation.source, 'foreground.windows');
});

test('observedAt is passed through and never re-stamped by the plugin', async (t) => {
  const historical = '2026-02-01T08:30:00.000Z';
  const { observed } = await observeOnce(t, () => acquisition({ kind: 'present' }, historical));

  const observation = await observed.service.current();

  assert.equal(observation.observedAt, historical);
  assert.match(observation.observedAt, UTC_TIMESTAMP);
  assert.ok(Math.abs(Date.now() - Date.parse(historical)) > 60_000);
});

test('the observation is frozen at both levels', async (t) => {
  const { observed } = await observeOnce(t, () =>
    acquisition({ kind: 'present', title: 'Untitled - Notepad' }),
  );

  const observation = await observed.service.current();

  assert.equal(Object.isFrozen(observation), true);
  assert.equal(Object.isFrozen(observation.foreground), true);
});

test('foreground converges without continuity or chronicle loaded', async (t) => {
  const runtime = new Runtime();
  const observed = await observeForeground(
    runtime,
    acquirerFrom(() => acquisition({ kind: 'absent' })).acquirer,
  );

  const observation = await observed.service.current();

  assert.equal(runtime.getPluginState('foreground.windows'), 'active');
  assert.equal(observation.foreground.kind, 'absent');
  assert.equal(runtime.getPluginState('continuity'), undefined);
  assert.equal(runtime.getPluginState('chronicle'), undefined);

  await runtime.shutdown();
});

test('foreground observation leaves continuity and chronicle storage untouched', async (t) => {
  const root = createRoot(t);
  const identity = initializeHikari({ rootDir: root });
  initializeChronicle({ rootDir: root, identity });
  const before = snapshot(root);

  const runtime = new Runtime();
  await runtime.loadPlugin(continuityPlugin, { rootDir: root });
  await runtime.loadPlugin(chroniclePlugin, { rootDir: root });
  const observed = await observeForeground(
    runtime,
    acquirerFrom(() => acquisition({ kind: 'present', title: 'Untitled - Notepad' })).acquirer,
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

test('production plugin availability matches the host platform', async (t) => {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());
  const observed = {};

  const state = await runtime.loadPlugin(foregroundPlugin);
  await runtime.loadPlugin({
    id: 'test.foreground-observer',
    version: '1.0.0',
    requires: [foregroundService],
    setup(context) {
      observed.service = context.services.get(foregroundService);
    },
  });

  if (process.platform === 'win32') {
    assert.equal(state, 'active');
    assert.equal(runtime.getPluginState('test.foreground-observer'), 'active');
    assert.equal(observed.service.current instanceof Function, true);
  } else {
    assert.equal(state, 'failed');
    assert.ok(runtime.getPluginError('foreground.windows') instanceof ForegroundError);
    assert.equal(runtime.getPluginState('test.foreground-observer'), 'waiting');
    assert.equal(observed.service, undefined);
  }
});

test('plugin setup performs no foreground observation', async (t) => {
  const { acquirer, counts } = acquirerFrom(() => acquisition({ kind: 'absent' }));
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  await runtime.loadPlugin(createForegroundPlugin(() => acquirer));

  assert.equal(runtime.getPluginState('foreground.windows'), 'active');
  assert.equal(counts.acquisitions, 0);
  assert.equal(counts.disposals, 0);
});
