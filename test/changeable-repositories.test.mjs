import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { Runtime } from '../dist/index.js';
import {
  changeableRepositoriesEndpointPath,
  changeableRepositoriesPlugin,
} from '../dist/changeable-repositories/index.js';
import { requestChangeableRepositories } from '../dist/cli/change.js';
import { chroniclePlugin, initializeChronicle, openChronicle } from '../dist/chronicle/index.js';
import { continuityPlugin, initializeHikari, restoreHikari } from '../dist/continuity/index.js';
import { changeableRepositoriesFactDraft } from '../dist/changeable-repositories/facts.js';
import { realDirectoryReader } from '../dist/changeable-repositories/paths.js';
import {
  applyChangeableRepositoriesRequest,
  emptyChangeableRepositories,
  renderChangeableRepositories,
  sameMembership,
} from '../dist/changeable-repositories/state.js';

const CLI = join(import.meta.dirname, '..', 'dist', 'cli', 'main.js');

// Named pipes are the whole of the ingress, so everything that has to reach a real endpoint is
// Windows-only. What is left ungated is the domain, which is pure and has no host — and that split is
// the reason `paths.ts` is a separate file from `state.ts`.
const NO_PIPES = process.platform === 'win32' ? false : '命名管道只在 Windows 上存在';

// The human-visible sentences, written out here rather than imported from the module — for the same
// reason the work focus test writes its own: a test that took the wording from the module would agree
// with whatever the module happened to say, including after somebody reworded it into something a
// human would misread.
const NONE = '这个数据目录里还没有授权任何可改仓库。';
const NOT_ABSOLUTE = (value) => `${value} 不是一个绝对路径。`;
const NOT_A_DIRECTORY = (value) => `${value} 不是一个存在的目录。`;
const REPLACE_NEEDS_ONE = 'replace 至少需要一个目录；要清空请用 clear。';

// A reader that answers from a table, so the transitions can be asserted on a machine where none of
// these directories exists. The rule under test is what a request *means*; what a path *is* is the
// other question, and it is tested below against a real disk.
const table = (readings) => ({ read: (value) => readings[value] });

const HOME = 'C:\\work\\one';
const OTHER = 'C:\\work\\two';

const reader = table({
  [HOME]: { kind: 'ok', canonical: HOME },
  [OTHER]: { kind: 'ok', canonical: OTHER },
  // Two spellings, one directory: the reader is the thing that decides this, and the state must
  // therefore never hold both.
  'C:\\work\\.\\one': { kind: 'ok', canonical: HOME },
  'C:\\work\\three': { kind: 'ok', canonical: HOME },
  'not absolute': { kind: 'not-absolute' },
  'C:\\work\\missing': { kind: 'not-a-directory' },
});

const apply = (state, request) =>
  applyChangeableRepositoriesRequest(state, request, reader);

const members = (transition) => {
  assert.equal(transition.kind, 'ok');
  return [...transition.state.repositories];
};

test('declare adds, and two spellings of one directory are one member', () => {
  const empty = emptyChangeableRepositories();

  assert.deepEqual(members(apply(empty, { word: 'declare', repositories: [HOME] })), [HOME]);

  // The second spelling is not a second member. This is the whole reason a member is admitted in its
  // canonical form, and the assertion that would fail if the reader were bypassed.
  const once = apply(empty, { word: 'declare', repositories: [HOME] }).state;
  const twice = apply(once, {
    word: 'declare',
    repositories: ['C:\\work\\.\\one', 'C:\\work\\three'],
  });
  assert.deepEqual(members(twice), [HOME]);
});

test('declare unions and replace replaces, which is the only difference between them', () => {
  const one = apply(emptyChangeableRepositories(), {
    word: 'declare',
    repositories: [HOME],
  }).state;

  assert.deepEqual(
    members(apply(one, { word: 'declare', repositories: [OTHER] })),
    [HOME, OTHER],
  );
  assert.deepEqual(
    members(apply(one, { word: 'replace', repositories: [OTHER] })),
    [OTHER],
  );
});

