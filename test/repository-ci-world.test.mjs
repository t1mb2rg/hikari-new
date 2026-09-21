import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

import { Runtime } from '../dist/index.js';
import { GitHubCiObservationError, gitHubCiService } from '../dist/github-ci/index.js';
import { GitRepositoryObservationError, gitRepositoryService } from '../dist/git-repository/index.js';
import {
  repositoryCiWorldPlugin,
  repositoryCiWorldService,
} from '../dist/repository-ci-world/index.js';

const OBSERVED_AT = '2026-02-01T08:30:00.000Z';
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const GIT_REPOSITORY_PROVIDER = 'test.git-repository-provider';
const GITHUB_CI_PROVIDER = 'test.github-ci-provider';
const OBSERVER = 'test.repository-ci-world-observer';

// Two commits that are deliberately different: no test needs the two fixtures to agree on a commit,
// and having them disagree by default means every test below is also a case of a world that composed
// two observations without checking them against each other.
const LOCAL_COMMIT = 'a'.repeat(40);
const REMOTE_COMMIT = 'b'.repeat(40);

// No injection seam: the tests supply fake *providers* as ordinary plugins and let the real Runtime
// dependency graph decide who is active. The World plugin under test is the production one.
function provider(pluginId, contract, behaviour) {
  const counts = { calls: 0 };
  const definition = {
    id: pluginId,
    version: '1.0.0',
    provides: [contract],
    setup(context) {
      context.services.provide(
        contract,
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

function gitRepositoryProvider(behaviour) {
  return provider(GIT_REPOSITORY_PROVIDER, gitRepositoryService, behaviour);
}

function gitHubCiProvider(behaviour) {
  return provider(GITHUB_CI_PROVIDER, gitHubCiService, behaviour);
}

function gitRepositoryObservation(overrides = {}) {
  const { commit = LOCAL_COMMIT, ...rest } = overrides;
  return Object.freeze({
    observedAt: OBSERVED_AT,
    source: 'git-repository',
    workTreeRoot: 'G:/work/LAB/code/hikari-new',
    head: { kind: 'branch', name: 'main', commit },
    workTree: { kind: 'unchanged' },
    remotes: ['origin'],
    ...rest,
  });
}

function reportedRun(headSha) {
  return {
    kind: 'reported',
    run: {
      id: 8100000001,
      workflow: 'Runtime Tests',
      headBranch: 'main',
      headSha,
      status: 'completed',
      conclusion: { kind: 'reported', value: 'success' },
    },
  };
}

function gitHubCiObservation(overrides = {}) {
  const { headSha = REMOTE_COMMIT, ...rest } = overrides;
  return Object.freeze({
    observedAt: OBSERVED_AT,
    source: 'github-ci',
    repository: 't1mb2rg/hikari-new',
    latestRun: reportedRun(headSha),
    ...rest,
  });
}

function observerDefinition(observed) {
  return {
    id: OBSERVER,
    version: '1.0.0',
    requires: [repositoryCiWorldService],
    setup(context) {
      observed.service = context.services.get(repositoryCiWorldService);
    },
  };
}

async function loadAll(runtime, gitRepository, githubCi) {
  const observed = {};
  await runtime.loadPlugin(gitRepository.definition);
  await runtime.loadPlugin(githubCi.definition);
  await runtime.loadPlugin(repositoryCiWorldPlugin);
  await runtime.loadPlugin(observerDefinition(observed));
  return observed;
}

async function runningWorld(t, gitRepository, githubCi) {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());
  const observed = await loadAll(runtime, gitRepository, githubCi);
  return { runtime, observed };
}

function succeeding(commit = LOCAL_COMMIT, headSha = REMOTE_COMMIT) {
  return [
    gitRepositoryProvider(() => Promise.resolve(gitRepositoryObservation({ commit }))),
    gitHubCiProvider(() => Promise.resolve(gitHubCiObservation({ headSha }))),
  ];
}

// Yields one whole event-loop turn, which drains every pending microtask. A macrotask boundary is
// deterministic — unlike a sleep, it proves the pending work is finished rather than that it
// probably had enough time.
function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

// Returns once the wall clock has left the millisecond it was called in, and hands back the new
// reading. This waits on the clock itself rather than on a guessed duration, so the returned value
// is provably greater than any timestamp taken before the call. It exists because the whole world
// snapshot runs in well under a millisecond: without crossing a millisecond boundary, a stamp taken
// before the sources settle and one taken after are indistinguishable.
async function nextMillisecond() {
  const started = Date.now();
  let current = started;
  while (current === started) {
    await nextTurn();
    current = Date.now();
  }
  return current;
}

test('the world plugin requires exactly the two perception capabilities and provides its own', async (t) => {
  assert.deepEqual(repositoryCiWorldPlugin.requires, [gitRepositoryService, gitHubCiService]);
  assert.deepEqual(repositoryCiWorldPlugin.provides, [repositoryCiWorldService]);
  assert.equal(repositoryCiWorldPlugin.id, 'repository-ci-world');
  assert.equal(repositoryCiWorldPlugin.version, '1.0.0');
  assert.equal(repositoryCiWorldService.id, 'repository-ci-world.current');
  assert.equal(repositoryCiWorldService.version, 1);

  // Unlike both of its sources, the World takes no configuration. The values that establish the
  // scope are the sources' own; a World that accepted them would be able to compare them.
  assert.equal(repositoryCiWorldPlugin.config, undefined);

  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  assert.equal(await runtime.loadPlugin(repositoryCiWorldPlugin), 'waiting');
});

test('the world service is reachable through the plugin dependency graph', async (t) => {
  const [gitRepository, githubCi] = succeeding();
  const { runtime, observed } = await runningWorld(t, gitRepository, githubCi);

  assert.equal(runtime.getPluginState('repository-ci-world'), 'active');
  assert.equal(runtime.getPluginState(OBSERVER), 'active');
  assert.deepEqual(Object.keys(observed.service), ['current']);
});

test('the world waits for both capabilities and activates only when the second one arrives', async (t) => {
  const [gitRepository, githubCi] = succeeding();
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  await runtime.loadPlugin(repositoryCiWorldPlugin);
  assert.equal(runtime.getPluginState('repository-ci-world'), 'waiting');

  await runtime.loadPlugin(gitRepository.definition);
  assert.equal(runtime.getPluginState('repository-ci-world'), 'waiting');

  await runtime.loadPlugin(githubCi.definition);
  assert.equal(runtime.getPluginState('repository-ci-world'), 'active');
});

test('the world returns to waiting when a required provider disappears and activates again when it returns', async (t) => {
  const [gitRepository, githubCi] = succeeding();
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  await runtime.loadPlugin(gitRepository.definition);
  await runtime.loadPlugin(githubCi.definition);
  await runtime.loadPlugin(repositoryCiWorldPlugin);
  assert.equal(runtime.getPluginState('repository-ci-world'), 'active');

  await runtime.unloadPlugin(GITHUB_CI_PROVIDER);
  assert.equal(runtime.getPluginState('repository-ci-world'), 'waiting');

  await runtime.loadPlugin(githubCi.definition);
  assert.equal(runtime.getPluginState('repository-ci-world'), 'active');
});

test('a successful snapshot carries both source observations unchanged', async (t) => {
  const gitRepositoryValue = gitRepositoryObservation({ commit: LOCAL_COMMIT });
  const gitHubCiValue = gitHubCiObservation({ headSha: REMOTE_COMMIT });
  const { observed } = await runningWorld(
    t,
    gitRepositoryProvider(() => Promise.resolve(gitRepositoryValue)),
    gitHubCiProvider(() => Promise.resolve(gitHubCiValue)),
  );

  const result = await observed.service.current();

  assert.equal(result.gitRepository.kind, 'available');
  assert.equal(result.githubCi.kind, 'available');

  // Reference identity, not deep equality: the World composes the observations it was handed and
  // never rebuilds them.
  assert.equal(result.gitRepository.observation, gitRepositoryValue);
  assert.equal(result.githubCi.observation, gitHubCiValue);

  assert.equal(result.gitRepository.observation.source, 'git-repository');
  assert.equal(result.githubCi.observation.source, 'github-ci');
  assert.equal(result.gitRepository.observation.observedAt, OBSERVED_AT);
  assert.equal(result.githubCi.observation.observedAt, OBSERVED_AT);

  // The sources' timestamps are historical, so anything the World re-stamped would be visible here.
  assert.ok(Math.abs(Date.now() - Date.parse(OBSERVED_AT)) > 60_000);
});

test('the snapshot holds the two facets and no fact of the world own', async (t) => {
  const [gitRepository, githubCi] = succeeding();
  const { observed } = await runningWorld(t, gitRepository, githubCi);

  const result = await observed.service.current();

  // Nothing naming the repository, its root, its owner, or a commit stands beside the two facets. A
  // reader gets what each source said and the moment they were put together, and that is all.
  assert.deepEqual(Object.keys(result).sort(), ['gitRepository', 'githubCi', 'snapshotAt']);
  assert.deepEqual(Object.keys(result.gitRepository).sort(), ['kind', 'observation']);
  assert.deepEqual(Object.keys(result.githubCi).sort(), ['kind', 'observation']);
});

test('snapshotAt is a world timestamp produced after both facets settle', async (t) => {
  let releaseGitHubCi;
  const gitHubCiGate = new Promise((resolve) => {
    releaseGitHubCi = resolve;
  });
  let finalSettlementAt = 0;

  const { observed } = await runningWorld(
    t,
    gitRepositoryProvider(() => Promise.resolve(gitRepositoryObservation())),
    gitHubCiProvider(() =>
      gitHubCiGate.then(() => {
        finalSettlementAt = Date.now();
        return gitHubCiObservation();
      }),
    ),
  );

  const before = Date.now();
  const pending = observed.service.current();

  await nextTurn();
  assert.equal(finalSettlementAt, 0, 'the gated source settled before it was released');

  // Cross a millisecond boundary while the last source is still held open. Anything stamped before
  // the sources settle now lands in a strictly earlier millisecond than anything stamped after.
  const boundary = await nextMillisecond();
  assert.ok(boundary > before, 'the clock never advanced, so this test could not discriminate');

  releaseGitHubCi();
  const result = await pending;

  assert.match(result.snapshotAt, UTC_TIMESTAMP);
  assert.notEqual(result.snapshotAt, OBSERVED_AT);
  assert.ok(finalSettlementAt > 0, 'the gated source never settled');
  assert.ok(Date.parse(result.snapshotAt) >= before, 'snapshotAt predates the call');
  assert.ok(
    Date.parse(result.snapshotAt) >= boundary,
    `snapshotAt ${result.snapshotAt} was taken before the last source settled at ${finalSettlementAt}`,
  );
});

test('the snapshot and both facet wrappers are frozen', async (t) => {
  const [availableGitRepository, availableGitHubCi] = succeeding();
  const available = await runningWorld(t, availableGitRepository, availableGitHubCi);
  const availableResult = await available.observed.service.current();

  assert.equal(Object.isFrozen(availableResult), true);
  assert.equal(Object.isFrozen(availableResult.gitRepository), true);
  assert.equal(Object.isFrozen(availableResult.githubCi), true);

  const { observed } = await runningWorld(
    t,
    gitRepositoryProvider(() => Promise.reject(new GitRepositoryObservationError('exited with code 1'))),
    gitHubCiProvider(() => Promise.reject(new GitHubCiObservationError('the request failed'))),
  );
  const unavailableResult = await observed.service.current();

  assert.equal(Object.isFrozen(unavailableResult), true);
  assert.equal(Object.isFrozen(unavailableResult.gitRepository), true);
  assert.equal(Object.isFrozen(unavailableResult.githubCi), true);
});

test('every current() call performs a fresh acquisition of both facets', async (t) => {
  const { observed } = await runningWorld(
    t,
    gitRepositoryProvider((nth) =>
      Promise.resolve(gitRepositoryObservation({ commit: String(nth).repeat(40) })),
    ),
    gitHubCiProvider((nth) => Promise.resolve(gitHubCiObservation({ headSha: String(nth).repeat(40) }))),
  );

  const first = await observed.service.current();
  const second = await observed.service.current();

  assert.equal(first.gitRepository.observation.head.commit, '1'.repeat(40));
  assert.equal(second.gitRepository.observation.head.commit, '2'.repeat(40));
  assert.equal(first.githubCi.observation.latestRun.run.headSha, '1'.repeat(40));
  assert.equal(second.githubCi.observation.latestRun.run.headSha, '2'.repeat(40));
  assert.notEqual(first, second);
});

test('a git repository failure makes only the git repository facet unavailable', async (t) => {
  const { observed } = await runningWorld(
    t,
    gitRepositoryProvider(() =>
      Promise.reject(new GitRepositoryObservationError('not a git repository')),
    ),
    gitHubCiProvider(() => Promise.resolve(gitHubCiObservation())),
  );

  const result = await observed.service.current();

  assert.equal(result.gitRepository.kind, 'unavailable');
  assert.deepEqual(Object.keys(result.gitRepository), ['kind']);
  assert.equal(result.githubCi.kind, 'available');
  assert.equal(result.githubCi.observation.repository, 't1mb2rg/hikari-new');
});

test('a github ci failure makes only the github ci facet unavailable', async (t) => {
  const { observed } = await runningWorld(
    t,
    gitRepositoryProvider(() => Promise.resolve(gitRepositoryObservation())),
    gitHubCiProvider(() =>
      Promise.reject(new GitHubCiObservationError('the request did not finish in time')),
    ),
  );

  const result = await observed.service.current();

  assert.equal(result.gitRepository.kind, 'available');
  assert.equal(result.gitRepository.observation.head.commit, LOCAL_COMMIT);
  assert.equal(result.githubCi.kind, 'unavailable');
  assert.deepEqual(Object.keys(result.githubCi), ['kind']);
});

test('both sources failing still resolves with both facets unavailable', async (t) => {
  const { observed } = await runningWorld(
    t,
    gitRepositoryProvider(() => Promise.reject(new GitRepositoryObservationError('exited with code 1'))),
    gitHubCiProvider(() => Promise.reject(new GitHubCiObservationError('the request failed'))),
  );

  const settled = await observed.service.current().then(
    (result) => ({ outcome: 'resolved', result }),
    (error) => ({ outcome: 'rejected', error }),
  );

  assert.equal(settled.outcome, 'resolved');
  assert.equal(settled.result.gitRepository.kind, 'unavailable');
  assert.equal(settled.result.githubCi.kind, 'unavailable');
  assert.match(settled.result.snapshotAt, UTC_TIMESTAMP);
});

test('a source that throws synchronously is recorded as unavailability, never classified', async (t) => {
  const { observed } = await runningWorld(
    t,
    gitRepositoryProvider(() => {
      throw new Error('something nobody modelled yet');
    }),
    gitHubCiProvider(() => Promise.resolve(gitHubCiObservation())),
  );

  const result = await observed.service.current();

  // The World reads the settlement status and nothing else, so an unmodelled throw lands in exactly
  // the same place a typed observation error would.
  assert.equal(result.gitRepository.kind, 'unavailable');
  assert.equal(result.githubCi.kind, 'available');
  assert.equal(result.githubCi.observation.repository, 't1mb2rg/hikari-new');
});

test('a successfully observed unborn head and a runless repository both stay available', async (t) => {
  const [gitRepository, githubCi] = succeeding();
  const { observed } = await runningWorld(t, gitRepository, githubCi);

  const result = await observed.service.current();
  assert.equal(result.gitRepository.observation.head.kind, 'branch');

  const { observed: observedAbsent } = await runningWorld(
    t,
    gitRepositoryProvider(() =>
      Promise.resolve(gitRepositoryObservation({ head: { kind: 'unborn' } })),
    ),
    gitHubCiProvider(() =>
      Promise.resolve(gitHubCiObservation({ latestRun: { kind: 'none' } })),
    ),
  );

  const absent = await observedAbsent.service.current();

  // Observed absence and failure-to-observe are different facts and must never collapse into one.
  assert.equal(absent.gitRepository.kind, 'available');
  assert.deepEqual(absent.gitRepository.observation.head, { kind: 'unborn' });
  assert.equal(absent.githubCi.kind, 'available');
  assert.deepEqual(absent.githubCi.observation.latestRun, { kind: 'none' });
});

test('the world records neither agreement nor disagreement between the two sources', async (t) => {
  const [agreeingGitRepository, agreeingGitHubCi] = succeeding(REMOTE_COMMIT, REMOTE_COMMIT);
  const agreeing = await runningWorld(t, agreeingGitRepository, agreeingGitHubCi);
  const agreeingResult = await agreeing.observed.service.current();

  const [disagreeingGitRepository, disagreeingGitHubCi] = succeeding(LOCAL_COMMIT, REMOTE_COMMIT);
  const disagreeing = await runningWorld(t, disagreeingGitRepository, disagreeingGitHubCi);
  const disagreeingResult = await disagreeing.observed.service.current();

  // The two inputs really did differ.
  assert.equal(agreeingResult.githubCi.observation.latestRun.run.headSha, REMOTE_COMMIT);
  assert.equal(disagreeingResult.githubCi.observation.latestRun.run.headSha, REMOTE_COMMIT);
  assert.equal(disagreeingResult.gitRepository.observation.head.commit, LOCAL_COMMIT);
  assert.notEqual(
    disagreeingResult.gitRepository.observation.head.commit,
    disagreeingResult.githubCi.observation.latestRun.run.headSha,
  );

  // Whether the two agree is visible to a reader of both observations and is not a fact this layer
  // produces. A snapshot that grew a field, or that lost a facet, when the commits matched would be
  // the World reaching the conclusion it exists to leave unstated.
  assert.deepEqual(Object.keys(agreeingResult).sort(), Object.keys(disagreeingResult).sort());
  assert.deepEqual(
    Object.keys(agreeingResult.gitRepository).sort(),
    Object.keys(disagreeingResult.gitRepository).sort(),
  );
  assert.deepEqual(
    Object.keys(agreeingResult.githubCi).sort(),
    Object.keys(disagreeingResult.githubCi).sort(),
  );
  assert.equal(agreeingResult.gitRepository.kind, 'available');
  assert.equal(agreeingResult.githubCi.kind, 'available');
  assert.equal(disagreeingResult.gitRepository.kind, 'available');
  assert.equal(disagreeingResult.githubCi.kind, 'available');
});

test('both perceptions are started before either one settles', async (t) => {
  let releaseGitRepository;
  const gitRepositoryGate = new Promise((resolve) => {
    releaseGitRepository = resolve;
  });

  const gitRepository = gitRepositoryProvider(() =>
    gitRepositoryGate.then(() => gitRepositoryObservation()),
  );
  const githubCi = gitHubCiProvider(() => Promise.resolve(gitHubCiObservation()));
  const { observed } = await runningWorld(t, gitRepository, githubCi);

  let settled = false;
  const pending = observed.service.current().then((result) => {
    settled = true;
    return result;
  });

  await nextTurn();

  assert.equal(gitRepository.counts.calls, 1);
  assert.equal(
    githubCi.counts.calls,
    1,
    'the second perception was not started before the first one settled',
  );
  assert.equal(settled, false, 'the snapshot resolved while a source was still pending');

  releaseGitRepository();
  const result = await pending;

  assert.equal(result.gitRepository.kind, 'available');
  assert.equal(result.githubCi.kind, 'available');
  assert.equal(gitRepository.counts.calls, 1);
  assert.equal(githubCi.counts.calls, 1);
});

test('the world performs no observation at setup, while idle, or at shutdown', async (t) => {
  const [gitRepository, githubCi] = succeeding();
  const runtime = new Runtime();

  const observed = await loadAll(runtime, gitRepository, githubCi);

  assert.equal(runtime.getPluginState('repository-ci-world'), 'active');
  assert.equal(typeof observed.service.current, 'function');
  assert.equal(gitRepository.counts.calls, 0);
  assert.equal(githubCi.counts.calls, 0);

  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(gitRepository.counts.calls, 0);
  assert.equal(githubCi.counts.calls, 0);

  await runtime.shutdown();
  assert.equal(gitRepository.counts.calls, 0);
  assert.equal(githubCi.counts.calls, 0);
  assert.equal(runtime.getPluginState('repository-ci-world'), undefined);
});

test('the world module depends only on the two public perception contracts', () => {
  const dir = new URL('../src/repository-ci-world/', import.meta.url);
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.ts'))
    .sort();
  assert.deepEqual(files, ['contracts.ts', 'index.ts', 'plugin.ts', 'types.ts']);

  const publicEntryPoints = new Set([
    '../git-repository/index.js',
    '../github-ci/index.js',
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

  // The World composes two capabilities; it owns no transport and no work tree of its own. Each
  // token below is a fact that would let this layer compare its two sources, or a way for it to
  // reach the machine: naming any of them is how the conclusion it must not draw would get drawn.
  const combined = files.map((name) => readFileSync(new URL(name, dir), 'utf8')).join('\n');
  for (const token of [
    'headSha',
    'workTreeRoot',
    'full_name',
    'remotes',
    'fetch',
    'execFile',
    'spawn',
    'node:',
  ]) {
    assert.equal(combined.includes(token), false, `the world module must not contain "${token}"`);
  }
});
