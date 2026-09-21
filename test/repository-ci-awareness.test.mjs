import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

import { Runtime } from '../dist/index.js';
import { repositoryCiWorldService } from '../dist/repository-ci-world/index.js';
import {
  repositoryCiAwarenessPlugin,
  repositoryCiAwarenessService,
} from '../dist/repository-ci-awareness/index.js';

const OBSERVED_AT = '2026-02-01T08:30:00.000Z';
const SNAPSHOT_AT = '2026-02-01T08:30:01.000Z';
const WORLD_PROVIDER = 'test.repository-ci-world-provider';
const OBSERVER = 'test.repository-ci-awareness-observer';

const HEAD_COMMIT = 'a'.repeat(40);
const OTHER_COMMIT = 'b'.repeat(40);

// No injection seam: the tests supply a fake *world provider* as an ordinary plugin and let the real
// Runtime dependency graph decide who is active. The Awareness plugin under test is the production
// one, and each fake snapshot is built by hand so that a given pair of facts is exact.
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

function worldProvider(behaviour) {
  return provider(WORLD_PROVIDER, repositoryCiWorldService, behaviour);
}

function available(observation) {
  return Object.freeze({ kind: 'available', observation });
}

function unavailable() {
  return Object.freeze({ kind: 'unavailable' });
}

function gitRepositoryObservation({
  head = { kind: 'branch', name: 'main', commit: HEAD_COMMIT },
  workTreeRoot = 'G:/work/LAB/code/hikari-new',
  remotes = ['origin'],
} = {}) {
  return Object.freeze({
    observedAt: OBSERVED_AT,
    source: 'git-repository',
    workTreeRoot,
    head,
    workTree: { kind: 'unchanged' },
    remotes,
  });
}

function reportedRun({
  headSha = OTHER_COMMIT,
  headBranch = 'main',
  workflow = 'Runtime Tests',
} = {}) {
  return {
    kind: 'reported',
    run: {
      id: 8100000001,
      workflow,
      headBranch,
      headSha,
      status: 'completed',
      conclusion: { kind: 'reported', value: 'success' },
    },
  };
}

function gitHubCiObservation({
  repository = 't1mb2rg/hikari-new',
  latestRun = reportedRun(),
} = {}) {
  return Object.freeze({ observedAt: OBSERVED_AT, source: 'github-ci', repository, latestRun });
}

function worldSnapshot({
  gitRepository = available(gitRepositoryObservation()),
  githubCi = available(gitHubCiObservation()),
  snapshotAt = SNAPSHOT_AT,
} = {}) {
  return Object.freeze({ snapshotAt, gitRepository, githubCi });
}

// Both facets carry a commit equal to each other, so a snapshot built this way is the ordinary
// agreeing case unless the caller says otherwise.
function agreeingSnapshot({ commit = HEAD_COMMIT } = {}) {
  return worldSnapshot({
    gitRepository: available(gitRepositoryObservation({ head: { kind: 'branch', name: 'main', commit } })),
    githubCi: available(gitHubCiObservation({ latestRun: reportedRun({ headSha: commit }) })),
  });
}

function observerDefinition(observed) {
  return {
    id: OBSERVER,
    version: '1.0.0',
    requires: [repositoryCiAwarenessService],
    setup(context) {
      observed.service = context.services.get(repositoryCiAwarenessService);
    },
  };
}

async function loadAll(runtime, world) {
  const observed = {};
  await runtime.loadPlugin(world.definition);
  await runtime.loadPlugin(repositoryCiAwarenessPlugin);
  await runtime.loadPlugin(observerDefinition(observed));
  return observed;
}

async function runningAwareness(t, world) {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());
  const observed = await loadAll(runtime, world);
  return { runtime, observed };
}

// The shorthand the case table below is written in: one snapshot in, one verdict out.
async function verdict(t, snapshot) {
  const world = worldProvider(() => Promise.resolve(snapshot));
  const { observed } = await runningAwareness(t, world);
  return (await observed.service.current()).commitComparison;
}

test('the awareness plugin requires exactly the world and provides its own', async (t) => {
  assert.deepEqual(repositoryCiAwarenessPlugin.requires, [repositoryCiWorldService]);
  assert.deepEqual(repositoryCiAwarenessPlugin.provides, [repositoryCiAwarenessService]);
  assert.equal(repositoryCiAwarenessPlugin.id, 'repository-ci-awareness');
  assert.equal(repositoryCiAwarenessPlugin.version, '1.0.0');
  assert.equal(repositoryCiAwarenessService.id, 'repository-ci-awareness.current');
  assert.equal(repositoryCiAwarenessService.version, 1);

  // Like the World it reads, this layer takes no configuration: everything it judges comes from the
  // snapshot, and everything that established the scope belongs to the two sources.
  assert.equal(repositoryCiAwarenessPlugin.config, undefined);

  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  assert.equal(await runtime.loadPlugin(repositoryCiAwarenessPlugin), 'waiting');
});