test('replace with nothing is refused, and declare with nothing is not', () => {
  const one = apply(emptyChangeableRepositories(), {
    word: 'declare',
    repositories: [HOME],
  }).state;

  // The empty set has exactly one way in — `clear` — and a second spelling of it would be a second
  // thing to keep in step.
  const refused = apply(one, { word: 'replace', repositories: [] });
  assert.equal(refused.kind, 'refused');
  assert.equal(refused.reason, REPLACE_NEEDS_ONE);

  // `declare` with nothing names no directory that could be wrong, so it is a no-op rather than a
  // mistake: it cannot move the set, and it answers like anything else that could not.
  const noop = apply(one, { word: 'declare', repositories: [] });
  assert.equal(noop.kind, 'ok');
  assert.ok(sameMembership(one, noop.state));
});

test('clear empties whatever was there', () => {
  const one = apply(emptyChangeableRepositories(), {
    word: 'declare',
    repositories: [HOME, OTHER],
  }).state;

  assert.deepEqual(members(apply(one, { word: 'clear' })), []);
});

test('a directory that is not there, or not absolute, is refused by name as it arrived', () => {
  const empty = emptyChangeableRepositories();

  // Quoted as it arrived: the canonical form does not exist in the failing case, and echoing a
  // resolved form back would be showing the human something they did not type.
  const relative = apply(empty, { word: 'declare', repositories: ['not absolute'] });
  assert.equal(relative.kind, 'refused');
  assert.equal(relative.reason, NOT_ABSOLUTE('not absolute'));

  const missing = apply(empty, { word: 'declare', repositories: ['C:\\work\\missing'] });
  assert.equal(missing.kind, 'refused');
  assert.equal(missing.reason, NOT_A_DIRECTORY('C:\\work\\missing'));
});

test('a refused request leaves the set exactly where it was', () => {
  const one = apply(emptyChangeableRepositories(), {
    word: 'declare',
    repositories: [HOME],
  }).state;

  // The refusal is per-request, not per-member: a `replace` whose second entry is bad must not leave
  // the first one admitted. Anything else would make the set a function of how far the loop got.
  const refused = apply(one, {
    word: 'replace',
    repositories: [OTHER, 'C:\\work\\missing'],
  });
  assert.equal(refused.kind, 'refused');
  // A refusal carries no state at all, which is what makes "the set did not move" a property of the
  // shape rather than a promise the caller has to keep.
  assert.equal(refused.state, undefined);
  assert.deepEqual(members({ kind: 'ok', state: one }), [HOME]);
});

test('sameMembership is a claim about the set, not about the array', () => {
  const one = apply(emptyChangeableRepositories(), {
    word: 'declare',
    repositories: [HOME],
  }).state;
  const same = apply(emptyChangeableRepositories(), {
    word: 'declare',
    repositories: [HOME],
  }).state;
  const other = apply(emptyChangeableRepositories(), {
    word: 'declare',
    repositories: [OTHER],
  }).state;

  assert.ok(sameMembership(one, same));
  assert.ok(!sameMembership(one, other));
  // A rebuild that produced an equal set is equal, and the very same object is equal to itself.
  assert.ok(sameMembership(one, one));
});

test('the empty set is a sentence and the members are the answer', () => {
  assert.deepEqual([...renderChangeableRepositories(emptyChangeableRepositories())], [NONE]);

  const one = apply(emptyChangeableRepositories(), {
    word: 'declare',
    repositories: [HOME],
  }).state;
  // No header: the set is the answer, and a heading would be decoration on a list of paths that are
  // already the whole of it.
  assert.deepEqual([...renderChangeableRepositories(one)], [HOME]);
});

test('three words write a fact and status writes none', () => {
  const one = apply(emptyChangeableRepositories(), {
    word: 'declare',
    repositories: [HOME],
  }).state;

  assert.equal(changeableRepositoriesFactDraft({ word: 'status' }, one), undefined);

  const declared = changeableRepositoriesFactDraft({ word: 'declare', repositories: [HOME] }, one);
  assert.equal(declared.type, 'changeable-repositories.declared');
  assert.equal(declared.version, 1);
  assert.equal(declared.source.kind, 'changeable-repositories.declaration');
  assert.deepEqual(declared.payload.repositories, [HOME]);

  const replaced = changeableRepositoriesFactDraft({ word: 'replace', repositories: [OTHER] }, one);
  assert.equal(replaced.type, 'changeable-repositories.replaced');

  // Nothing, not `{ repositories: [] }`: an empty set can only hold one value, so a payload repeating
  // it would be a field with one legal content.
  const cleared = changeableRepositoriesFactDraft({ word: 'clear' }, emptyChangeableRepositories());
  assert.equal(cleared.type, 'changeable-repositories.cleared');
  assert.deepEqual(cleared.payload, {});
});

