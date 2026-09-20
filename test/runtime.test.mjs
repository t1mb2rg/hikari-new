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

test('plugin config is validated before startup and parsed value is passed to setup', async () => {
  const runtime = new Runtime();
  let received;

  const plugin = {
    id: 'config.consumer',
    version: '1.0.0',
    config: {
      parse(input) {
        if (!input || typeof input !== 'object' || typeof input.name !== 'string') {
          throw new Error('invalid config');
        }
        return { name: input.name.trim() };
      },
    },
    setup(_ctx, config) {
      received = config;
    },
  };

  await runtime.loadPlugin(plugin, { name: ' hikari ' });
  assert.deepEqual(received, { name: 'hikari' });

  const invalidRuntime = new Runtime();
  await assert.rejects(() => invalidRuntime.loadPlugin(plugin, {}), /invalid config/);
  assert.equal(invalidRuntime.getPluginState('config.consumer'), undefined);
});

// A setup that has not returned yet is an activation in flight, and an unload arriving
// during one used to delete the record underneath it: setup went on opening resources, the
// deferred cleanup could no longer be registered because the scope was already disposed,
// and the promise `loadPlugin` handed back resolved with a state for a plugin the Runtime
// had already forgotten. The setup is parked on a gate in both of these so the race is
// forced rather than hoped for.
test('an unload that races an in-flight setup does not leave the activation running', async () => {
  const runtime = new Runtime();
  const opened = [];
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  const plugin = {
    id: 'test.in-flight-setup',
    version: '1.0.0',
    async setup(ctx) {
      await gate;
      // Opened only after the unload has already been asked for.
      const resource = { open: true };
      opened.push(resource);
      ctx.defer(() => {
        resource.open = false;
      });
    },
  };

  const loading = runtime.loadPlugin(plugin);
  assert.equal(runtime.getPluginState(plugin.id), 'starting');

  const unloading = runtime.unloadPlugin(plugin.id);
  release();

  // The load reports the state the record reached. `active` would mean this call had
  // reported an activation the unload had already taken away.
  assert.equal(await loading, 'waiting');

  await unloading;

  // Nothing this activation opened outlived the unload it raced...
  assert.deepEqual(
    opened.map((resource) => resource.open),
    [false],
  );
  // ...and no record is left behind for a plugin the Runtime has unloaded.
  assert.equal(runtime.getPluginState(plugin.id), undefined);
  assert.equal(runtime.getPluginError(plugin.id), undefined);
});

test('an unload that races an in-flight setup also runs the cleanup setup returns', async () => {
  const runtime = new Runtime();
  let released = false;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  const plugin = {
    id: 'test.in-flight-returned-cleanup',
    version: '1.0.0',
    async setup() {
      await gate;
      return () => {
        released = true;
      };
    },
  };

  const loading = runtime.loadPlugin(plugin);
  const unloading = runtime.unloadPlugin(plugin.id);
  release();

  assert.equal(await loading, 'waiting');
  await unloading;

  assert.equal(released, true);
  assert.equal(runtime.getPluginState(plugin.id), undefined);
});

test('an unload does not report completion before a setup it raced has released its resources', async () => {
  const runtime = new Runtime();
  let open = false;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  const plugin = {
    id: 'test.unload-waits-for-setup',
    version: '1.0.0',
    async setup(ctx) {
      await gate;
      open = true;
      ctx.defer(() => {
        open = false;
      });
    },
  };

  const loading = runtime.loadPlugin(plugin);
  const unloading = runtime.unloadPlugin(plugin.id);
  release();
  await unloading;

  assert.equal(open, false);
  assert.equal(runtime.getPluginState(plugin.id), undefined);

  await loading;
});

test('an unload that races a setup which then rejects releases what it opened and leaves no record', async () => {
  const runtime = new Runtime();
  let open = false;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  const plugin = {
    id: 'test.in-flight-setup-rejects',
    version: '1.0.0',
    async setup(ctx) {
      await gate;
      open = true;
      ctx.defer(() => {
        open = false;
      });
      throw new Error('setup exploded');
    },
  };

  const loading = runtime.loadPlugin(plugin);
  assert.equal(runtime.getPluginState(plugin.id), 'starting');

  const unloading = runtime.unloadPlugin(plugin.id);
  release();

  // The setup threw, and that is the activation's own outcome: the record having been claimed by
  // an unload does not launder a failure away from the caller who asked for the plugin. What the
  // unload does take away is the record itself, so the error is no longer readable afterwards —
  // which is why the failure has to be reported here, at the moment it is known.
  assert.equal(await loading, 'failed');

  await unloading;

  // The deferred cleanup ran even though the record was already claimed: the scope is disposed on
  // the failure path, not left to the unload that could not touch it while setup was running.
  assert.equal(open, false);
  // ...and the unload took the record, so neither state nor error survives it.
  assert.equal(runtime.getPluginState(plugin.id), undefined);
  assert.equal(runtime.getPluginError(plugin.id), undefined);
});

test('a plugin unloaded while its setup was in flight starts from scratch when loaded again', async () => {
  const runtime = new Runtime();
  let started = 0;
  let first = true;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  const plugin = {
    id: 'test.reload-after-race',
    version: '1.0.0',
    async setup() {
      started += 1;
      if (first) {
        first = false;
        await gate;
      }
    },
  };

  const loading = runtime.loadPlugin(plugin);
  const unloading = runtime.unloadPlugin(plugin.id);
  release();

  await loading;
  await unloading;
  assert.equal(runtime.getPluginState(plugin.id), undefined);

  // Nothing from the unloaded activation survives into the next one: a record claimed by an
  // unload must not be left in a state that quietly refuses to start it ever again.
  await runtime.loadPlugin(plugin);
  assert.equal(runtime.getPluginState(plugin.id), 'active');
  assert.equal(started, 2);
});
