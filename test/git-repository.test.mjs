import assert from 'node:assert/strict';
import test from 'node:test';

import { Runtime } from '../dist/index.js';
import {
  GitRepositoryError,
  GitRepositoryObservationError,
  gitRepositoryService,
} from '../dist/git-repository/index.js';

// The single named exception to the "tests import only public entry points" pattern: the acquisition
// seam is internal, and supplying a fake acquirer is the only way to make these tests deterministic
// without a repository on disk. The real CLI is covered in git-repository-git.test.mjs.
import { createGitRepositoryPlugin } from '../dist/git-repository/plugin.js';

const OBSERVED_AT = '2026-02-01T08:30:00.000Z';
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const OBSERVATION_KEYS = ['head', 'observedAt', 'remotes', 'source', 'workTree', 'workTreeRoot'];
const CONFIG = { repositoryRoot: '/somewhere/observed' };

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

function acquisition(overrides = {}) {
  return {
    observedAt: OBSERVED_AT,
    workTreeRoot: '/somewhere/observed',
    head: { kind: 'branch', name: 'main', commit: 'a'.repeat(40) },
    workTree: { kind: 'unchanged' },
    remotes: [],
    ...overrides,
  };
}

async function observeOnce(t, acquire, config = CONFIG) {
  const { acquirer, counts } = acquirerFrom(acquire);
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  await runtime.loadPlugin(createGitRepositoryPlugin(() => acquirer), config);
  const observed = {};
  await runtime.loadPlugin({
    id: 'test.git-repository-observer',
    version: '1.0.0',
    requires: [gitRepositoryService],
    setup(context) {
      observed.service = context.services.get(gitRepositoryService);
    },
  });

  return { observed, counts, runtime };
}

test('the git repository plugin requires nothing and provides git-repository.current@1', () => {
  const { acquirer } = acquirerFrom(() => acquisition());
  const definition = createGitRepositoryPlugin(() => acquirer);

  assert.deepEqual(definition.requires, []);
  assert.deepEqual(definition.provides, [gitRepositoryService]);
  assert.equal(gitRepositoryService.id, 'git-repository.current');
  assert.equal(gitRepositoryService.version, 1);
});

test('an observation reports the six facts and no others, labelled by source', async (t) => {
  const { observed } = await observeOnce(t, () => acquisition());

  const observation = await observed.service.current();

  assert.deepEqual(Object.keys(observation).sort(), OBSERVATION_KEYS);
  assert.equal(observation.source, 'git-repository');
  assert.match(observation.observedAt, UTC_TIMESTAMP);
  assert.deepEqual(observation.head, {
    kind: 'branch',
    name: 'main',
    commit: 'a'.repeat(40),
  });
  assert.deepEqual(observation.workTree, { kind: 'unchanged' });
  assert.deepEqual(observation.remotes, []);
  assert.equal(observation.workTreeRoot, '/somewhere/observed');
});

test('the observation and everything reachable inside it is frozen', async (t) => {
  const { observed } = await observeOnce(t, () =>
    acquisition({ head: { kind: 'detached', commit: 'b'.repeat(40) }, remotes: ['upstream'] }),
  );

  const observation = await observed.service.current();

  assert.ok(Object.isFrozen(observation));
  assert.ok(Object.isFrozen(observation.head));
  assert.ok(Object.isFrozen(observation.workTree));
  assert.ok(Object.isFrozen(observation.remotes));
});

test('a missing remote is a legal state and not an absence of information', async (t) => {
  const { observed } = await observeOnce(t, () => acquisition({ remotes: [] }));

  const observation = await observed.service.current();

  assert.deepEqual(observation.remotes, []);
});

test('an unborn head is a state of the repository, not a failure to read it', async (t) => {
  const { observed } = await observeOnce(t, () => acquisition({ head: { kind: 'unborn' } }));

  const observation = await observed.service.current();

  assert.deepEqual(observation.head, { kind: 'unborn' });
  assert.deepEqual(Object.keys(observation.head), ['kind']);
});

test('every current() takes a fresh acquisition', async (t) => {
  const { observed, counts } = await observeOnce(t, (nth) =>
    acquisition({
      observedAt: `2026-02-01T08:30:0${nth}.000Z`,
      workTree: nth === 1 ? { kind: 'unchanged' } : { kind: 'changed' },
    }),
  );

  const first = await observed.service.current();
  const second = await observed.service.current();

  assert.equal(counts.acquisitions, 2);
  assert.notEqual(first, second);
  assert.equal(first.observedAt, '2026-02-01T08:30:01.000Z');
  assert.equal(second.observedAt, '2026-02-01T08:30:02.000Z');
  assert.deepEqual(first.workTree, { kind: 'unchanged' });
  assert.deepEqual(second.workTree, { kind: 'changed' });
});

test('a failed acquisition fails the observation rather than reporting an empty one', async (t) => {
  const { observed } = await observeOnce(t, () => {
    throw new GitRepositoryObservationError('the repository could not be read');
  });

  await assert.rejects(observed.service.current(), GitRepositoryObservationError);
});

test('unloading the plugin disposes the acquirer exactly once', async (t) => {
  const { counts, runtime } = await observeOnce(t, () => acquisition());

  await runtime.unloadPlugin('git-repository');
  await runtime.unloadPlugin('test.git-repository-observer');

  assert.equal(counts.disposals, 1);
  assert.equal(runtime.getPluginState('git-repository'), undefined);
});

test('a repository root that is not a non-empty string is refused, and no plugin is recorded', async (t) => {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  for (const config of [undefined, null, 'somewhere', {}, { repositoryRoot: '' }, { repositoryRoot: '  ' }, { repositoryRoot: 7 }]) {
    const { acquirer, counts } = acquirerFrom(() => acquisition());
    await assert.rejects(runtime.loadPlugin(createGitRepositoryPlugin(() => acquirer), config), GitRepositoryError);
    assert.equal(runtime.getPluginState('git-repository'), undefined, `recorded for ${JSON.stringify(config)}`);
    assert.equal(counts.acquisitions, 0);
  }
});

test('the configured repository root is the one the acquirer is built for', async (t) => {
  const seen = [];
  const { acquirer } = acquirerFrom(() => acquisition());
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  await runtime.loadPlugin(
    createGitRepositoryPlugin((repositoryRoot) => {
      seen.push(repositoryRoot);
      return acquirer;
    }),
    { repositoryRoot: '/somewhere/else' },
  );

  assert.deepEqual(seen, ['/somewhere/else']);
});

test('loading the plugin observes nothing; only a caller does', async (t) => {
  const { observed, counts } = await observeOnce(t, () => acquisition());

  // Loading built the acquirer and published the capability. It did not look at the repository:
  // nothing here runs on a timer, and nothing observes until somebody asks.
  assert.equal(counts.acquisitions, 0);

  await observed.service.current();
  assert.equal(counts.acquisitions, 1);

  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(counts.acquisitions, 1);
});