test('the awareness service is reachable through the plugin dependency graph', async (t) => {
  const { runtime, observed } = await runningAwareness(t, worldProvider(() => Promise.resolve(agreeingSnapshot())));

  assert.equal(runtime.getPluginState('repository-ci-awareness'), 'active');
  assert.equal(runtime.getPluginState(OBSERVER), 'active');
  assert.deepEqual(Object.keys(observed.service), ['current']);
});

test('the awareness waits for the world and activates when it arrives', async (t) => {
  const world = worldProvider(() => Promise.resolve(agreeingSnapshot()));
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  await runtime.loadPlugin(repositoryCiAwarenessPlugin);
  assert.equal(runtime.getPluginState('repository-ci-awareness'), 'waiting');

  await runtime.loadPlugin(world.definition);
  assert.equal(runtime.getPluginState('repository-ci-awareness'), 'active');
});

test('the awareness returns to waiting when the world disappears and activates again when it returns', async (t) => {
  const world = worldProvider(() => Promise.resolve(agreeingSnapshot()));
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  await runtime.loadPlugin(world.definition);
  await runtime.loadPlugin(repositoryCiAwarenessPlugin);
  assert.equal(runtime.getPluginState('repository-ci-awareness'), 'active');

  await runtime.unloadPlugin(WORLD_PROVIDER);
  assert.equal(runtime.getPluginState('repository-ci-awareness'), 'waiting');

  await runtime.loadPlugin(world.definition);
  assert.equal(runtime.getPluginState('repository-ci-awareness'), 'active');
});

test('a branch head equal to the run head reads as same', async (t) => {
  assert.equal(await verdict(t, agreeingSnapshot()), 'same');
});

test('a detached head equal to the run head reads as same', async (t) => {
  assert.equal(
    await verdict(
      t,
      worldSnapshot({
        gitRepository: available(gitRepositoryObservation({ head: { kind: 'detached', commit: HEAD_COMMIT } })),
        githubCi: available(gitHubCiObservation({ latestRun: reportedRun({ headSha: HEAD_COMMIT }) })),
      }),
    ),
    'same',
  );
});

test('a head that differs from the run head reads as different', async (t) => {
  assert.equal(
    await verdict(
      t,
      worldSnapshot({
        gitRepository: available(gitRepositoryObservation({ head: { kind: 'branch', name: 'main', commit: HEAD_COMMIT } })),
        githubCi: available(gitHubCiObservation({ latestRun: reportedRun({ headSha: OTHER_COMMIT }) })),
      }),
    ),
    'different',
  );
});

test('an unborn head reads as indeterminate even though CI reported a run', async (t) => {
  assert.equal(
    await verdict(
      t,
      worldSnapshot({
        gitRepository: available(gitRepositoryObservation({ head: { kind: 'unborn' } })),
        githubCi: available(gitHubCiObservation({ latestRun: reportedRun({ headSha: HEAD_COMMIT }) })),
      }),
    ),
    'indeterminate',
  );
});

test('a repository with no CI run reads as indeterminate even though git reported a commit', async (t) => {
  assert.equal(
    await verdict(
      t,
      worldSnapshot({
        gitRepository: available(gitRepositoryObservation()),
        githubCi: available(gitHubCiObservation({ latestRun: { kind: 'none' } })),
      }),
    ),
    'indeterminate',
  );
});

test('an unavailable git repository facet reads as indeterminate', async (t) => {
  assert.equal(
    await verdict(
      t,
      worldSnapshot({
        gitRepository: unavailable(),
        githubCi: available(gitHubCiObservation({ latestRun: reportedRun({ headSha: HEAD_COMMIT }) })),
      }),
    ),
    'indeterminate',
  );
});

test('an unavailable github ci facet reads as indeterminate', async (t) => {
  assert.equal(
    await verdict(
      t,
      worldSnapshot({
        gitRepository: available(gitRepositoryObservation()),
        githubCi: unavailable(),
      }),
    ),
    'indeterminate',
  );
});

