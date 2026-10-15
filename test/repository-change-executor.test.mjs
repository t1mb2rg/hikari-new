// The executor's own tests: the parts that decide, and the one function that puts them in order.
//
// These tests never push and never touch a remote. The repositories they make are throwaway working
// trees under the system temp directory, and the executor is given a runner the test wrote — which is
// the whole point of the runner being a parameter: the deciding can be tested without anything able to
// change the world. What cannot be tested this way is the model loop, which does not exist yet.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  EXECUTOR_IDENTITY,
  REPOSITORY_CHANGE_FACT_TYPES,
  REPOSITORY_CHANGE_TOOLS,
  containTarget,
  createRepositoryChangeExecutorPlugin,
  createRepositoryChangeRunner,
  executeRepositoryChange,
  findTool,
  judgeOutcome,
  mandateFactDraft,
  performTool,
  readToolArguments,
  repositoryNameFromUrl,
  resolveDeclaredRoot,
  resultFactDraft,
  toModelTools,
} from '../dist/repository-change-executor/index.js';
import { changeableRepositoriesReadService } from '../dist/changeable-repositories/index.js';
import { chronicleService } from '../dist/chronicle/index.js';
import { gitHubCiService } from '../dist/github-ci/index.js';
import { requestRepositoryChange } from '../dist/cli/act.js';

const MANDATE_FACT_TYPE = 'repository-change-executor.mandate';
const RESULT_FACT_TYPE = 'repository-change-executor.result';

/** A real git working tree under the temp directory, named as a GitHub repository by its origin. */
function makeRepository(repository = 't1mb2rg/demo-repository') {
  const dir = mkdtempSync(join(tmpdir(), 'hikari-change-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'executor-test@example.invalid']);
  git(dir, ['config', 'user.name', 'Executor Test']);
  writeFileSync(join(dir, 'README.md'), '# demo\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'init']);
  git(dir, ['remote', 'add', 'origin', `https://github.com/${repository}.git`]);
  return dir;
}

function git(dir, args) {
  execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
}

/**
 * The 8.3 spelling of a path, or the path itself when the volume has no shorter name for it.
 *
 * This exists because the failure it guards against happened: on a Windows runner `%TEMP%` came back
 * as `C:\Users\RUNNER~1\...` while git answered `--show-toplevel` with the long spelling of the same
 * directory, and a comparison that only folded case and separators called them two different places.
 * The probe is `cmd`'s own `%~s` modifier rather than anything this build computes, so the test asks
 * the platform for a short name instead of inventing one.
 */
function shortPathOf(dir) {
  // Quoted `for` variables are read back as relative to the current drive by `cmd`, which is how this
  // probe first produced `G:\"C:\...\"` — a string that is neither path. Unquoted, with the result
  // checked by the caller rather than trusted, it answers what the platform actually calls the folder.
  const out = execFileSync('cmd', ['/c', `for %I in (${dir}) do @echo %~sI`], { encoding: 'utf8' });
  return out.trim().replace(/^"|"$/gu, '');
}

/** The read half, as the executor sees it. `read`/`search` throw so a call to them is a failure. */
function readDeclaring(roots) {
  return {
    roots: async () => roots,
    read: async () => {
      throw new Error('the executor must not call read()');
    },
    search: async () => {
      throw new Error('the executor must not call search()');
    },
  };
}

function snapshotOf(overrides) {
  return { readable: true, head: 'a'.repeat(40), statusDigest: 'clean', unpushed: 0, ...overrides };
}

test('三态：HEAD 或工作区变了就是 changed，两者都没变才是 unchanged', () => {
  const base = snapshotOf({});
  assert.equal(judgeOutcome(base, snapshotOf({ head: 'b'.repeat(40) })).outcome, 'changed');
  assert.equal(judgeOutcome(base, snapshotOf({ statusDigest: 'dirty' })).outcome, 'changed');
  assert.equal(judgeOutcome(base, base).outcome, 'unchanged');
});

test('三态：读不到仓库状态就是 unknown，任何一侧读不到都一样', () => {
  const base = snapshotOf({});
  const unreadable = snapshotOf({ readable: false, head: undefined, statusDigest: undefined, unpushed: undefined });
  assert.equal(judgeOutcome(unreadable, base).outcome, 'unknown');
  assert.equal(judgeOutcome(base, unreadable).outcome, 'unknown');
  assert.equal(judgeOutcome(unreadable, unreadable).outcome, 'unknown');
});

test('判定本身没有把 unknown 变成 unchanged 的分支', () => {
  // Every combination of unreadable-ness, including the one that looks most like "nothing happened".
  const pairs = [
    [snapshotOf({ readable: false }), snapshotOf({})],
    [snapshotOf({}), snapshotOf({ readable: false })],
    [snapshotOf({ readable: false }), snapshotOf({ readable: false })],
  ];
  for (const [before, after] of pairs) {
    assert.notEqual(judgeOutcome(before, after).outcome, 'unchanged');
  }
});

test('push 被观察为「未推送的提交变少」，而不是「之后为零」', () => {
  assert.equal(judgeOutcome(snapshotOf({ unpushed: 5 }), snapshotOf({ unpushed: 2 })).outcome, 'changed');
  assert.equal(judgeOutcome(snapshotOf({ unpushed: 5 }), snapshotOf({ unpushed: 2 })).pushed, true);
  // Zero afterwards but nothing was ever unpushed: no push was observed.
  assert.equal(judgeOutcome(snapshotOf({ unpushed: 0 }), snapshotOf({ unpushed: 0 })).outcome, 'unchanged');
  assert.equal(judgeOutcome(snapshotOf({ unpushed: 0 }), snapshotOf({ unpushed: 0 })).pushed, false);
});

test('push：同步仓库里 commit 再 push，计数 0→0，只有「新提交在远端上」看得见', () => {
  // The shape a count alone cannot see, and the one an ordinary "改掉它然后提交推上去" starts from: the
  // repository is already in sync, so the commit raises the count and the push lowers it back to zero
  // inside one run. A record that answered "did not push" here would be a record that lies about a step
  // nobody can take back.
  const before = snapshotOf({ head: 'a'.repeat(40), onRemote: true });
  assert.equal(judgeOutcome(before, snapshotOf({ head: 'b'.repeat(40), onRemote: true })).pushed, true);
  assert.equal(judgeOutcome(before, snapshotOf({ head: 'b'.repeat(40), onRemote: true })).outcome, 'changed');

  // The same move without the push: a new local commit no remote has. `false` here is a real answer, and
  // it is the difference between "it did not push" and "nobody could tell".
  assert.equal(judgeOutcome(before, snapshotOf({ head: 'b'.repeat(40), onRemote: false })).pushed, false);

  // And when the remote list could not be read at all, the answer is the third one.
  assert.equal(judgeOutcome(before, snapshotOf({ head: 'b'.repeat(40), onRemote: undefined })).pushed, undefined);
});

test('三态：两侧都读不到时，pushed 是「无法核对」而不是「没推」', () => {
  const unreadable = snapshotOf({
    readable: false,
    head: undefined,
    statusDigest: undefined,
    unpushed: undefined,
    onRemote: undefined,
  });
  const judgement = judgeOutcome(snapshotOf({}), unreadable);

  assert.equal(judgement.outcome, 'unknown');
  assert.equal(judgement.readable, false);
  assert.equal(judgement.pushed, undefined);
});

test('containment：声明根之内是 inside，之外的一切都不是', () => {
  const root = join(tmpdir(), 'hikari-contain-root');
  mkdirSync(root, { recursive: true });
  assert.equal(containTarget(root, 'src/file.ts').kind, 'inside');
  assert.equal(containTarget(root, '../outside.ts').kind, 'outside');
  assert.equal(containTarget(root, 'src/../../outside.ts').kind, 'outside');
  assert.equal(containTarget(root, '').kind, 'outside');
});

test('containment：.git 不是工作区的一部分，写在里面的路径一律不是 inside', () => {
  const root = join(tmpdir(), 'hikari-contain-git');
  mkdirSync(root, { recursive: true });

  // Two ways a path into `.git` would have handed back a capability the tool table exists to withhold:
  // `hooks/pre-commit` runs on the executor's very next `git commit` (so the executor would have a shell
  // it was never given, without committing anything), and `refs/remotes/…` is what the outcome judgement
  // reads to answer "was this pushed" (so the thing being judged could write its own judge).
  assert.equal(containTarget(root, '.git/hooks/pre-commit').kind, 'outside');
  assert.equal(containTarget(root, '.git/config').kind, 'outside');
  assert.equal(containTarget(root, '.git/refs/remotes/origin/main').kind, 'outside');
  assert.equal(containTarget(root, '.git').kind, 'outside');
  // Folded, and per segment rather than as a prefix of the whole path.
  assert.equal(containTarget(root, '.GIT/hooks/pre-commit').kind, 'outside');
  assert.equal(containTarget(root, 'sub/.git/config').kind, 'outside');
  // A file whose *name* starts with `.git` is not the directory.
  assert.equal(containTarget(root, '.gitignore').kind, 'inside');
});

test('containment：经链接落进 .git 的路径也被拒（字面上没有 .git 的那个词）', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'hikari-contain-gitlink-'));
  mkdirSync(join(root, '.git', 'hooks'), { recursive: true });

  // A directory link inside the root that points at `.git`: the target is spelled `escape/hooks/...`,
  // and only the resolved path contains `.git`. Creating a link needs a privilege or developer mode on
  // Windows, so the test is skipped where it cannot be made rather than being written around.
  let linked = true;
  try {
    symlinkSync(join(root, '.git'), join(root, 'escape'), 'junction');
  } catch {
    linked = false;
  }

  if (!linked) {
    t.skip('此平台上无法创建链接，跳过');
    return;
  }

  assert.equal(containTarget(root, 'escape/hooks/pre-commit').kind, 'outside');
});