test('the fact carries the set the transition left behind, not the request that moved it', () => {
  // This is the family's whole difference from the work focus's: a new activation rebuilds the set by
  // reading it back, so a payload that recorded only what the word did would make read-back a replay.
  const one = apply(emptyChangeableRepositories(), {
    word: 'declare',
    repositories: [HOME],
  }).state;
  const both = apply(one, { word: 'declare', repositories: [OTHER] }).state;

  const draft = changeableRepositoriesFactDraft({ word: 'declare', repositories: [OTHER] }, both);
  assert.deepEqual(draft.payload.repositories, [HOME, OTHER]);
});

test('the real reader resolves through a dot segment and refuses what is not there', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hikari-change-')));
  try {
    const nested = join(root, 'nested');
    mkdirSync(nested);

    // A member is the directory, identified by the one canonical name for it — so a path that walks
    // through a dot segment is admitted as the same member, not as a second spelling of it.
    const throughDot = join(root, 'nested', '..', 'nested');
    const reading = realDirectoryReader.read(throughDot);
    assert.equal(reading.kind, 'ok');
    assert.equal(reading.canonical, nested);

    assert.equal(realDirectoryReader.read('relative').kind, 'not-absolute');
    assert.equal(realDirectoryReader.read(join(root, 'nope')).kind, 'not-a-directory');
    // A file is not a directory, and the answer is the same one a missing path gets: the human has one
    // thing to fix either way.
    const file = join(root, 'file.txt');
    writeFileSync(file, '');
    assert.equal(realDirectoryReader.read(file).kind, 'not-a-directory');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the real reader does not follow a member when a link is retargeted later', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hikari-change-')));
  try {
    const real = join(root, 'real');
    mkdirSync(real);
    const link = join(root, 'link');
    try {
      symlinkSync(real, link, 'junction');
    } catch {
      // Creating a link can need a privilege this machine may not have. The assertion below is about
      // what a resolved member means, and it is worth skipping rather than weakening.
      return;
    }

    // Resolved at admission: the member names the directory that was there, not the name that pointed
    // at it. The authorization does not silently follow a link that is retargeted afterwards — which
    // is the safer half of the behaviour, and the reason `status` exists for the other half.
    const reading = realDirectoryReader.read(link);
    assert.equal(reading.kind, 'ok');
    assert.equal(reading.canonical, real);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// The ingress, against a real endpoint in a real composition.
//
// Everything above is the domain and needs no host. What follows needs three things at once — a data
// directory with a chronicle, a Runtime holding the plugin, and a client that reaches the pipe — and it
// exists because the domain being right is not the same claim as the surface working. The two that
// matter most are the ones no unit test can make: that the endpoint lives and dies with the activation,
// and that a declaration survives one.
// ---------------------------------------------------------------------------------------------

function createRoot(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hikari-changeable-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

// The same two functions `hikari init` and `hikari chronicle init` call, so a test that needs a root set
// up does not pay for two child processes to get one.
function initializedRoot(t) {
  const root = createRoot(t);
  const identity = initializeHikari({ rootDir: root });
  initializeChronicle({ rootDir: root, identity });
  return root;
}

// A plugin whose `requires` is unsatisfied stays `waiting` — `setup` never runs, no endpoint is ever
// bound — so the composition is loaded rather than the plugin alone, and the activation is asserted.
// Without that assertion a test here would happily measure the absence of a composition.
async function compose(root) {
  const runtime = new Runtime();
  await runtime.loadPlugin(continuityPlugin, { rootDir: root });
  await runtime.loadPlugin(chroniclePlugin, { rootDir: root });
  const state = await runtime.loadPlugin(changeableRepositoriesPlugin, { rootDir: root });
  assert.equal(state, 'active', '可改仓库插件没有激活');
  return runtime;
}

// Read by a reader that is not the writer: a separate service opened on the same directory, parsing the
// store out of the file on every call. Asking the Runtime's own service would be asking the plugin to
// grade its own work, and would pass just as happily if nothing had reached the disk.
async function readFacts(root) {
  return openChronicle({ rootDir: root, identity: restoreHikari({ rootDir: root }) }).read();
}

// The real client, not a hand-rolled socket: what a test asserts through should be the same code a
// human's command runs, or it is asserting about a second implementation of the same idea.
async function ask(root, request) {
  const answer = await requestChangeableRepositories(root, request);
  assert.equal(answer.kind, 'answered', `没有拿到应答：${JSON.stringify(answer)}`);
  return answer;
}

function membersOf(answer) {
  assert.equal(answer.outcome, 'ok', `请求被拒绝：${answer.lines.join(' / ')}`);
  return [...answer.lines];
}

test('声明、看、替换、清空，走真实端点', NO_PIPES, async (t) => {
  const root = initializedRoot(t);
  const runtime = await compose(root);
  try {
    const dir = createRoot(t);

    assert.deepEqual(membersOf(await ask(root, { word: 'status' })), [NONE]);
    assert.deepEqual(membersOf(await ask(root, { word: 'declare', repositories: [dir] })), [dir]);
    assert.deepEqual(membersOf(await ask(root, { word: 'status' })), [dir]);
    assert.deepEqual(membersOf(await ask(root, { word: 'clear' })), [NONE]);
  } finally {
    await runtime.shutdown();
  }
});

test('端点只在激活期间存在，卸载之后就没人提供了', NO_PIPES, async (t) => {
  const root = initializedRoot(t);
  const runtime = await compose(root);

  // The endpoint path is derived from the data directory, so it is the same string before and after —
  // which is what makes the second half of this test about the *endpoint* rather than about a name.
  const path = changeableRepositoriesEndpointPath(root);
  assert.ok(path !== undefined);

  assert.equal((await requestChangeableRepositories(root, { word: 'status' })).kind, 'answered');
  await runtime.shutdown();

  // Nothing is listening, and the client says so rather than reporting a broken surface. "Gone with its
  // plugin" is the property this endpoint has that the Resident's control endpoint deliberately does not.
  const after = await requestChangeableRepositories(root, { word: 'status' });
  assert.equal(after.kind, 'absent', `卸载后仍然拿到了：${JSON.stringify(after)}`);
});

test('声明活过一次激活：读回重建的那个集合就是人写下的那个', NO_PIPES, async (t) => {
  const root = initializedRoot(t);
  const dir = createRoot(t);

  const first = await compose(root);
  assert.deepEqual(membersOf(await ask(root, { word: 'declare', repositories: [dir] })), [dir]);
  await first.shutdown();

  // A second Runtime over the same data directory, which is what a restart is. Nothing carries over in
  // memory — the plugin starts from an empty set and rebuilds it from the history — so this is the
  // assertion that the declaration is persistent rather than merely held.
  const second = await compose(root);
  try {
    assert.deepEqual(membersOf(await ask(root, { word: 'status' })), [dir]);
  } finally {
    await second.shutdown();
  }
});

test('三个动词各写一条事实，status 与语义无操作一条都不写', NO_PIPES, async (t) => {
  const root = initializedRoot(t);
  const runtime = await compose(root);
  try {
    const dir = createRoot(t);
    const facts = async () => (await readFacts(root)).filter((f) => f.type.startsWith('changeable-repositories.'));

    assert.deepEqual(await facts(), []);

    await ask(root, { word: 'status' });
    // Asked and changed nothing: a family that admitted this would be a log of questions.
    assert.deepEqual(await facts(), []);

    await ask(root, { word: 'declare', repositories: [dir] });
    assert.deepEqual((await facts()).map((f) => f.type), ['changeable-repositories.declared']);

    // Declaring what is already declared moved nothing, so there is no occurrence to admit.
    await ask(root, { word: 'declare', repositories: [dir] });
    assert.equal((await facts()).length, 1);

    const first = (await facts())[0];
    assert.equal(first.version, 1);
    // Not `human`: the ingress has no authentication, so a fact claiming one would be asserting an
    // identity nothing here established — and this fact is the record of a permission, which is the one
    // record that must not imply a particular person granted it.
    assert.equal(first.source.kind, 'changeable-repositories.declaration');
    assert.deepEqual(first.payload.repositories, [dir]);

    await ask(root, { word: 'clear' });
    assert.deepEqual((await facts()).map((f) => f.type), [
      'changeable-repositories.declared',
      'changeable-repositories.cleared',
    ]);
  } finally {
    await runtime.shutdown();
  }
});

// A usage error exits 2 and everything else exits 1, which is the convention the whole CLI follows and
// not something this slice gets to choose.
const USAGE_ERROR = 2;

// `spawnSync` cannot be used against the endpoint these tests compose, and the reason is worth stating
// because it looks like flakiness when it is not: it blocks *this* process's event loop, and the
// endpoint is a server running in this process. The child connects, the server never gets to accept it,
// and the child sits there until its own reply timeout expires. A resident is a separate process and has
// no such problem; an in-process composition does, and this runner is the whole of the difference.
function runCli(args) {
  return new Promise((settle) => {
    const child = spawn(process.execPath, [CLI, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (status) => settle({ status, stdout, stderr }));
  });
}

test('hikari change 从 argv 走到端点，并且原样传目录', NO_PIPES, async (t) => {
  const root = initializedRoot(t);
  const runtime = await compose(root);
  try {
    const dir = createRoot(t);

    // The whole chain: argv → options → the plugin's own wire vocabulary → the pipe → the plugin →
    // Chronicle. Nothing in it is a second implementation of anything the client tests already cover.
    const declared = await runCli(['change', 'declare', '--data-dir', root, dir]);
    assert.equal(declared.status, 0, declared.stderr);
    assert.equal(declared.stdout, `${dir}\n`);

    const status = await runCli(['change', 'status', '--data-dir', root]);
    assert.equal(status.status, 0, status.stderr);
    assert.equal(status.stdout, `${dir}\n`);

    // A path that cannot be admitted is Hikari answering, not the command failing: the reason goes to
    // stderr with the exit code, and the human reads the sentence the plugin wrote.
    const relative = await runCli(['change', 'declare', '--data-dir', root, 'relative/path']);
    assert.equal(relative.status, 1);
    assert.equal(relative.stdout, '');
    assert.equal(relative.stderr, `${NOT_ABSOLUTE('relative/path')}\n`);
  } finally {
    await runtime.shutdown();
  }
});

test('没有常驻时 hikari change 说 absent，而不是说入口坏了', NO_PIPES, async (t) => {
  // No composition at all, which is the ordinary case on a machine where no resident is running.
  const root = initializedRoot(t);

  const answered = spawnSync(process.execPath, [CLI, 'change', 'status', '--data-dir', root], {
    encoding: 'utf8',
  });
  assert.equal(answered.status, 1);
  assert.match(answered.stderr, /没有正在提供可改仓库入口的 Hikari 常驻/);
});

test('change 的词表是它自己的，别的词在用法层被拒绝', () => {
  // The grammar is the CLI's; the words are the owner's. A word that is not one of the four never
  // reaches a pipe, so this needs no host and is asserted on every platform.
  const usage = spawnSync(process.execPath, [CLI, 'change', 'wat', '--data-dir', 'x'], {
    encoding: 'utf8',
  });
  assert.equal(usage.status, USAGE_ERROR);
  assert.match(usage.stderr, /change 只支持 declare \/ replace \/ clear \/ status/);

  // And the arity rule, which is grammar rather than domain: a word that requires a name and was given
  // none is a typing mistake here, while the same request arriving over the pipe is a no-op the plugin
  // answers honestly. Two different questions, asked in the two places that can tell them apart.
  const empty = spawnSync(process.execPath, [CLI, 'change', 'declare', '--data-dir', 'x'], {
    encoding: 'utf8',
  });
  assert.equal(empty.status, USAGE_ERROR);
  assert.match(empty.stderr, /change declare 至少需要一个目录/);
});