test('both facets unavailable still resolves, as indeterminate', async (t) => {
  const world = worldProvider(() =>
    Promise.resolve(worldSnapshot({ gitRepository: unavailable(), githubCi: unavailable() })),
  );
  const { observed } = await runningAwareness(t, world);

  const settled = await observed.service.current().then(
    (result) => ({ outcome: 'resolved', result }),
    (error) => ({ outcome: 'rejected', error }),
  );

  assert.equal(settled.outcome, 'resolved');
  assert.equal(settled.result.commitComparison, 'indeterminate');
});

test('an absent fact is never collapsed into a differing one', async (t) => {
  const runInQuestion = reportedRun({ headSha: HEAD_COMMIT });

  // The same CI run, against two different local states. The first supplies no commit at all and the
  // second supplies one that genuinely differs; if a missing fact were folded into `different`, these
  // two would be indistinguishable.
  const missing = await verdict(
    t,
    worldSnapshot({
      gitRepository: available(gitRepositoryObservation({ head: { kind: 'unborn' } })),
      githubCi: available(gitHubCiObservation({ latestRun: runInQuestion })),
    }),
  );
  const differing = await verdict(
    t,
    worldSnapshot({
      gitRepository: available(gitRepositoryObservation({ head: { kind: 'branch', name: 'main', commit: OTHER_COMMIT } })),
      githubCi: available(gitHubCiObservation({ latestRun: runInQuestion })),
    }),
  );

  assert.equal(missing, 'indeterminate');
  assert.equal(differing, 'different');
  assert.notEqual(missing, differing);
});

test('the verdict depends on the two reported strings and on nothing else', async (t) => {
  // Every fact either source reports besides the commit is set to disagree with the other side, and
  // the commits agree. If any of those facts reached the comparison, this would not be `same`.
  const same = await verdict(
    t,
    worldSnapshot({
      gitRepository: available(
        gitRepositoryObservation({
          head: { kind: 'branch', name: 'main', commit: HEAD_COMMIT },
          workTreeRoot: 'D:/somewhere/else/entirely',
          remotes: ['upstream', 'contributor-fork'],
        }),
      ),
      githubCi: available(
        gitHubCiObservation({
          repository: 'someone-else/another-repository-name',
          latestRun: reportedRun({ headSha: HEAD_COMMIT, headBranch: 'release/9.x', workflow: 'Nightly' }),
        }),
      ),
    }),
  );

  // And the other way round: the two sides look like the same repository by every name either of
  // them carries, and the commits differ. If a matching name reached the comparison, this would not
  // be `different`.
  const differing = await verdict(
    t,
    worldSnapshot({
      gitRepository: available(
        gitRepositoryObservation({
          head: { kind: 'branch', name: 'main', commit: HEAD_COMMIT },
          workTreeRoot: 'G:/work/LAB/code/hikari-new',
          remotes: ['origin'],
        }),
      ),
      githubCi: available(
        gitHubCiObservation({
          repository: 't1mb2rg/hikari-new',
          latestRun: reportedRun({ headSha: OTHER_COMMIT, headBranch: 'main', workflow: 'Runtime Tests' }),
        }),
      ),
    }),
  );

  assert.equal(same, 'same');
  assert.equal(differing, 'different');
});

test('the two reported strings are compared as reported, without normalisation', async (t) => {
  // The same forty hexadecimal digits, reported in two different cases. The two reports differ, and
  // this layer compares reports — deciding that they denote one commit would be a reading of the two
  // sources rather than a comparison of them. `different` is the honest verdict here, and it says
  // something about the reports, not about the commits.
  assert.equal(
    await verdict(
      t,
      worldSnapshot({
        gitRepository: available(gitRepositoryObservation({ head: { kind: 'branch', name: 'main', commit: HEAD_COMMIT.toUpperCase() } })),
        githubCi: available(gitHubCiObservation({ latestRun: reportedRun({ headSha: HEAD_COMMIT }) })),
      }),
    ),
    'different',
  );
});

test('the assessment adds nothing to the snapshot and remembers nothing between calls', async (t) => {
  const first = agreeingSnapshot({ commit: HEAD_COMMIT });
  const second = worldSnapshot({
    gitRepository: available(gitRepositoryObservation({ head: { kind: 'branch', name: 'main', commit: HEAD_COMMIT } })),
    githubCi: available(gitHubCiObservation({ latestRun: reportedRun({ headSha: OTHER_COMMIT }) })),
  });
  const world = worldProvider((nth) => Promise.resolve(nth === 1 ? first : second));
  const { observed } = await runningAwareness(t, world);

  const firstResult = await observed.service.current();
  const secondResult = await observed.service.current();

  assert.equal(firstResult.commitComparison, 'same');
  assert.equal(secondResult.commitComparison, 'different');

  // Each call judged the snapshot it was handed. A layer holding history would have compared the
  // second snapshot against the first and said `different` for that reason instead.
  assert.equal(world.counts.calls, 2);
  assert.equal(firstResult.snapshot, first);
  assert.equal(secondResult.snapshot, second);

  // Exactly two keys, and neither of them is a previous snapshot.
  assert.deepEqual(Object.keys(firstResult).sort(), ['commitComparison', 'snapshot']);
  assert.deepEqual(Object.keys(secondResult).sort(), ['commitComparison', 'snapshot']);
  assert.notEqual(firstResult, secondResult);
});