test('工具：写 .git 里的文件被拒，而且磁盘上什么都没发生', async () => {
  const dir = makeRepository('t1mb2rg/write-into-git');

  const answer = await perform('write_file', { path: '.git/hooks/pre-commit', content: 'whatever' }, dir);

  assert.equal(answer.ok, false);
  assert.equal(answer.content.includes('.git'), true);
  assert.equal(existsSync(join(dir, '.git', 'hooks', 'pre-commit')), false);
});

test('containment：绝对路径一律拒绝，即使它指在根里面', () => {
  const root = join(tmpdir(), 'hikari-contain-abs');
  mkdirSync(root, { recursive: true });
  const absolute = join(root, 'src', 'file.ts');
  assert.equal(containTarget(root, absolute).kind, 'outside');
});

test('containment：子目录不因为名字前缀相同就算在里面', () => {
  const root = join(tmpdir(), 'hikari-contain-prefix');
  mkdirSync(root, { recursive: true });
  assert.equal(containTarget(root, 'sub-file.ts').kind, 'inside');
  assert.notEqual(containTarget(root, '..').kind, 'inside');
});

test('containment：从根里的一条链接绕出去算 outside，而不是算在里面', () => {
  // The classic bypass, and the one no `..`-based check catches: every segment of `escape/secret.txt` is
  // under the root as *written*, and the path contains nothing that looks like an escape — but one of the
  // segments is a link, so the file the operating system would open is not under the root at all. A
  // junction is used on Windows because it can be made without elevation, which is what the sibling read
  // suite does for the same reason.
  const root = mkdtempSync(join(tmpdir(), 'hikari-contain-link-'));
  const outside = mkdtempSync(join(tmpdir(), 'hikari-contain-away-'));
  writeFileSync(join(outside, 'secret.txt'), 'not yours\n');
  symlinkSync(outside, join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');

  assert.equal(containTarget(root, 'escape/secret.txt').kind, 'outside');
  assert.equal(containTarget(root, 'escape').kind, 'outside');
  // Next to it, an ordinary name is still inside: this is about the link, not about refusing whatever
  // happens to exist on disk.
  assert.equal(containTarget(root, 'plain.txt').kind, 'inside');
});

test('工具：通过链接写到根目录外面被拒，磁盘上什么都没发生', async () => {
  const dir = makeRepository('t1mb2rg/refuses-link-write');
  const outside = mkdtempSync(join(tmpdir(), 'hikari-link-target-'));
  symlinkSync(outside, join(dir, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');

  const written = await perform('write_file', { path: 'escape/written.txt', content: 'nope' }, dir);

  assert.equal(written.refused, true);
  assert.equal(existsSync(join(outside, 'written.txt')), false);
  // And reading through the same link is refused too, so the link is not a way to look outside either.
  const read = await perform('read_file', { path: 'escape/secret.txt' }, dir);
  assert.equal(read.refused, true);
});

test('repositoryNameFromUrl：认四种 GitHub 拼写，不认别的', () => {
  assert.equal(repositoryNameFromUrl('https://github.com/t1mb2rg/hikari-new.git'), 't1mb2rg/hikari-new');
  assert.equal(repositoryNameFromUrl('https://github.com/t1mb2rg/hikari-new'), 't1mb2rg/hikari-new');
  assert.equal(repositoryNameFromUrl('git@github.com:t1mb2rg/hikari-new.git'), 't1mb2rg/hikari-new');
  assert.equal(repositoryNameFromUrl('ssh://git@github.com/t1mb2rg/hikari-new.git'), 't1mb2rg/hikari-new');
  assert.equal(repositoryNameFromUrl('https://gitlab.com/t1mb2rg/hikari-new.git'), undefined);
  assert.equal(repositoryNameFromUrl('https://github.com/t1mb2rg'), undefined);
  assert.equal(repositoryNameFromUrl('https://github.com/a/b/c'), undefined);
});

test('范围：声明里的根按 origin 的仓库名逐字命中才算 declared', async () => {
  const dir = makeRepository('t1mb2rg/declared-one');
  const resolution = await resolveDeclaredRoot('t1mb2rg/declared-one', [dir]);
  assert.equal(resolution.kind, 'declared', resolution.kind === 'not-declared' ? resolution.reason : '');
  assert.equal(resolution.root, dir);
});

test('范围：同一目录的短名与长名是同一个根（Windows 的 8.3 名字）', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('8.3 短名只在 Windows 上有意义');
    return;
  }
  const dir = makeRepository('t1mb2rg/short-name');
  const short = shortPathOf(dir);
  if (short === dir || !existsSync(short)) {
    t.skip('这个卷没有给这个目录取短名，这条比较无处可测');
    return;
  }

  // 声明写的是短名，git 回答的是长名：一个目录的两个拼写，不能因此变成两个地方。
  const resolution = await resolveDeclaredRoot('t1mb2rg/short-name', [short]);
  assert.equal(resolution.kind, 'declared', resolution.kind === 'not-declared' ? resolution.reason : '');
});

test('范围：没有声明、或者声明的根本不是它，都是 not-declared 并且说得出理由', async () => {
  const dir = makeRepository('t1mb2rg/declared-two');
  const empty = await resolveDeclaredRoot('t1mb2rg/declared-two', []);
  assert.equal(empty.kind, 'not-declared');

  const other = await resolveDeclaredRoot('t1mb2rg/declared-three', [dir]);
  assert.equal(other.kind, 'not-declared');

  // 逐字：大小写不同不是同一个仓库名。
  const cased = await resolveDeclaredRoot('T1MB2RG/declared-two', [dir]);
  assert.equal(cased.kind, 'not-declared');
});

test('工具表：三个写工具就是那三个动词，没有 shell、没有删除、没有网络', () => {
  const writes = REPOSITORY_CHANGE_TOOLS.filter((tool) => tool.effect === 'write').map((tool) => tool.name);
  assert.deepEqual([...writes].sort(), ['git_commit', 'git_push', 'write_file']);

  for (const forbidden of ['shell', 'run_command', 'delete_file', 'fetch_url', 'git_reset']) {
    assert.equal(findTool(forbidden), undefined, `${forbidden} 不在表里`);
  }
});

test('工具表：表外的名字是「从未听说过」，不是「参数不对」', () => {
  assert.equal(findTool('read_file')?.effect, 'read');
  assert.equal(findTool('anything_else'), undefined);
});

test('工具表：模型看到的 schema 由这张表生成，并且不允许额外字段', () => {
  const schemas = toModelTools();
  assert.equal(schemas.length, REPOSITORY_CHANGE_TOOLS.length);
  for (const schema of schemas) {
    assert.equal(schema.type, 'function');
    assert.equal(schema.function.parameters.additionalProperties, false);
    const declared = REPOSITORY_CHANGE_TOOLS.find((tool) => tool.name === schema.function.name);
    assert.deepEqual(
      [...schema.function.parameters.required],
      declared.fields.map((field) => field.name),
    );
  }
});

test('工具参数：不是对象、缺字段、不是 JSON，都算 malformed', () => {
  const write = findTool('write_file');
  assert.equal(readToolArguments('{"path":"a.ts","content":"x"}', write).kind, 'given');
  assert.equal(readToolArguments('{"path":"a.ts"}', write).kind, 'malformed');
  assert.equal(readToolArguments('[1,2]', write).kind, 'malformed');
  assert.equal(readToolArguments('not json', write).kind, 'malformed');
  assert.equal(readToolArguments('{"path":1,"content":"x"}', write).kind, 'malformed');
});

test('事实：两个 kind、两个来源，mandate 逐字不改写', () => {
  const draft = mandateFactDraft({ repository: 't1mb2rg/x', mandate: '  把 README 改一下  ' });
  assert.equal(draft.type, MANDATE_FACT_TYPE);
  assert.equal(draft.version, 1);
  assert.equal(draft.source.kind, 'repository-change-executor.mandate-ingress');
  assert.equal(draft.payload.mandate, '  把 README 改一下  ');
  assert.equal(draft.payload.executor, EXECUTOR_IDENTITY);
  assert.equal(REPOSITORY_CHANGE_FACT_TYPES.mandate, MANDATE_FACT_TYPE);
});

test('事实：结果事实里没有 halt 字段就是「没有 halt」，有就是那一个词', () => {
  const without = resultFactDraft({
    repository: 't1mb2rg/x',
    outcome: 'changed',
    halt: undefined,
    evidence: { headBefore: 'a', headAfter: 'b', dirtyBefore: false, dirtyAfter: false, pushed: false, ciRunId: undefined, ciChecked: false },
  });
  assert.equal(without.type, RESULT_FACT_TYPE);
  assert.equal(without.source.kind, 'repository-change-executor.run');
  assert.equal('halt' in without.payload, false);
  assert.equal(without.payload.outcome, 'changed');

  const with_ = resultFactDraft({
    repository: 't1mb2rg/x',
    outcome: 'unknown',
    halt: 'executor-failed',
    evidence: { headBefore: undefined, headAfter: undefined, dirtyBefore: undefined, dirtyAfter: undefined, pushed: false, ciRunId: undefined, ciChecked: false },
  });
  assert.equal(with_.payload.halt, 'executor-failed');
  assert.equal(with_.payload.headBefore, null);
});

test('执行：空 mandate 什么都不做，也不留事实', async () => {
  const dir = makeRepository('t1mb2rg/empty-mandate');
  const execution = await executeRepositoryChange({
    request: { repository: 't1mb2rg/empty-mandate', mandate: '   ' },
    read: readDeclaring([dir]),
    runner: { run: async () => assert.fail('runner 不该被调用') },
    runTimeoutMs: 5_000,
  });

  assert.equal(execution.result.outcome, 'unchanged');
  assert.equal(execution.result.halt, 'mandate-empty');
  assert.deepEqual(execution.facts, []);
});

test('执行：仓库没被声明就不启动，但「人被要求了什么」已经留下', async () => {
  const dir = makeRepository('t1mb2rg/not-declared');
  let ran = 0;
  const execution = await executeRepositoryChange({
    request: { repository: 't1mb2rg/something-else', mandate: '改一下 README' },
    read: readDeclaring([dir]),
    runner: {
      run: async () => {
        ran += 1;
        return { steps: [], toolCalls: 0, pushed: false, notes: [], refusedCalls: [] };
      },
    },
    runTimeoutMs: 5_000,
  });

  assert.equal(ran, 0);
  assert.equal(execution.result.outcome, 'unchanged');
  assert.equal(execution.result.halt, 'repository-not-declared');
  assert.equal(execution.facts.length, 1);
  assert.equal(execution.facts[0].type, MANDATE_FACT_TYPE);
  assert.equal(execution.facts[0].payload.mandate, '改一下 README');
});

test('执行：声明的根不是 git 工作区时，它不构成一条声明', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hikari-not-a-repo-'));
  const execution = await executeRepositoryChange({
    request: { repository: 't1mb2rg/whatever', mandate: '改一下' },
    read: readDeclaring([dir]),
    runner: { run: async () => assert.fail('runner 不该被调用') },
    runTimeoutMs: 5_000,
  });

  // 一个不是 git 工作区的目录回答不了「它是哪个仓库」，所以它证明不了这个仓库被声明过。
  // `repository-unreachable` 留给正常解析之后的意外——目录在解析与执行之间消失。
  assert.equal(execution.result.outcome, 'unchanged');
  assert.equal(execution.result.halt, 'repository-not-declared');
});

