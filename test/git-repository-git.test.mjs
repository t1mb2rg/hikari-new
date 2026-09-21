import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  GitRepositoryObservationError,
  gitRepositoryPlugin,
  gitRepositoryService,
} from '../dist/git-repository/index.js';
import { Runtime } from '../dist/index.js';

// The second named exception to the "tests import only public entry points" pattern. These are the
// only tests in the suite that drive a third-party program against a fixture it wrote itself, and
// the seam is the only way to reach the real acquirer without also reaching the plugin lifecycle.
import { createGitAcquirer } from '../dist/git-repository/git.js';

// A new skip axis for this suite. Every other test file either needs no external program or is
// gated on the host platform; this one needs a git executable on PATH, and on a host without one
// the honest outcome is a skip rather than a confusing failure.
const hasGit = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  }
})();

const gitSkip = hasGit ? false : 'requires the git executable on PATH';

// The developer's own git configuration is deliberately not inherited. A global
// `status.showUntrackedFiles=no` or `init.defaultBranch` would change what these fixtures observe,
// and a test whose result depends on the machine it runs on is not testing this module.
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  GIT_CONFIG_SYSTEM: process.platform === 'win32' ? 'NUL' : '/dev/null',
  GIT_AUTHOR_NAME: 'Hikari Test',
  GIT_AUTHOR_EMAIL: 'hikari@example.invalid',
  GIT_COMMITTER_NAME: 'Hikari Test',
  GIT_COMMITTER_EMAIL: 'hikari@example.invalid',
};

const OBJECT_ID = /^[0-9a-f]{40,64}$/;

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env: GIT_ENV });
}

