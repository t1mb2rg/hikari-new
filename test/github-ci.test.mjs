import assert from 'node:assert/strict';
import test from 'node:test';

import { Runtime } from '../dist/index.js';
import { GitHubCiError, GitHubCiObservationError, gitHubCiService } from '../dist/github-ci/index.js';

// The single named exception to the "tests import only public entry points" pattern: the acquisition
// seam is internal, and supplying a fake acquirer is the only way to make these tests deterministic
// without a network. The real acquirer is covered in github-ci-github.test.mjs.
import { createGitHubCiPlugin } from '../dist/github-ci/plugin.js';

const OBSERVED_AT = '2026-02-01T08:30:00.000Z';
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const OBSERVATION_KEYS = ['latestRun', 'observedAt', 'repository', 'source'];
const CONFIG = { repository: 't1mb2rg/hikari-new' };

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

function reportedRun(overrides = {}) {
  return {
    kind: 'reported',
    run: {
      id: 8100000001,
      workflow: 'Runtime Tests',
      headBranch: 'main',
      headSha: 'c'.repeat(40),
      status: 'completed',
      conclusion: { kind: 'reported', value: 'success' },
      ...overrides,
    },
  };
}

function acquisition(overrides = {}) {
  return {
    observedAt: OBSERVED_AT,
    repository: 't1mb2rg/hikari-new',
    latestRun: reportedRun(),
    ...overrides,
  };
}

async function observeOnce(t, acquire, config = CONFIG) {
  const { acquirer, counts } = acquirerFrom(acquire);
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  await runtime.loadPlugin(createGitHubCiPlugin(() => acquirer), config);
  const observed = {};
  await runtime.loadPlugin({
    id: 'test.github-ci-observer',
    version: '1.0.0',
    requires: [gitHubCiService],
    setup(context) {
      observed.service = context.services.get(gitHubCiService);
    },
  });

  return { observed, counts, runtime };
}

test('the github ci plugin requires nothing and provides github-ci.current@1', () => {
  const { acquirer } = acquirerFrom(() => acquisition());
  const definition = createGitHubCiPlugin(() => acquirer);

  assert.deepEqual(definition.requires, []);
  assert.deepEqual(definition.provides, [gitHubCiService]);
  assert.equal(gitHubCiService.id, 'github-ci.current');
  assert.equal(gitHubCiService.version, 1);
});

test('an observation reports the four facts and no others, labelled by source', async (t) => {
  const { observed } = await observeOnce(t, () => acquisition());

  const observation = await observed.service.current();

  assert.deepEqual(Object.keys(observation).sort(), OBSERVATION_KEYS);
  assert.equal(observation.source, 'github-ci');
  assert.match(observation.observedAt, UTC_TIMESTAMP);
  assert.equal(observation.repository, 't1mb2rg/hikari-new');
  assert.deepEqual(observation.latestRun, {
    kind: 'reported',
    run: {
      id: 8100000001,
      workflow: 'Runtime Tests',
      headBranch: 'main',
      headSha: 'c'.repeat(40),
      status: 'completed',
      conclusion: { kind: 'reported', value: 'success' },
    },
  });
});

test('the observation and everything reachable inside it is frozen', async (t) => {
  const { observed } = await observeOnce(t, () => acquisition());

  const observation = await observed.service.current();

  assert.ok(Object.isFrozen(observation));
  assert.ok(Object.isFrozen(observation.latestRun));
  assert.ok(Object.isFrozen(observation.latestRun.run));
  assert.ok(Object.isFrozen(observation.latestRun.run.conclusion));
});

test('a repository with no runs is a state of the repository, not a failure to read it', async (t) => {
  const { observed } = await observeOnce(t, () => acquisition({ latestRun: { kind: 'none' } }));

  const observation = await observed.service.current();

  assert.deepEqual(observation.latestRun, { kind: 'none' });
  assert.deepEqual(Object.keys(observation.latestRun), ['kind']);
});