test('执行：没有配置执行者时说得出来，而不是假装「没有改动」是因为别的原因', async () => {
  const dir = makeRepository('t1mb2rg/no-runner');
  const before = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const execution = await executeRepositoryChange({
    request: { repository: 't1mb2rg/no-runner', mandate: '改一下' },
    read: readDeclaring([dir]),
    runner: undefined,
    runTimeoutMs: 5_000,
  });

  const after = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(before, after);
  assert.equal(execution.result.outcome, 'unchanged');
  assert.equal(execution.result.halt, 'executor-unavailable');
  assert.equal(execution.facts.length, 1);
});

test('执行：假执行者写了文件，就是 changed，而且证据来自仓库自己的状态', async () => {
  const dir = makeRepository('t1mb2rg/wrote-a-file');
  const execution = await executeRepositoryChange({
    request: { repository: 't1mb2rg/wrote-a-file', mandate: '加一个文件' },
    read: readDeclaring([dir]),
    runner: {
      run: async (request) => {
        writeFileSync(join(request.root, 'note.txt'), 'hello\n');
        return { steps: ['write_file'], toolCalls: 1, pushed: false, notes: [], refusedCalls: [] };
      },
    },
    runTimeoutMs: 5_000,
  });

  assert.equal(execution.result.outcome, 'changed');
  assert.equal(execution.result.halt, undefined);
  assert.equal(execution.result.evidence.dirtyBefore, false);
  assert.equal(execution.result.evidence.dirtyAfter, true);
  assert.equal(execution.result.evidence.pushed, false);
  assert.equal(execution.facts.length, 2);
  assert.equal(execution.facts[1].type, RESULT_FACT_TYPE);
  assert.equal(execution.facts[1].payload.outcome, 'changed');
  assert.equal(execution.result.lines.some((line) => line.includes('已按你的原句')), true);
});

