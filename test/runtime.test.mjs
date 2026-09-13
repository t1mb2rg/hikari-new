import assert from 'node:assert/strict';
import test from 'node:test';

import {
  Runtime,
  defineEvent,
  defineService,
  UndeclaredServiceDependencyError,
} from '../dist/index.js';

test('plugin lifecycle owns and cleans resources', async () => {
  const runtime = new Runtime();
  let cleaned = 0;

  await runtime.loadPlugin({
    id: 'test.resource',
    version: '1.0.0',
    setup(ctx) {
      ctx.defer(() => {
        cleaned += 1;
      });
    },
  });

  assert.equal(runtime.getPluginState('test.resource'), 'active');
  await runtime.unloadPlugin('test.resource');
  assert.equal(cleaned, 1);
  assert.equal(runtime.getPluginState('test.resource'), undefined);
});

test('consumer waits for required service, receives returned data, and reactivates after provider recovery', async () => {
  const runtime = new Runtime();
  const echo = defineService('test.echo');
  const observed = [];
  let consumerStarts = 0;
  let consumerStops = 0;

  const consumer = {
    id: 'test.consumer',
    version: '1.0.0',
    requires: [echo],
    setup(ctx) {
      consumerStarts += 1;
      observed.push(ctx.services.get(echo).echo('hikari'));
      ctx.defer(() => {
        consumerStops += 1;
      });
    },
  };

  const provider = {
    id: 'test.provider',
    version: '1.0.0',
    provides: [echo],
    setup(ctx) {
      ctx.services.provide(echo, {
        echo(value) {
          return `echo:${value}`;
        },
      });
    },
  };

  await runtime.loadPlugin(consumer);
  assert.equal(runtime.getPluginState('test.consumer'), 'waiting');

  await runtime.loadPlugin(provider);
  assert.equal(runtime.getPluginState('test.provider'), 'active');
  assert.equal(runtime.getPluginState('test.consumer'), 'active');
  assert.deepEqual(observed, ['echo:hikari']);

  await runtime.unloadPlugin('test.provider');
  assert.equal(runtime.getPluginState('test.consumer'), 'waiting');
  assert.equal(consumerStops, 1);

  await runtime.loadPlugin(provider);
  assert.equal(runtime.getPluginState('test.consumer'), 'active');
  assert.equal(consumerStarts, 2);
  assert.deepEqual(observed, ['echo:hikari', 'echo:hikari']);
});

test('events notify multiple subscribers and subscriptions disappear with plugin lifecycle', async () => {
  const runtime = new Runtime();
  const changed = defineEvent('test.changed');
  const calls = [];

  const listenerA = {
    id: 'listener.a',
    version: '1.0.0',
    setup(ctx) {
      ctx.events.on(changed, (payload) => calls.push(`a:${payload}`));
    },
  };
  const listenerB = {
    id: 'listener.b',
    version: '1.0.0',
    setup(ctx) {
      ctx.events.on(changed, (payload) => calls.push(`b:${payload}`));
    },
  };
  let emit;
  const emitter = {
    id: 'emitter',
    version: '1.0.0',
    setup(ctx) {
      emit = (payload) => ctx.events.emit(changed, payload);
    },
  };

  await runtime.loadPlugin(listenerA);
  await runtime.loadPlugin(listenerB);
  await runtime.loadPlugin(emitter);

  await emit('one');
  assert.deepEqual(calls.sort(), ['a:one', 'b:one']);

  await runtime.unloadPlugin('listener.a');
  await emit('two');
  assert.deepEqual(calls.sort(), ['a:one', 'b:one', 'b:two']);
});

test('runtime rejects hidden service dependencies', async () => {
  const runtime = new Runtime();
  const service = defineService('test.hidden');

  await runtime.loadPlugin({
    id: 'hidden.provider',
    version: '1.0.0',
    provides: [service],
    setup(ctx) {
      ctx.services.provide(service, { value: 42 });
    },
  });

  await runtime.loadPlugin({
    id: 'hidden.consumer',
    version: '1.0.0',
    setup(ctx) {
      ctx.services.get(service);
    },
  });

  assert.equal(runtime.getPluginState('hidden.consumer'), 'failed');
  assert.ok(runtime.getPluginError('hidden.consumer') instanceof UndeclaredServiceDependencyError);
});

test('runtime does not need to know service business semantics', async () => {
  const runtime = new Runtime();
  const arithmetic = defineService('example.arithmetic');
  let result;

  await runtime.loadPlugin({
    id: 'arithmetic.provider',
    version: '1.0.0',
    provides: [arithmetic],
    setup(ctx) {
      ctx.services.provide(arithmetic, {
        add(a, b) {
          return a + b;
        },
      });
    },
  });

  await runtime.loadPlugin({
    id: 'arithmetic.consumer',
    version: '1.0.0',
    requires: [arithmetic],
    setup(ctx) {
      result = ctx.services.get(arithmetic).add(20, 22);
    },
  });

  assert.equal(result, 42);
});
