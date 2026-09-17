import assert from 'node:assert/strict';
import test from 'node:test';

import { Runtime } from '../dist/index.js';
import {
  InputActivityObservationError,
  inputActivityPlugin,
  inputActivityService,
} from '../dist/input-activity/index.js';

const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const OBSERVATION_KEYS = ['lastInputTick', 'observedAt', 'source'];
const UINT32_MAX = 0xffffffff;

// `dwTime` in LASTINPUTINFO is a 32-bit tick count, so its resolution is the platform
// timer's, not the wall clock's. The slack absorbs that granularity plus scheduling noise
// without weakening the claim being made: the tick advances on a millisecond-scale clock.
const TICK_CLOCK_SLACK_MS = 250;

const onWindows = process.platform === 'win32';

test(
  'the real Windows acquisition path produces one well-formed observation',
  { skip: onWindows ? false : 'requires a win32 host' },
  async (t) => {
    const runtime = new Runtime();
    t.after(() => runtime.shutdown());
    const observed = {};

    const loadStarted = Date.now();
    const state = await runtime.loadPlugin(inputActivityPlugin);
    const loadDuration = Date.now() - loadStarted;

    await runtime.loadPlugin({
      id: 'test.input-activity-window-observer',
      version: '1.0.0',
      requires: [inputActivityService],
      setup(context) {
        observed.service = context.services.get(inputActivityService);
      },
    });

    assert.equal(state, 'active');
    assert.equal(runtime.getPluginState('test.input-activity-window-observer'), 'active');
    assert.equal(typeof observed.service.current, 'function');

    const acquisitionStarted = Date.now();
    const observation = await observed.service.current();
    const acquisitionDuration = Date.now() - acquisitionStarted;

    assert.deepEqual(Object.keys(observation).sort(), OBSERVATION_KEYS);
    assert.match(observation.observedAt, UTC_TIMESTAMP);
    assert.equal(new Date(observation.observedAt).toISOString(), observation.observedAt);
    assert.equal(observation.source, 'input-activity.windows');

    const { lastInputTick } = observation;
    assert.equal(typeof lastInputTick, 'number');
    assert.equal(Number.isInteger(lastInputTick), true);
    assert.ok(lastInputTick >= 0, `tick ${lastInputTick} is below the uint32 floor`);
    assert.ok(lastInputTick <= UINT32_MAX, `tick ${lastInputTick} is above the uint32 ceiling`);

    t.diagnostic(`real observation: ${JSON.stringify(observation)}`);
    t.diagnostic(`wall clock: loadPlugin ${loadDuration}ms, current() ${acquisitionDuration}ms`);
  },
);

test(
  'the real tick advances no faster than the wall clock',
  { skip: onWindows ? false : 'requires a win32 host' },
  async (t) => {
    const runtime = new Runtime();
    t.after(() => runtime.shutdown());
    const observed = {};

    await runtime.loadPlugin(inputActivityPlugin);
    await runtime.loadPlugin({
      id: 'test.input-activity-window-clock',
      version: '1.0.0',
      requires: [inputActivityService],
      setup(context) {
        observed.service = context.services.get(inputActivityService);
      },
    });

    // The window is opened before the first acquisition and closed after the second, so it
    // strictly contains both tick samples: delta may never exceed it.
    const windowStarted = Date.now();
    const first = await observed.service.current();
    const second = await observed.service.current();
    const elapsed = Date.now() - windowStarted;

    const delta = (second.lastInputTick - first.lastInputTick) >>> 0;

    assert.ok(
      delta <= elapsed + TICK_CLOCK_SLACK_MS,
      `tick advanced ${delta}ms while only ${elapsed}ms of wall clock elapsed`,
    );

    t.diagnostic(
      `first ${first.lastInputTick} -> second ${second.lastInputTick}, ` +
        `delta ${delta}ms over ${elapsed}ms of wall clock`,
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

    await runtime.loadPlugin(inputActivityPlugin);
    await runtime.loadPlugin({
      id: 'test.input-activity-window-teardown',
      version: '1.0.0',
      requires: [inputActivityService],
      setup(context) {
        observed.service = context.services.get(inputActivityService);
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
    assert.ok(result.error instanceof InputActivityObservationError);

    // A shutdown must not be reported as a timeout: that would send a human looking
    // for a timeout that never happened.
    assert.equal(result.error.message.includes('did not finish in time'), false);

    assert.ok(shutdownDuration < 2_000, `shutdown took ${shutdownDuration}ms`);
    t.diagnostic(`shutdown with an acquisition in flight: ${shutdownDuration}ms`);
    t.diagnostic(`teardown rejection: ${result.error.message}`);
  },
);