test('执行：假执行者什么都没做，就是 unchanged', async () => {
  const dir = makeRepository('t1mb2rg/did-nothing');
  const execution = await executeRepositoryChange({
    request: { repository: 't1mb2rg/did-nothing', mandate: '什么也别改' },
    read: readDeclaring([dir]),
    runner: { run: async () => ({ steps: [], toolCalls: 0, pushed: false, notes: [], refusedCalls: [] }) },
    runTimeoutMs: 5_000,
  });

  assert.equal(execution.result.outcome, 'unchanged');
  assert.equal(execution.result.halt, undefined);
  assert.equal(execution.facts[1].payload.outcome, 'unchanged');
});

test('执行：执行者失败而仓库没有痕迹 —— 是 unknown，绝不是 unchanged', async () => {
  const dir = makeRepository('t1mb2rg/broke');
  const execution = await executeRepositoryChange({
    request: { repository: 't1mb2rg/broke', mandate: '改一下' },
    read: readDeclaring([dir]),
    runner: {
      run: async () => {
        throw new Error('executor exploded');
      },
    },
    runTimeoutMs: 5_000,
  });

  assert.equal(execution.result.outcome, 'unknown');
  assert.equal(execution.result.halt, 'executor-failed');
  assert.equal(execution.facts[1].payload.outcome, 'unknown');
  assert.equal(execution.result.lines[0].startsWith('无法确定'), true);
  assert.equal(execution.result.lines.some((line) => line.startsWith('没有改动')), false);
});

