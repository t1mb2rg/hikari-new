import assert from 'node:assert/strict';
import test from 'node:test';

import { Runtime } from '../dist/index.js';
import {
  InputActivityObservationError,
  inputActivityPlugin,
  inputActivityService,
} from '../dist/input-activity/index.js';

const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const OBSERVATION_KEYS = ['lastInputTick', 'observedAt', 'observedTick', 'source'];
const UINT32_MAX = 0xffffffff;

const onWindows = process.platform === 'win32';

// Both ticks, each a uint32, plus the one relation between them the acquisition guarantees.
//
// They are two readings of the same 32-bit millisecond counter, and the acquisition reads the last
// input's before the observation's own, so the second can never be smaller than the first. That is
// the whole of why subtracting one from the other is a duration, and it is the premise the return
// rule's arithmetic rests on, so it is checked against a real host rather than assumed from the
// shape of the script. What is still *not* checked is any bound relating two separate acquisitions:
// `dwTime` is the tick of the most recent input, which can predate the window by an unbounded
// amount, so no such bound is true. See the note before the second test.
function assertTicksAreWellFormed(observation) {
  const ticks = [
    ['lastInputTick', observation.lastInputTick],
    ['observedTick', observation.observedTick],
  ];

  for (const [name, tick] of ticks) {
    assert.equal(typeof tick, 'number', `${name} is not a number`);
    assert.equal(Number.isInteger(tick), true, `${name} is not an integer`);
    assert.ok(tick >= 0, `${name} ${tick} is below the uint32 floor`);
    assert.ok(tick <= UINT32_MAX, `${name} ${tick} is above the uint32 ceiling`);
  }

  assert.ok(
    observation.lastInputTick <= observation.observedTick,
    `last input tick ${observation.lastInputTick} is after the observation's own reading ${observation.observedTick}`,
  );
}

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

    assertTicksAreWellFormed(observation);

    t.diagnostic(`real observation: ${JSON.stringify(observation)}`);
    t.diagnostic(`wall clock: loadPlugin ${loadDuration}ms, current() ${acquisitionDuration}ms`);
  },
);

// Two sequential real acquisitions, each independently well-formed.
//
// This test previously asserted that `second.lastInputTick - first.lastInputTick` must be bounded by
// the wall-clock window the two acquisitions were taken in. That claim is false, and it was removed
// rather than loosened: `dwTime` is the tick of the most recent input event, which can have happened
// arbitrarily long before the observation that reports it. Writing `L0` for the input tick visible to
// the first acquisition and `T0` for the moment the window opened, the API guarantees only `L0 <= T1`
// and `L1 <= T2` — never `L0 >= T0`. So `L1 - L0` is bounded by `T2 - T0` only when the first sample
// happens to be an input from inside the window, which nothing makes happen: an idle machine, or a
// test host between interactions, reports an input that predates the window by an unbounded amount.
// A slack constant could not repair that — the premise is wrong, not the threshold — so measuring the
// wall clock around the two calls is not a sound witness for anything, and this test no longer
// measures it.
//
// What the source contract does promise, and what is asserted here, is that every `current()` is its
// own real acquisition returning its own well-formed observation: the acquirer runs a fresh child
// process per call and the plugin builds a new observation from that call's result. A second call
// that resolves is therefore the witness that the acquirer is not one-shot — a property the
// fake-acquirer suite cannot reach, because it never crosses a real process boundary twice.
test(
  'two sequential real acquisitions each produce their own well-formed observation',
  { skip: onWindows ? false : 'requires a win32 host' },
  async (t) => {
    const runtime = new Runtime();
    t.after(() => runtime.shutdown());
    const observed = {};

    await runtime.loadPlugin(inputActivityPlugin);
    await runtime.loadPlugin({
      id: 'test.input-activity-window-repeat',
      version: '1.0.0',
      requires: [inputActivityService],
      setup(context) {
        observed.service = context.services.get(inputActivityService);
      },
    });

    const first = await observed.service.current();
    const second = await observed.service.current();

    for (const observation of [first, second]) {
      assert.deepEqual(Object.keys(observation).sort(), OBSERVATION_KEYS);
      assert.match(observation.observedAt, UTC_TIMESTAMP);
      assert.equal(new Date(observation.observedAt).toISOString(), observation.observedAt);
      assert.equal(observation.source, 'input-activity.windows');

      assertTicksAreWellFormed(observation);
    }

    // The point of the second call is that it resolved at all. Nothing is claimed about how the two
    // ticks relate — see the note before the test — and nothing can be learned from comparing the
    // observation objects either, since each call allocates its own. What the second observation
    // witnesses is that a second real acquisition completed.

    t.diagnostic(`first  ${JSON.stringify(first)}`);
    t.diagnostic(`second ${JSON.stringify(second)}`);
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
