// The executor's own tests: the parts that decide, and the one function that puts them in order.
//
// These tests never push and never touch a remote. The repositories they make are throwaway working
// trees under the system temp directory, and the executor is given a runner the test wrote — which is
// the whole point of the runner being a parameter: the deciding can be tested without anything able to
// change the world. What cannot be tested this way is the model loop, which does not exist yet.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  EXECUTOR_IDENTITY,
  REPOSITORY_CHANGE_FACT_TYPES,
  REPOSITORY_CHANGE_TOOLS,
  containTarget,
  executeRepositoryChange,
  findTool,
  judgeOutcome,
  mandateFactDraft,
  readToolArguments,
  repositoryNameFromUrl,
  resolveDeclaredRoot,
  resultFactDraft,
  toModelTools,
} from '../dist/repository-change-executor/index.js';

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
  assert.equal(judgeOutcome(snapshotOf({ unpushed: 0 }), snapshotOf({ unpushed: 0 })).pushed, false);
  // Zero afterwards but nothing was ever unpushed: no push was observed.
  assert.equal(judgeOutcome(snapshotOf({ unpushed: 0 }), snapshotOf({ unpushed: 0 })).outcome, 'unchanged');
});

test('containment：声明根之内是 inside，之外的一切都不是', () => {
  const root = join(tmpdir(), 'hikari-contain-root');
  mkdirSync(root, { recursive: true });
  assert.equal(containTarget(root, 'src/file.ts').kind, 'inside');
  assert.equal(containTarget(root, '../outside.ts').kind, 'outside');
  assert.equal(containTarget(root, 'src/../../outside.ts').kind, 'outside');
  assert.equal(containTarget(root, '').kind, 'outside');
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