test('执行：超出时间预算也是 unknown，并且说的是「被中止」', async () => {
  const dir = makeRepository('t1mb2rg/timed-out');
  const execution = await executeRepositoryChange({
    request: { repository: 't1mb2rg/timed-out', mandate: '改一下' },
    read: readDeclaring([dir]),
    runner: {
      run: async () =>
        new Promise((settle) => {
          setTimeout(() => settle({ steps: [], toolCalls: 0, pushed: false, notes: [], refusedCalls: [] }), 5_000);
        }),
    },
    runTimeoutMs: 30,
  });

  assert.equal(execution.result.outcome, 'unknown');
  assert.equal(execution.result.halt, 'executor-timed-out');
  assert.equal(execution.result.lines.some((line) => line.includes('时间预算')), true);
});

test('执行：执行者说它 push 了不算数，只有 git 说才算数', async () => {
  const dir = makeRepository('t1mb2rg/claims-push');
  const execution = await executeRepositoryChange({
    request: { repository: 't1mb2rg/claims-push', mandate: '推上去' },
    read: readDeclaring([dir]),
    runner: {
      run: async () => ({ steps: ['git_push'], toolCalls: 1, pushed: true, notes: [], refusedCalls: [] }),
    },
    runTimeoutMs: 5_000,
  });

  // 它自称 push 了，但没有任何远端收到东西，因此证据栏是 false，结果也还是 unchanged。
  assert.equal(execution.result.evidence.pushed, false);
  assert.equal(execution.result.outcome, 'unchanged');
  assert.equal(execution.result.report.pushed, true);
});

// --- 工具：模型能做的动作，一个一个地做 ---

const BUDGETS = { timeoutMs: 10_000, maxBytes: 1024 * 1024 };

/** One call to one tool, with the shape `performTool` insists on and nothing else spelled out twice. */
function perform(name, values, root, extra = {}) {
  return performTool({
    tool: findTool(name, REPOSITORY_CHANGE_TOOLS),
    values,
    root,
    readCi: undefined,
    budgets: BUDGETS,
    signal: undefined,
    ...extra,
  });
}

test('工具：读文件给出带行号的文本，范围就是那个工作目录', async () => {
  const dir = makeRepository('t1mb2rg/reads');
  const answer = await perform('read_file', { path: 'README.md' }, dir);

  assert.equal(answer.ok, true);
  assert.equal(answer.content.includes('1  # demo'), true);
});

test('工具：越界读被拒，答案里说的是范围而不是磁盘', async () => {
  const dir = makeRepository('t1mb2rg/refuses-read');
  const outside = join(dir, '..', 'anything.txt');
  const answer = await perform('read_file', { path: outside }, dir);

  assert.equal(answer.ok, false);
  assert.equal(answer.refused, true);
  assert.equal(answer.content.includes('不在这次运行被允许改的那个工作目录里'), true);
});

test('工具：越界写被拒，而且磁盘上什么都没发生', async () => {
  const dir = makeRepository('t1mb2rg/refuses-write');
  const outside = join(dir, '..', `written-${Date.now()}.txt`);
  const answer = await perform('write_file', { path: outside, content: 'nope' }, dir);

  assert.equal(answer.refused, true);
  assert.equal(existsSync(outside), false);
});

test('工具：写文件在工作目录里真的落笔', async () => {
  const dir = makeRepository('t1mb2rg/writes');
  const answer = await perform('write_file', { path: 'notes/today.md', content: '# 今天\n' }, dir);

  assert.equal(answer.ok, true);
  assert.equal(existsSync(join(dir, 'notes', 'today.md')), true);
});

test('工具：列目录把子目录和文件分开，且顺序是稳定的', async () => {
  const dir = makeRepository('t1mb2rg/lists');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'zeta.txt'), 'z\n');

  const answer = await perform('list_directory', { path: '.' }, dir);

  assert.equal(answer.ok, true);
  assert.equal(answer.content.includes('src/'), true);
  assert.equal(answer.content.includes('zeta.txt'), true);
  assert.equal(answer.content.indexOf('README.md') < answer.content.indexOf('src/'), true);
});

test('工具：git_status 与 git_diff 说的是仓库自己的话', async () => {
  const dir = makeRepository('t1mb2rg/git-tools');
  writeFileSync(join(dir, 'new.txt'), 'hello\n');

  const status = await perform('git_status', {}, dir);
  const diff = await perform('git_diff', {}, dir);

  assert.equal(status.ok, true);
  assert.equal(status.content.includes('?? new.txt'), true);
  assert.equal(diff.ok, true);
  assert.equal(diff.content.includes('工作区与 HEAD 没有差异'), true);
});

test('工具：read_ci 没接就如实说没接，不假装读过', async () => {
  const dir = makeRepository('t1mb2rg/no-ci');
  const answer = await perform('read_ci', {}, dir);

  assert.equal(answer.ok, false);
  assert.equal(answer.content.includes('没有接 CI 读取'), true);
});

test('工具：接上 read_ci 时把它给的话原样带回来', async () => {
  const dir = makeRepository('t1mb2rg/with-ci');
  const answer = await perform('read_ci', {}, dir, { readCi: async () => 'run #7 failure' });

  assert.equal(answer.ok, true);
  assert.equal(answer.content.includes('run #7 failure'), true);
});

test('工具：二进制文件不会被当成文本交出去', async () => {
  const dir = makeRepository('t1mb2rg/binary');
  writeFileSync(join(dir, 'blob.bin'), Buffer.from([0x00, 0x01, 0x02, 0x00]));

  const answer = await perform('read_file', { path: 'blob.bin' }, dir);

  assert.equal(answer.ok, false);
  assert.equal(answer.content.includes('不是文本文件'), true);
});

test('工具：push 没有上游时如实失败，不 force 也不猜远端', async () => {
  const dir = makeRepository('t1mb2rg/no-upstream');
  const answer = await perform('git_push', {}, dir);

  assert.equal(answer.ok, false);
  assert.equal(answer.content.includes('git push'), true);
});

