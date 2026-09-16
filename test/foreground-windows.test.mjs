import assert from 'node:assert/strict';
import test from 'node:test';

import { Runtime } from '../dist/index.js';
import {
  ForegroundObservationError,
  foregroundPlugin,
  foregroundService,
} from '../dist/foreground/index.js';

const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const OBSERVATION_KEYS = ['foreground', 'observedAt', 'source'];
const PRESENT_KEYS = ['kind', 'processName', 'title'];

const onWindows = process.platform === 'win32';

test(
  'the real Windows acquisition path produces one well-formed observation',
  { skip: onWindows ? false : 'requires a win32 host' },
  async (t) => {
    const runtime = new Runtime();
    t.after(() => runtime.shutdown());
    const observed = {};

    const loadStarted = Date.now();
    const state = await runtime.loadPlugin(foregroundPlugin);
    const loadDuration = Date.now() - loadStarted;

    await runtime.loadPlugin({
      id: 'test.foreground-window-observer',
      version: '1.0.0',
      requires: [foregroundService],
      setup(context) {
        observed.service = context.services.get(foregroundService);
      },
    });

    assert.equal(state, 'active');
    assert.equal(runtime.getPluginState('test.foreground-window-observer'), 'active');
    assert.equal(typeof observed.service.current, 'function');

    const acquisitionStarted = Date.now();
    const observation = await observed.service.current();
    const acquisitionDuration = Date.now() - acquisitionStarted;

    assert.deepEqual(Object.keys(observation).sort(), OBSERVATION_KEYS);
    assert.match(observation.observedAt, UTC_TIMESTAMP);
    assert.equal(new Date(observation.observedAt).toISOString(), observation.observedAt);
    assert.equal(observation.source, 'foreground.windows');

    const { foreground } = observation;
    assert.ok(foreground.kind === 'present' || foreground.kind === 'absent');

    if (foreground.kind === 'present') {
      assert.ok(Object.keys(foreground).every((key) => PRESENT_KEYS.includes(key)));
      if ('title' in foreground) {
        assert.ok(typeof foreground.title === 'string' || foreground.title === null);
      }
      if ('processName' in foreground) {
        assert.equal(typeof foreground.processName, 'string');
        assert.ok(foreground.processName.length > 0);
      }
    } else {
      assert.deepEqual(Object.keys(foreground), ['kind']);
    }

    t.diagnostic(`real observation: ${JSON.stringify(observation)}`);
    t.diagnostic(
      `wall clock: loadPlugin ${loadDuration}ms, current() ${acquisitionDuration}ms`,
    );
  },
);

test(
  'a real acquisition in flight is torn down truthfully when the plugin shuts down',
  { skip: onWindows ? false : 'requires a win32 host' },
  async (t) => {
    const runtime = new Runtime();
    t.after(() => runtime.shutdown());
    const observed = {};

    await runtime.loadPlugin(foregroundPlugin);
    await runtime.loadPlugin({
      id: 'test.foreground-window-teardown',
      version: '1.0.0',
      requires: [foregroundService],
      setup(context) {
        observed.service = context.services.get(foregroundService);
      },
    });

    const settled = observed.service.current().then(
      () => ({ outcome: 'resolved' }),
      (error) => ({ outcome: 'rejected', error }),
    );

    const shutdownStarted = Date.now();
    await runtime.shutdown();
    const shutdownDuration = Date.now() - shutdownStarted;

    const result = await settled;

    assert.equal(result.outcome, 'rejected');
    assert.ok(result.error instanceof ForegroundObservationError);

    // A shutdown must not be reported as a timeout: that would send a human looking
    // for a timeout that never happened.
    assert.equal(result.error.message.includes('did not finish in time'), false);

    assert.ok(shutdownDuration < 2_000, `shutdown took ${shutdownDuration}ms`);
    t.diagnostic(`shutdown with an acquisition in flight: ${shutdownDuration}ms`);
    t.diagnostic(`teardown rejection: ${result.error.message}`);
  },
);