test('a run that has not concluded reports no conclusion, and that is not a failure', async (t) => {
  const { observed } = await observeOnce(t, () =>
    acquisition({ latestRun: reportedRun({ status: 'in_progress', conclusion: { kind: 'absent' } }) }),
  );

  const observation = await observed.service.current();

  assert.equal(observation.latestRun.run.status, 'in_progress');
  assert.deepEqual(observation.latestRun.run.conclusion, { kind: 'absent' });
  assert.deepEqual(Object.keys(observation.latestRun.run.conclusion), ['kind']);
});

test("a run's status and conclusion are GitHub's words, passed through unchanged", async (t) => {
  const { observed } = await observeOnce(t, () =>
    acquisition({ latestRun: reportedRun({ conclusion: { kind: 'reported', value: 'failure' } }) }),
  );

  const observation = await observed.service.current();

  assert.equal(observation.latestRun.run.conclusion.value, 'failure');
});

test('every current() takes a fresh acquisition', async (t) => {
  const { observed, counts } = await observeOnce(t, (nth) =>
    acquisition({
      observedAt: `2026-02-01T08:30:0${nth}.000Z`,
      latestRun: nth === 1 ? { kind: 'none' } : reportedRun(),
    }),
  );

  const first = await observed.service.current();
  const second = await observed.service.current();

  assert.equal(counts.acquisitions, 2);
  assert.notEqual(first, second);
  assert.equal(first.observedAt, '2026-02-01T08:30:01.000Z');
  assert.equal(second.observedAt, '2026-02-01T08:30:02.000Z');
  assert.deepEqual(first.latestRun, { kind: 'none' });
  assert.equal(second.latestRun.kind, 'reported');
});

test('a failed acquisition fails the observation rather than reporting an empty one', async (t) => {
  const { observed } = await observeOnce(t, () => {
    throw new GitHubCiObservationError('the repository could not be read');
  });

  await assert.rejects(observed.service.current(), GitHubCiObservationError);
});

test('unloading the plugin disposes the acquirer exactly once', async (t) => {
  const { counts, runtime } = await observeOnce(t, () => acquisition());

  await runtime.unloadPlugin('github-ci');
  await runtime.unloadPlugin('test.github-ci-observer');

  assert.equal(counts.disposals, 1);
  assert.equal(runtime.getPluginState('github-ci'), undefined);
});

test('a repository reference that is not an owner/name is refused, and no plugin is recorded', async (t) => {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  const configs = [
    undefined,
    null,
    't1mb2rg/hikari-new',
    {},
    { repository: '' },
    { repository: '  ' },
    { repository: 'hikari-new' },
    { repository: 't1mb2rg/' },
    { repository: '/hikari-new' },
    { repository: 't1mb2rg/hikari/new' },
    { repository: 'https://github.com/t1mb2rg/hikari-new' },
    { repository: 't1mb2rg hikari-new' },
    { repository: 7 },
  ];

  for (const config of configs) {
    const { acquirer, counts } = acquirerFrom(() => acquisition());
    await assert.rejects(runtime.loadPlugin(createGitHubCiPlugin(() => acquirer), config), GitHubCiError);
    assert.equal(runtime.getPluginState('github-ci'), undefined, `recorded for ${JSON.stringify(config)}`);
    assert.equal(counts.acquisitions, 0);
  }
});

test('the configured reference is the one the acquirer is built for, split into owner and name', async (t) => {
  const seen = [];
  const { acquirer } = acquirerFrom(() => acquisition());
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  await runtime.loadPlugin(
    createGitHubCiPlugin((reference) => {
      seen.push(reference);
      return acquirer;
    }),
    { repository: 'Some-Owner/some.repo_name' },
  );

  assert.deepEqual(seen, [{ owner: 'Some-Owner', name: 'some.repo_name' }]);
});

test('loading the plugin observes nothing; only a caller does', async (t) => {
  const { observed, counts } = await observeOnce(t, () => acquisition());

  // Loading built the acquirer and published the capability. It did not spend a request: nothing
  // here runs on a timer, and nothing observes until somebody asks.
  assert.equal(counts.acquisitions, 0);

  await observed.service.current();
  assert.equal(counts.acquisitions, 1);

  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(counts.acquisitions, 1);
});