// --- 模型循环：它决定顺序，边界决定它能在哪里落笔 ---

/** A model whose answers are written out in advance, and which keeps what it was shown. */
function modelAnswering(turns) {
  const seen = [];
  let index = 0;
  return {
    seen,
    async step(request) {
      seen.push(request.messages.map((message) => message.role));
      const turn = turns[Math.min(index, turns.length - 1)];
      index += 1;
      return {
        content: turn.content ?? '',
        toolCalls: turn.toolCalls ?? [],
        reasoningContent: undefined,
        truncated: false,
      };
    },
    dispose() {},
  };
}

const call = (id, name, args) => ({ id, name, arguments: JSON.stringify(args) });

function runWith(model, root, options = {}) {
  const runner = createRepositoryChangeRunner(model, {
    stepBudget: 6,
    stepTimeoutMs: 5_000,
    runBudgetMs: 60_000,
    budgets: BUDGETS,
    readCi: undefined,
    ...options,
  });
  return runner.run({
    repository: 't1mb2rg/loops',
    root,
    mandate: '把 README 里的话补上',
    signal: new AbortController().signal,
  });
}

test('循环：模型不调工具就结束，没有停止原因', async () => {
  const dir = makeRepository('t1mb2rg/loop-done');
  const model = modelAnswering([{ content: '看过了，不需要改。' }]);
  const report = await runWith(model, dir);

  assert.equal(report.stopped, undefined);
  assert.equal(report.steps, 1);
  assert.deepEqual(report.toolCalls, []);
  assert.equal(report.notes.some((note) => note.includes('不需要改')), true);
});

test('循环：工具的答案回到会话里，带着它自己的 tool_call_id', async () => {
  const dir = makeRepository('t1mb2rg/loop-round-trip');
  const model = modelAnswering([
    { content: '', toolCalls: [call('c1', 'git_status', {})] },
    { content: '干净。' },
  ]);
  const report = await runWith(model, dir);

  assert.deepEqual(report.toolCalls, [{ name: 'git_status', outcome: 'ok' }]);
  assert.deepEqual(model.seen, [
    ['system', 'user'],
    ['system', 'user', 'assistant', 'tool'],
  ]);
  assert.equal(report.stopped, undefined);
});

test('循环：越界的路径被拒，拒绝进了报告也回到了模型面前', async () => {
  const dir = makeRepository('t1mb2rg/loop-refusal');
  const model = modelAnswering([
    { content: '', toolCalls: [call('c1', 'write_file', { path: '../escape.txt', content: 'x' })] },
    { content: '那我换个做法。' },
  ]);
  const report = await runWith(model, dir);

  assert.deepEqual(report.toolCalls, [{ name: 'write_file', outcome: 'refused' }]);
  assert.deepEqual(report.refusedCalls, ['write_file']);
  assert.equal(existsSync(join(dir, '..', 'escape.txt')), false);
});

test('循环：模型失败时停下，并说明是模型失败', async () => {
  const dir = makeRepository('t1mb2rg/loop-model-failed');
  const model = {
    async step() {
      throw new Error('endpoint said 500');
    },
    dispose() {},
  };
  const report = await runWith(model, dir);

  assert.equal(report.stopped.reason, 'model-failed');
  assert.equal(report.notes.some((note) => note.includes('endpoint said 500')), true);
});

test('循环：步数用尽时说是步数用尽，而不是装作做完了', async () => {
  const dir = makeRepository('t1mb2rg/loop-steps');
  const model = modelAnswering([{ content: '', toolCalls: [call('c1', 'git_status', {})] }]);
  const report = await runWith(model, dir, { stepBudget: 2 });

  assert.equal(report.stopped.reason, 'step-budget');
  assert.equal(report.stopped.atStep, 2);
  assert.equal(report.toolCalls.length, 2);
});

test('循环：一步迟迟不回来时不再等它，也不把这次运行说成失败', async () => {
  const dir = makeRepository('t1mb2rg/loop-timeout');
  const model = {
    step: () => new Promise(() => {}),
    dispose() {},
  };
  const report = await runWith(model, dir, { stepTimeoutMs: 30 });

  assert.equal(report.stopped.reason, 'step-timeout');
  assert.equal(report.pushed, false);
});

test('循环：表外的工具名被拒，并告诉它有哪些工具', async () => {
  const dir = makeRepository('t1mb2rg/loop-unknown-tool');
  const model = modelAnswering([
    { content: '', toolCalls: [call('c1', 'run_shell', { command: 'rm -rf /' })] },
    { content: '好吧。' },
  ]);
  const report = await runWith(model, dir);

  assert.deepEqual(report.toolCalls, [{ name: 'run_shell', outcome: 'refused' }]);
  assert.deepEqual(report.refusedCalls, ['run_shell']);
  assert.equal(report.stopped, undefined);
});

test('循环：参数不是 JSON 时被拒，没有替它猜', async () => {
  const dir = makeRepository('t1mb2rg/loop-bad-args');
  const model = modelAnswering([
    { content: '', toolCalls: [{ id: 'c1', name: 'read_file', arguments: '{oops' }] },
    { content: '重来。' },
  ]);
  const report = await runWith(model, dir);

  assert.deepEqual(report.toolCalls, [{ name: 'read_file', outcome: 'refused' }]);
  assert.equal(report.stopped, undefined);
});