function createRepository(t, name) {
  const root = mkdtempSync(join(tmpdir(), `hikari-git-repository-${name}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-b', 'main');
  return root;
}

function commit(root, message) {
  git(root, 'commit', '-q', '--allow-empty', '-m', message);
}

// One acquirer per test, disposed on the way out: `current()` is pull-only, and these tests are the
// ones entitled to open a process at all.
async function acquireFrom(root) {
  const acquirer = createGitAcquirer({ repositoryRoot: root });
  try {
    return await acquirer.acquire();
  } finally {
    await acquirer.dispose();
  }
}

function fakeGit(outputs) {
  const asked = [];
  return {
    asked,
    runGit(invocation) {
      asked.push(invocation.args[0]);
      const output = outputs[invocation.args[0]];
      if (output === undefined) return Promise.reject(new Error(`no fake output for ${invocation.args[0]}`));
      if (output instanceof Error) return Promise.reject(output);
      return Promise.resolve(output);
    },
  };
}

function failingGit(error) {
  return { runGit: () => Promise.reject(error) };
}

test('an unborn repository reports an unborn head rather than failing', { skip: gitSkip }, async (t) => {
  const root = createRepository(t, 'unborn');

  const acquisition = await acquireFrom(root);

  assert.deepEqual(acquisition.head, { kind: 'unborn' });
  assert.deepEqual(acquisition.workTree, { kind: 'unchanged' });
  assert.deepEqual(acquisition.remotes, []);
});

test('a committed repository reports its branch name and the commit HEAD resolves to', { skip: gitSkip }, async (t) => {
  const root = createRepository(t, 'branch');
  commit(root, 'one');

  const acquisition = await acquireFrom(root);

  assert.equal(acquisition.head.kind, 'branch');
  assert.equal(acquisition.head.name, 'main');
  assert.match(acquisition.head.commit, OBJECT_ID);
  assert.equal(acquisition.head.commit, git(root, 'rev-parse', 'HEAD').trim());
});

test('a clean work tree is unchanged, and an untracked file is enough to change it', { skip: gitSkip }, async (t) => {
  const root = createRepository(t, 'untracked');
  commit(root, 'one');

  assert.deepEqual((await acquireFrom(root)).workTree, { kind: 'unchanged' });

  writeFileSync(join(root, 'untracked.txt'), 'a file git was never told about\n');

  assert.deepEqual((await acquireFrom(root)).workTree, { kind: 'changed' });
});

test('an untracked file counts even when the repository config says not to list them', { skip: gitSkip }, async (t) => {
  const root = createRepository(t, 'untracked-config');
  commit(root, 'one');
  git(root, 'config', 'status.showUntrackedFiles', 'no');
  writeFileSync(join(root, 'untracked.txt'), 'still untracked\n');

  assert.deepEqual((await acquireFrom(root)).workTree, { kind: 'changed' });
});

test('a modified tracked file changes the work tree', { skip: gitSkip }, async (t) => {
  const root = createRepository(t, 'modified');
  writeFileSync(join(root, 'tracked.txt'), 'first\n');
  git(root, 'add', 'tracked.txt');
  commit(root, 'one');
  writeFileSync(join(root, 'tracked.txt'), 'second\n');

  assert.deepEqual((await acquireFrom(root)).workTree, { kind: 'changed' });
});

test('a repository with no remote reports an empty list, which is a state and not a failure', { skip: gitSkip }, async (t) => {
  const root = createRepository(t, 'no-remote');
  commit(root, 'one');

  assert.deepEqual((await acquireFrom(root)).remotes, []);
});

test('remote names are reported as configured, and no name is assumed', { skip: gitSkip }, async (t) => {
  const root = createRepository(t, 'remotes');
  commit(root, 'one');
  git(root, 'remote', 'add', 'upstream', 'https://example.invalid/upstream.git');
  git(root, 'remote', 'add', 'fork', 'https://example.invalid/fork.git');

  const remotes = (await acquireFrom(root)).remotes;

  assert.deepEqual([...remotes].sort(), ['fork', 'upstream']);
  assert.equal(remotes.includes('origin'), false);
});

test('a detached head is reported as detached and carries its commit', { skip: gitSkip }, async (t) => {
  const root = createRepository(t, 'detached');
  commit(root, 'one');
  const committed = git(root, 'rev-parse', 'HEAD').trim();
  git(root, 'checkout', '-q', '--detach', 'HEAD');

  const acquisition = await acquireFrom(root);

  assert.deepEqual(acquisition.head, { kind: 'detached', commit: committed });
});

test('a branch literally named (detached) is reported as that branch', { skip: gitSkip }, async (t) => {
  const root = createRepository(t, 'detached-name');
  commit(root, 'one');
  git(root, 'branch', '(detached)');
  git(root, 'checkout', '-q', '(detached)');

  const acquisition = await acquireFrom(root);

  // git writes `# branch.head (detached)` for this and for a real detached HEAD alike, so the
  // header alone cannot tell them apart. This is the case that asks the second question.
  assert.equal(acquisition.head.kind, 'branch');
  assert.equal(acquisition.head.name, '(detached)');
});

test('the branch name is asked for only when the header said detached', async () => {
  const commit = 'a'.repeat(40);

  const onBranch = fakeGit({
    status: `# branch.oid ${commit}\n# branch.head main\n`,
    remote: '',
    'rev-parse': '/somewhere\n',
  });
  await createGitAcquirer({ repositoryRoot: '/somewhere', runGit: onBranch.runGit }).acquire();
  assert.deepEqual(onBranch.asked, ['status', 'remote', 'rev-parse']);

  const detached = fakeGit({
    status: `# branch.oid ${commit}\n# branch.head (detached)\n`,
    branch: 'main\n',
    remote: '',
    'rev-parse': '/somewhere\n',
  });
  const acquisition = await createGitAcquirer({ repositoryRoot: '/somewhere', runGit: detached.runGit }).acquire();
  assert.deepEqual(detached.asked, ['status', 'branch', 'remote', 'rev-parse']);
  assert.deepEqual(acquisition.head, { kind: 'branch', name: 'main', commit });

  const reallyDetached = fakeGit({
    status: `# branch.oid ${commit}\n# branch.head (detached)\n`,
    branch: '',
    remote: '',
    'rev-parse': '/somewhere\n',
  });
  const lone = await createGitAcquirer({ repositoryRoot: '/somewhere', runGit: reallyDetached.runGit }).acquire();
  assert.deepEqual(lone.head, { kind: 'detached', commit });
});

test('the work tree root is what git found, which may be an ancestor of the configured path', { skip: gitSkip }, async (t) => {
  const root = createRepository(t, 'nested');
  commit(root, 'one');
  const nested = join(root, 'nested', 'deeper');
  mkdirSync(nested, { recursive: true });

  const acquisition = await acquireFrom(nested);

  assert.notEqual(acquisition.workTreeRoot, nested);
  assert.equal(acquisition.workTreeRoot, git(root, 'rev-parse', '--show-toplevel').trim());
  assert.equal(acquisition.workTreeRoot.endsWith('/nested'), false);
});

test('a path that is not a repository is a failed observation, never an empty one', { skip: gitSkip }, async (t) => {
  const outside = mkdtempSync(join(tmpdir(), 'hikari-git-repository-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));

  await assert.rejects(acquireFrom(outside), GitRepositoryObservationError);
});

test('a bare repository has no work tree, and that is reported as a failure', { skip: gitSkip }, async (t) => {
  const parent = mkdtempSync(join(tmpdir(), 'hikari-git-repository-bare-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const bare = join(parent, 'bare.git');
  execFileSync('git', ['init', '-q', '--bare', bare], { encoding: 'utf8', env: GIT_ENV });

  // A known limit rather than a state this version reports: git refuses to describe a work tree
  // that does not exist, and v1 has no way to say "repository without a work tree".
  await assert.rejects(acquireFrom(bare), GitRepositoryObservationError);
});

test('a repository that changes between two current() calls is reported as it is now', { skip: gitSkip }, async (t) => {
  const root = createRepository(t, 'fresh');
  commit(root, 'one');
  const acquirer = createGitAcquirer({ repositoryRoot: root });
  t.after(() => acquirer.dispose());

  const first = await acquirer.acquire();
  writeFileSync(join(root, 'untracked.txt'), 'appeared between the two\n');
  const second = await acquirer.acquire();

  assert.deepEqual(first.workTree, { kind: 'unchanged' });
  assert.deepEqual(second.workTree, { kind: 'changed' });
  assert.notEqual(first.observedAt, second.observedAt);
});

test('the observation reaches a consumer through the plugin, labelled and shaped', { skip: gitSkip }, async (t) => {
  const root = createRepository(t, 'through-plugin');
  commit(root, 'one');
  git(root, 'remote', 'add', 'upstream', 'https://example.invalid/upstream.git');

  const runtime = new Runtime();
  t.after(() => runtime.shutdown());
  await runtime.loadPlugin(gitRepositoryPlugin, { repositoryRoot: root });

  const observed = {};
  await runtime.loadPlugin({
    id: 'test.git-repository-git-observer',
    version: '1.0.0',
    requires: [gitRepositoryService],
    setup(context) {
      observed.service = context.services.get(gitRepositoryService);
    },
  });

  const observation = await observed.service.current();

  assert.deepEqual(Object.keys(observation).sort(), [
    'head',
    'observedAt',
    'remotes',
    'source',
    'workTree',
    'workTreeRoot',
  ]);
  assert.equal(observation.source, 'git-repository');
  assert.match(observation.observedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(observation.head.kind, 'branch');
  assert.equal(observation.head.name, 'main');
  assert.deepEqual(observation.remotes, ['upstream']);
  assert.deepEqual(observation.workTree, { kind: 'unchanged' });
  assert.ok(Object.isFrozen(observation));

  await runtime.unloadPlugin('git-repository');
  assert.equal(runtime.getPluginState('git-repository'), undefined);
});

test('a git executable that never started is not reported as one that exited', async () => {
  const missing = Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' });
  const acquirer = createGitAcquirer({
    repositoryRoot: '/somewhere',
    runGit: failingGit(missing).runGit,
  });

  await assert.rejects(acquirer.acquire(), (error) => {
    assert.ok(error instanceof GitRepositoryObservationError);
    assert.match(error.message, /the git executable could not be started/);
    assert.equal(error.message.includes('exited with code'), false);
    return true;
  });
});

test('an exit code is reported against the question it answered, not mapped to a meaning', async () => {
  const exited = Object.assign(new Error('Command failed'), { code: 128 });
  const acquirer = createGitAcquirer({
    repositoryRoot: '/somewhere',
    runGit: failingGit(exited).runGit,
  });

  await assert.rejects(acquirer.acquire(), (error) => {
    assert.match(error.message, /the working tree state could not be read/);
    assert.match(error.message, /git exited with code 128/);
    return true;
  });
});

test('output this module cannot express is refused rather than reported', async () => {
  const status = fakeGit({ status: '# branch.oid (initial)\n' });
  await assert.rejects(
    createGitAcquirer({ repositoryRoot: '/somewhere', runGit: status.runGit }).acquire(),
    GitRepositoryObservationError,
  );

  const nonsense = fakeGit({ status: '# branch.oid not-a-commit\n# branch.head main\n' });
  await assert.rejects(
    createGitAcquirer({ repositoryRoot: '/somewhere', runGit: nonsense.runGit }).acquire(),
    GitRepositoryObservationError,
  );

  const noRoot = fakeGit({
    status: '# branch.oid (initial)\n# branch.head main\n',
    remote: '',
    'rev-parse': '\n',
  });
  await assert.rejects(
    createGitAcquirer({ repositoryRoot: '/somewhere', runGit: noRoot.runGit }).acquire(),
    GitRepositoryObservationError,
  );
});

test('the unborn marker survives the header being the only thing git reports', async () => {
  const fake = fakeGit({
    status: '# branch.oid (initial)\n# branch.head main\n# branch.upstream\n# branch.ab +0 -0\n',
    remote: 'upstream\n',
    'rev-parse': '/somewhere\n',
  });

  const acquisition = await createGitAcquirer({ repositoryRoot: '/somewhere', runGit: fake.runGit }).acquire();

  assert.deepEqual(acquisition.head, { kind: 'unborn' });
  assert.deepEqual(acquisition.remotes, ['upstream']);
});

test('a disposed acquirer refuses to observe, and reports a racing unload as an unload', { skip: gitSkip }, async (t) => {
  const root = createRepository(t, 'disposed');
  commit(root, 'one');

  const disposed = createGitAcquirer({ repositoryRoot: root });
  await disposed.dispose();
  await assert.rejects(disposed.acquire(), (error) => {
    assert.match(error.message, /the acquirer has already been disposed/);
    return true;
  });

  // The race is not forced — git finishes too quickly to make that deterministic — but whichever
  // way it lands, an unload must never be reported as a command that ran out of time.
  const racing = createGitAcquirer({ repositoryRoot: root });
  const settling = racing.acquire().then(
    () => 'observed',
    (error) => error.message,
  );
  await racing.dispose();
  const outcome = await settling;
  if (outcome !== 'observed') {
    assert.match(outcome, /the acquirer was disposed mid-observation/);
    assert.equal(outcome.includes('did not finish in time'), false);
  }
});