test('the assessment carries the world snapshot unchanged', async (t) => {
  const snapshot = agreeingSnapshot();
  const before = structuredClone(snapshot);
  const world = worldProvider(() => Promise.resolve(snapshot));
  const { observed } = await runningAwareness(t, world);

  const result = await observed.service.current();

  // Reference identity, not deep equality: the layer judges the snapshot it was handed and hands
  // that same snapshot back rather than rebuilding one. Asserted on identity so that a layer which
  // quietly rebuilt an equivalent snapshot would fail here.
  assert.equal(result.snapshot, snapshot);

  // And the same snapshot it was handed is still the one that was handed to it. Identity alone would
  // also be satisfied by a layer that read the snapshot and then wrote to it.
  assert.deepEqual(snapshot, before);
  assert.equal(result.snapshot.snapshotAt, SNAPSHOT_AT);
  assert.equal(result.snapshot.gitRepository.observation.observedAt, OBSERVED_AT);
});

test('a world that failed outright propagates rather than reading as indeterminate', async (t) => {
  // The two facets are how a *source* failure is reported, and they are read above. A world that
  // rejected is a different thing entirely: the composition itself did not happen, so there is no
  // snapshot to judge and nothing here was compared. Folding that into `indeterminate` would make
  // "the question could not be put" cover "this layer never got as far as the question", and the
  // caller would lose the distinction between an unreadable source and a broken world.
  const failure = new Error('the world could not be composed');
  const world = worldProvider(() => Promise.reject(failure));
  const { observed } = await runningAwareness(t, world);

  await assert.rejects(() => observed.service.current(), failure);
});

test('the assessment is frozen', async (t) => {
  const world = worldProvider(() => Promise.resolve(agreeingSnapshot()));
  const { observed } = await runningAwareness(t, world);

  const result = await observed.service.current();
  assert.equal(Object.isFrozen(result), true);

  const unavailableWorld = worldProvider(() =>
    Promise.resolve(worldSnapshot({ gitRepository: unavailable(), githubCi: unavailable() })),
  );
  const { observed: observedUnavailable } = await runningAwareness(t, unavailableWorld);

  assert.equal(Object.isFrozen(await observedUnavailable.service.current()), true);
});

test('the awareness performs no observation at setup, while idle, or at shutdown', async (t) => {
  const world = worldProvider(() => Promise.resolve(agreeingSnapshot()));
  const runtime = new Runtime();

  const observed = await loadAll(runtime, world);

  assert.equal(runtime.getPluginState('repository-ci-awareness'), 'active');
  assert.equal(typeof observed.service.current, 'function');
  assert.equal(world.counts.calls, 0);

  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(world.counts.calls, 0);

  await runtime.shutdown();
  assert.equal(world.counts.calls, 0);
  assert.equal(runtime.getPluginState('repository-ci-awareness'), undefined);
});

test('the awareness module depends only on the public world contract', () => {
  const dir = new URL('../src/repository-ci-awareness/', import.meta.url);
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.ts'))
    .sort();
  assert.deepEqual(files, ['contracts.ts', 'index.ts', 'plugin.ts', 'types.ts']);

  const publicEntryPoints = new Set([
    '../repository-ci-world/index.js',
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

  // Two groups of tokens, both of which would mean this layer had stopped comparing two strings.
  // The first six are facts the two observations do carry and that a verdict could be derived from
  // instead: a work tree, a set of remote names, a branch name, a canonical repository name, and two
  // CI fields that describe the run rather than the commit. Reading any of them is how "which
  // repository is this" would get answered here. The last four are ways this layer could reach the
  // machine on its own rather than judge what it was handed.
  const combined = files.map((name) => readFileSync(new URL(name, dir), 'utf8')).join('\n');
  for (const token of [
    'workTreeRoot',
    'remotes',
    'headBranch',
    'full_name',
    'conclusion',
    'workflow',
    'fetch',
    'execFile',
    'spawn',
    'node:',
  ]) {
    assert.equal(combined.includes(token), false, `the awareness module must not contain "${token}"`);
  }
});