test('循环 + 执行：假模型真的写了一个文件并提交，结果是 changed', async () => {
  const dir = makeRepository('t1mb2rg/loop-changes-world');
  const model = modelAnswering([
    { content: '', toolCalls: [call('c1', 'write_file', { path: 'notes.md', content: '# 记一笔\n' })] },
    { content: '', toolCalls: [call('c2', 'git_commit', { message: '记一笔' })] },
    { content: '写好了。' },
  ]);
  const runner = createRepositoryChangeRunner(model, {
    stepBudget: 6,
    stepTimeoutMs: 5_000,
    runBudgetMs: 60_000,
    budgets: BUDGETS,
    readCi: undefined,
  });
  const execution = await executeRepositoryChange({
    request: { repository: 't1mb2rg/loop-changes-world', mandate: '记一笔' },
    read: readDeclaring([dir]),
    runner,
    runTimeoutMs: 60_000,
  });

  assert.equal(execution.result.outcome, 'changed');
  assert.equal(existsSync(join(dir, 'notes.md')), true);
  assert.equal(execution.result.evidence.headBefore === execution.result.evidence.headAfter, false);
  // 两份事实都在，且结果那份写的是 changed —— 记录里说的是结果，不是模型的自述。
  assert.deepEqual(execution.facts.map((fact) => fact.type), [MANDATE_FACT_TYPE, RESULT_FACT_TYPE]);
  assert.equal(execution.facts[1].payload.outcome, 'changed');
});

test('推送被观察到之后，Hikari 自己事后去读一次 CI run 号，并把它写进证据', async () => {
  // A real push, to a bare repository on this machine: the point of this test is that `pushed` is git's
  // verdict rather than the runner's claim, so the push has to actually happen.
  const remote = mkdtempSync(join(tmpdir(), 'hikari-remote-'));
  git(remote, ['init', '-q', '--bare', '-b', 'main']);

  const dir = makeRepository('t1mb2rg/pushed-repository');
  // `makeRepository` gave it an origin naming the GitHub repository, and the declaration check reads
  // *that* name. The push goes to a second remote instead, so the origin keeps its GitHub spelling while
  // the branch really does arrive somewhere: `rev-list --not --remotes` counts every remote, not just the
  // origin, so this is a real push that leaves the real trace the judgement looks for.
  git(dir, ['remote', 'add', 'local', remote]);
  git(dir, ['push', '-q', '-u', 'local', 'main']);

  writeFileSync(join(dir, 'next.md'), '下一件事\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', '第二笔']);

  // An executor that only pushes. It reports `pushed: true`, and that report is *not* what settles it.
  const runner = {
    async run(request) {
      git(request.root, ['push', '-q', 'local', 'main']);
      return { steps: 1, toolCalls: [], pushed: true, notes: [], refusedCalls: [], stopped: undefined };
    },
  };

  let asked = 0;
  const execution = await executeRepositoryChange({
    request: { repository: 't1mb2rg/pushed-repository', mandate: '把这一笔推上去' },
    read: readDeclaring([dir]),
    runner,
    runTimeoutMs: 60_000,
    // §8's fifth ruling needs the number to come from outside the executor's own account, which is why it
    // arrives as this injection rather than being read by the runner's `read_ci` tool.
    readCi: async () => {
      asked += 1;
      return 4242;
    },
  });

  assert.equal(
    execution.result.evidence.pushed,
    true,
    `推送应当被 git 观察到：${JSON.stringify(execution.result.evidence)}｜${execution.result.lines.join(' ｜ ')}`,
  );
  assert.equal(execution.result.outcome, 'changed');
  assert.equal(asked, 1, '推送被观察到时才读，且只读一次');
  assert.equal(execution.result.evidence.ciRunId, 4242);
  assert.equal(execution.result.evidence.ciChecked, true);
  assert.ok(
    execution.result.lines.some((line) => line.includes('4242')),
    'CI run 号要出现在给人的话里',
  );
  assert.ok(
    execution.result.lines.some((line) => line.includes('不能收回')),
    '推了就是推了，这一句必须在',
  );
});

test('没有推送就不去问 CI，但记录里仍然写清「有没有人被问过」', async () => {
  const dir = makeRepository('t1mb2rg/quiet-repository');

  let asked = 0;
  const execution = await executeRepositoryChange({
    request: { repository: 't1mb2rg/quiet-repository', mandate: '什么也别做' },
    read: readDeclaring([dir]),
    runner: {
      async run() {
        return { steps: 0, toolCalls: [], pushed: false, notes: [], refusedCalls: [], stopped: undefined };
      },
    },
    runTimeoutMs: 60_000,
    readCi: async () => {
      asked += 1;
      return 1;
    },
  });

  assert.equal(execution.result.outcome, 'unchanged');
  assert.equal(asked, 0, '没有推送就不该去问 CI');
  assert.equal(execution.result.evidence.ciRunId, undefined);
  // `ciChecked` is about whether anyone was asked, and it stays true even though the question was never
  // put — the distinction the file keeps is between "no number" and "nobody looked".
  assert.equal(execution.result.evidence.ciChecked, true);
});

// ---------------------------------------------------------------------------
// 插件：整条路真的能跑起来
// ---------------------------------------------------------------------------

/**
 * The whole way through: a real plugin, activated, answering one instruction over its own pipe.
 *
 * This exists because of the mistake every other test in this file could not see. The unit tests all built
 * their runner by hand — `createRepositoryChangeRunner(fakeModel, …)` — so none of them passed through
 * `plugin.ts`, which handed `options.createModel` (a factory) to a parameter that wanted a model. A function
 * is structurally assignable to an object with a `step` method right up until you call it, so TypeScript was
 * satisfied and every run in the real composition ended `model-failed` with nothing written and a note the
 * human never saw. Green tests, dead feature. Only a test that goes in through `setup()` can tell.
 *
 * It also pins the *order* of the two writes: the mandate is on disk before anything can move, and the
 * result after the run ends.
 */
test('插件：真插件 + 假工厂跑完一轮，模型没失败、文件真的写下去了、事实按顺序落盘', {
  skip: process.platform === 'win32' ? false : '执行者入口是命名管道，这个平台上没有地方放它',
}, async () => {
  const repository = 't1mb2rg/plugin-e2e';
  const root = makeRepository(repository);
  const dataDir = mkdtempSync(join(tmpdir(), 'hikari-plugin-'));
  const appended = [];
  const cleanups = [];

  const model = modelAnswering([
    { toolCalls: [call('1', 'write_file', { path: 'NOTES.md', content: '按指示补的一句话\n' })] },
    { content: '写好了。' },
  ]);

  const plugin = createRepositoryChangeExecutorPlugin({
    dataDir,
    // The factory is what is under test: it has to be *called*. Handing it over uncalled is the one defect
    // that made every production run fail while every test stayed green.
    createModel: () => model,
    runTimeoutMs: 20_000,
  });

  const services = new Map([
    [changeableRepositoriesReadService, readDeclaring([root])],
    [
      chronicleService,
      {
        append: async (fact) => {
          appended.push(fact);
          return { ...fact };
        },
      },
    ],
    [gitHubCiService, { current: async () => ({ latestRun: { kind: 'absent' } }) }],
  ]);

  await plugin.setup(
    {
      pluginId: plugin.id,
      services: { get: (contract) => services.get(contract) },
      events: {},
      defer: (cleanup) => cleanups.push(cleanup),
    },
    undefined,
  );

  try {
    const answer = await requestRepositoryChange(dataDir, repository, '在仓库里补一条说明');

    assert.equal(answer.kind, 'answered');
    // `ok` is this protocol's word for *something moved*. With the factory passed instead of called, the
    // reply was `failed` and the file below was never created.
    assert.equal(answer.outcome, 'ok');
    assert.equal(existsSync(join(root, 'NOTES.md')), true);

    assert.deepEqual(
      appended.map((fact) => fact.type),
      [MANDATE_FACT_TYPE, RESULT_FACT_TYPE],
    );
  } finally {
    await Promise.all(cleanups.map((cleanup) => cleanup()));
  }
});

test('插件：同一个工厂出两个定义，接 CI 的那个多要一个 CI 契约，另一个不多要', () => {
  // This is the boundary decision of the freeze's §5 risk 3, pinned: a deployment that watches a
  // repository loads the definition that requires the CI observation, and a deployment that watches
  // nothing loads the one that requires only the two contracts it always needed. A single definition
  // with a hard CI requirement is what made every resident without a repository scope fail to come up.
  const dataDir = mkdtempSync(join(tmpdir(), 'hikari-definitions-'));

  const watching = createRepositoryChangeExecutorPlugin({ dataDir, watchesCi: true });
  const watchingNothing = createRepositoryChangeExecutorPlugin({ dataDir });

  assert.deepEqual(watching.requires, [
    changeableRepositoriesReadService,
    chronicleService,
    gitHubCiService,
  ]);
  assert.deepEqual(watchingNothing.requires, [changeableRepositoriesReadService, chronicleService]);
  assert.equal(watching.id, watchingNothing.id, '同一个 id：至多一个被加载');
  assert.equal(watching.provides.length, 0, '两个定义都不新增对外 contract');
});

test('插件 + CI：推上去的那一笔，CI run 号来自组合加载的观测，而不是执行者自己的说法', {
  skip: process.platform === 'win32' ? false : '执行者入口是命名管道，这个平台上没有地方放它',
}, async () => {
  const repository = 't1mb2rg/plugin-ci';
  const remote = mkdtempSync(join(tmpdir(), 'hikari-remote-'));
  git(remote, ['init', '-q', '--bare', '-b', 'main']);

  const root = makeRepository(repository);
  // Same shape as the execution-level push test: the origin keeps its GitHub spelling because the
  // declaration is read from it, and the real push goes to a local bare repository, which is what
  // `rev-list --not --remotes` can actually see.
  git(root, ['remote', 'add', 'local', remote]);
  git(root, ['push', '-q', '-u', 'local', 'main']);

  const dataDir = mkdtempSync(join(tmpdir(), 'hikari-plugin-ci-'));
  const appended = [];
  const cleanups = [];

  const model = modelAnswering([
    { toolCalls: [call('c1', 'read_ci', {})] },
    { toolCalls: [call('c2', 'write_file', { path: 'NOTES.md', content: '按指示补的一句话\n' })] },
    { toolCalls: [call('c3', 'git_commit', { message: '补一条说明' })] },
    { toolCalls: [call('c4', 'git_push', {})] },
    { content: '写好了，也推上去了。' },
  ]);

  const observation = {
    observedAt: '2026-10-16T00:00:00.000Z',
    source: 'github-ci',
    repository,
    latestRun: {
      kind: 'reported',
      run: {
        id: 42,
        workflow: 'test',
        headBranch: 'main',
        headSha: 'deadbeef',
        status: 'completed',
        conclusion: { kind: 'reported', value: 'success' },
      },
    },
  };

  let asked = 0;
  const services = new Map([
    [changeableRepositoriesReadService, readDeclaring([root])],
    [
      chronicleService,
      {
        append: async (fact) => {
          appended.push(fact);
          return { ...fact };
        },
      },
    ],
    [
      gitHubCiService,
      {
        current: async () => {
          asked += 1;
          return observation;
        },
      },
    ],
  ]);

  const plugin = createRepositoryChangeExecutorPlugin({
    dataDir,
    createModel: () => model,
    runTimeoutMs: 30_000,
    // The composition root's word, and the whole of what makes this the CI-aware definition.
    watchesCi: true,
  });

  await plugin.setup(
    {
      pluginId: plugin.id,
      services: { get: (contract) => services.get(contract) },
      events: {},
      defer: (cleanup) => cleanups.push(cleanup),
    },
    undefined,
  );

  try {
    const answer = await requestRepositoryChange(dataDir, repository, '把这一笔推上去');

    assert.equal(answer.kind, 'answered');
    assert.equal(answer.outcome, 'ok', answer.lines.join(' ｜ '));

    const result = appended.find((fact) => fact.type === RESULT_FACT_TYPE);
    assert.ok(result, `结果事实必须落盘：${JSON.stringify(appended)}`);
    assert.equal(result.payload.outcome, 'changed');
    assert.equal(result.payload.pushed, true, JSON.stringify(result.payload));
    assert.equal(result.payload.ciRunId, 42, JSON.stringify(result.payload));
    assert.equal(result.payload.ciChecked, true);
    // Twice, and both are the observation: once for the model's own `read_ci`, once for the number the
    // record carries. A definition that wired only one of the two would be caught right here.
    assert.equal(asked, 2, '模型问一次、记录问一次，都走同一个 CI 观测');
    assert.ok(existsSync(join(root, 'NOTES.md')), '这一轮真的写了文件');
  } finally {
    await Promise.all(cleanups.map((cleanup) => cleanup()));
  }
});
