import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';

import { requestRelevance } from '../dist/cli/relevance.js';
import { Runtime } from '../dist/index.js';
import { repositoryCiAwarenessService } from '../dist/repository-ci-awareness/index.js';
import {
  RELEVANCE_PROTOCOL_VERSION,
  judgeRelevance,
  relevanceEndpointPath,
  repositoryCiRelevancePlugin,
} from '../dist/repository-ci-relevance/index.js';
import { workFocusCurrentService } from '../dist/work-focus/index.js';

// Two halves, deliberately in one file because they are two views of one rule.
//
// The truth table runs everywhere, and it can because the judgement is a pure function of two values
// that are already public. The endpoint tests need a named pipe and run only where there is one.
// Splitting them would have been tidier and would have put the frozen v1 rule on the side of the
// split that CI does not run.
const NO_PIPES = process.platform === 'win32' ? false : '命名管道只在 Windows 上存在';

const CANONICAL = 't1mb2rg/hikari-new';
const HEAD_COMMIT = 'a'.repeat(40);
const OTHER_COMMIT = 'b'.repeat(40);
const OBSERVED_AT = '2026-02-01T08:30:00.000Z';
const SNAPSHOT_AT = '2026-02-01T08:30:01.000Z';

function createRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'hikari-relevance-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function githubCiFacet(repository) {
  // No repository is not a repository with nothing to say: it is a source that could not be
  // observed, which the World reports as an unavailable facet rather than by rejecting.
  if (repository === undefined) return { kind: 'unavailable' };

  return {
    kind: 'available',
    observation: {
      observedAt: OBSERVED_AT,
      source: 'github-ci',
      repository,
      latestRun: {
        kind: 'reported',
        run: {
          id: 1,
          workflow: 'CI',
          headBranch: 'main',
          headSha: HEAD_COMMIT,
          status: 'completed',
          conclusion: { kind: 'reported', value: 'success' },
        },
      },
    },
  };
}

function snapshotOf(repository, commit = HEAD_COMMIT) {
  return Object.freeze({
    snapshotAt: SNAPSHOT_AT,
    gitRepository: Object.freeze({
      kind: 'available',
      observation: Object.freeze({
        observedAt: OBSERVED_AT,
        source: 'git-repository',
        workTreeRoot: 'C:/work/hikari-new',
        head: Object.freeze({ kind: 'branch', name: 'main', commit }),
        workTree: Object.freeze({ kind: 'unchanged' }),
        remotes: Object.freeze(['origin']),
      }),
    }),
    githubCi: Object.freeze(githubCiFacet(repository)),
  });
}

// Every rule v1 has, and the ones it deliberately does not. Each row is a pair of strings and the
// verdict that pair produces — nothing else is read, so nothing else can appear here.
const TRUTH_TABLE = [
  { name: '逐字相同即 relevant', designations: [CANONICAL], repository: CANONICAL, verdict: 'relevant' },
  {
    name: '一个 designation 命中就够了，另一个不参与也不取消',
    designations: [CANONICAL, 'P4-03'],
    repository: CANONICAL,
    verdict: 'relevant',
  },
  { name: '只声明 P4-03 时无法建立相关性', designations: ['P4-03'], repository: CANONICAL, verdict: 'unknown' },
  { name: '只有仓库名（basename）不算命中', designations: ['hikari-new'], repository: CANONICAL, verdict: 'unknown' },
  { name: '只有 owner 不算命中', designations: ['t1mb2rg'], repository: CANONICAL, verdict: 'unknown' },
  { name: '完全没有声明工作焦点时无法建立相关性', designations: [], repository: CANONICAL, verdict: 'unknown' },
  { name: '大小写不同不算命中', designations: ['T1MB2RG/Hikari-New'], repository: CANONICAL, verdict: 'unknown' },
  { name: '前后空白不同不算命中', designations: [` ${CANONICAL}`], repository: CANONICAL, verdict: 'unknown' },
  { name: '重复斜杠不算命中', designations: ['t1mb2rg//hikari-new'], repository: CANONICAL, verdict: 'unknown' },
  {
    name: 'GitHub CI 不可观测时无法建立相关性',
    designations: [CANONICAL],
    repository: undefined,
    verdict: 'unknown',
  },
];

for (const row of TRUTH_TABLE) {
  test(`relevance 判定：${row.name}`, () => {
    const judgement = judgeRelevance(row.designations, snapshotOf(row.repository));

    assert.equal(judgement.verdict, row.verdict);
    if (row.verdict === 'relevant') {
      // The equality travels with the verdict. A bare `relevant` would not say which declaration
      // produced it, and with more than one designation declared that is the only thing a human can
      // act on.
      assert.equal(judgement.designation, row.repository);
    } else {
      assert.equal(Object.hasOwn(judgement, 'designation'), false);
    }
  });
}

test('v1 的可达判定恰好是 relevant 与 unknown，没有 unrelated', () => {
  // Stated as a closure over the input space rather than as a missing word in a union: the union is
  // a fact about this build's types, and what matters is that no input reaches a third answer.
  const reached = new Set();
  const strings = ['', ' ', CANONICAL, CANONICAL.toUpperCase(), 'hikari-new', 't1mb2rg', 'P4-03', 'x/y', `${CANONICAL} `];

  for (const designation of strings) {
    for (const repository of [undefined, ...strings]) {
      reached.add(judgeRelevance([designation], snapshotOf(repository)).verdict);
    }
  }

  assert.deepEqual([...reached].sort(), ['relevant', 'unknown']);
});

test('判定不读取本地 HEAD 是什么 commit', () => {
  // The same repository string, reported while git is on three different commits — and, in the
  // table above, while GitHub CI is not observable at all. What is being asked is a question about a
  // name, and every one of these is a different answer to a different question.
  for (const commit of [HEAD_COMMIT, OTHER_COMMIT, 'c'.repeat(40)]) {
    const judgement = judgeRelevance([CANONICAL], snapshotOf(CANONICAL, commit));
    assert.equal(judgement.verdict, 'relevant', `commit ${commit} 不应影响名称判定`);
  }
});

test('判定不修改交给它的工作焦点集合', () => {
  const designations = Object.freeze(['P4-03', CANONICAL]);
  judgeRelevance(designations, snapshotOf(CANONICAL));
  assert.deepEqual([...designations], ['P4-03', CANONICAL]);
});

// No injection seam, as elsewhere in this suite: the tests supply fake *providers* as ordinary
// plugins and let the real Runtime dependency graph decide who is active. The plugin under test is
// the production one, reached through its real endpoint by the production client.
function provider(pluginId, contract, behaviour) {
  return {
    id: pluginId,
    version: '1.0.0',
    provides: [contract],
    setup(context) {
      context.services.provide(contract, behaviour);
    },
  };
}

async function compose(t, { designations = () => [], assessment, focusFails = false }) {
  const root = createRoot(t);
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  const states = [];
  states.push(
    await runtime.loadPlugin(
      provider(
        'test.work-focus-provider',
        workFocusCurrentService,
        Object.freeze({
          current: async () => {
            if (focusFails) throw new Error('工作焦点来源暂时不可用');
            return designations();
          },
        }),
      ),
    ),
  );
  states.push(
    await runtime.loadPlugin(
      provider('test.awareness-provider', repositoryCiAwarenessService, Object.freeze({
        current: async () => assessment(),
      })),
    ),
  );
  states.push(await runtime.loadPlugin(repositoryCiRelevancePlugin, { rootDir: root }));

  assert.deepEqual(states, ['active', 'active', 'active'], '测试组合应全部 active');
  return { root, runtime };
}

test('端点把判定原样交给提问者', { skip: NO_PIPES }, async (t) => {
  const { root } = await compose(t, {
    designations: () => Object.freeze([CANONICAL]),
    assessment: () => Object.freeze({ snapshot: snapshotOf(CANONICAL), commitComparison: 'same' }),
  });

  const answer = await requestRelevance(root);

  assert.equal(answer.kind, 'answered');
  assert.equal(answer.reply.outcome, 'ok');
  assert.equal(answer.reply.verdict, 'relevant');
  assert.deepEqual(answer.reply.lines, [
    'Repository CI relevance：relevant',
    `与工作焦点逐字相同：${CANONICAL}`,
  ]);
});

test('判定与 commitComparison 正交：three ways of comparing commits, one verdict', { skip: NO_PIPES }, async (t) => {
  let comparison = 'same';
  const { root } = await compose(t, {
    designations: () => Object.freeze([CANONICAL]),
    assessment: () => Object.freeze({ snapshot: snapshotOf(CANONICAL, OTHER_COMMIT), commitComparison: comparison }),
  });

  for (const value of ['same', 'different', 'indeterminate']) {
    comparison = value;
    const answer = await requestRelevance(root);

    // Where the local HEAD sits relative to the run has no bearing on whether the human named the
    // repository the run is about. Both are true at once and neither cancels the other.
    assert.equal(answer.reply.verdict, 'relevant', `commitComparison=${value} 不应改变名称判定`);
  }
});

test('每次提问都重新读取依赖，不缓存上一次的答案', { skip: NO_PIPES }, async (t) => {
  let designations = Object.freeze(['P4-03']);
  const { root } = await compose(t, {
    designations: () => designations,
    assessment: () => Object.freeze({ snapshot: snapshotOf(CANONICAL), commitComparison: 'same' }),
  });

  assert.equal((await requestRelevance(root)).reply.verdict, 'unknown');

  designations = Object.freeze([CANONICAL]);
  assert.equal((await requestRelevance(root)).reply.verdict, 'relevant');

  designations = Object.freeze([]);
  assert.equal((await requestRelevance(root)).reply.verdict, 'unknown');
});

test('依赖拒绝时回答 failed，而不是 unknown', { skip: NO_PIPES }, async (t) => {
  const { root } = await compose(t, {
    focusFails: true,
    assessment: () => Object.freeze({ snapshot: snapshotOf(CANONICAL), commitComparison: 'same' }),
  });

  const answer = await requestRelevance(root);

  assert.equal(answer.kind, 'answered');
  assert.equal(answer.reply.outcome, 'failed');
  // The two sentences mean different things to a reader: one says a comparison happened and found
  // nothing, the other says no comparison happened. Folding the second into the first would be the
  // endpoint telling a human their declaration was considered by something that never ran.
  assert.match(answer.reply.lines.join('\n'), /判定未能完成/);
  assert.doesNotMatch(answer.reply.lines.join('\n'), /未能在当前工作焦点与 Repository CI observation 之间建立逐字相等关系/);
});

test('端点拒绝不合法的请求，并把拒绝本身当作 failed 而非 unknown', { skip: NO_PIPES }, async (t) => {
  const { root } = await compose(t, {
    designations: () => Object.freeze([CANONICAL]),
    assessment: () => Object.freeze({ snapshot: snapshotOf(CANONICAL), commitComparison: 'same' }),
  });
  const path = relevanceEndpointPath(root);

  const cases = [
    ['未知请求', JSON.stringify({ protocol: RELEVANCE_PROTOCOL_VERSION, request: 'stop' })],
    [
      '协议版本不匹配',
      JSON.stringify({ protocol: RELEVANCE_PROTOCOL_VERSION + 1, request: 'status' }),
    ],
    [
      '多出的字段',
      JSON.stringify({ protocol: RELEVANCE_PROTOCOL_VERSION, request: 'status', repository: CANONICAL }),
    ],
    ['不是 JSON 对象', '[1,2,3]'],
  ];

  for (const [label, line] of cases) {
    const text = await askRaw(path, `${line}\n`);
    const reply = JSON.parse(text);

    assert.equal(reply.outcome, 'failed', `${label} 应被拒绝`);
    assert.equal(reply.protocol, RELEVANCE_PROTOCOL_VERSION);
    assert.equal(Object.hasOwn(reply, 'verdict'), false, `${label} 不应带判定`);
  }
});

test('超长请求在有界处断开，而不是被无限缓冲', { skip: NO_PIPES }, async (t) => {
  const { root } = await compose(t, {
    designations: () => Object.freeze([CANONICAL]),
    assessment: () => Object.freeze({ snapshot: snapshotOf(CANONICAL), commitComparison: 'same' }),
  });

  const text = await askRaw(relevanceEndpointPath(root), `${'x'.repeat(4096)}\n`);
  assert.equal(text, '', '超出长度上限的连接不应得到应答');
});

test('端点随插件一起消失，并且这时的答案是 absent 而不是 unconfigured', { skip: NO_PIPES }, async (t) => {
  const { root, runtime } = await compose(t, {
    designations: () => Object.freeze([CANONICAL]),
    assessment: () => Object.freeze({ snapshot: snapshotOf(CANONICAL), commitComparison: 'same' }),
  });

  assert.equal((await requestRelevance(root)).kind, 'answered');

  await runtime.unloadPlugin(repositoryCiRelevancePlugin.id);
  assert.equal(runtime.getPluginState(repositoryCiRelevancePlugin.id), undefined);

  // Two claims in one: the plugin's own endpoint went with the plugin, and the client did not stop
  // at the ENOENT. It asked the Resident's control channel, found nothing there either, and
  // concluded there is no resident — which is what `absent` means and is not what `unconfigured`
  // means. There is no control endpoint in this test, which is exactly the situation being pinned.
  assert.deepEqual(await requestRelevance(root), { kind: 'absent' });
});

function askRaw(path, line) {
  return new Promise((settle) => {
    const socket = connect(path);
    let text = '';

    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(line));
    socket.on('data', (chunk) => {
      text += chunk;
    });
    socket.on('close', () => settle(text));
    socket.on('error', () => settle(text));
  });
}

test('relevance 没有把不存在的通用机制引进来', () => {
  const forbidden =
    /\b(?:RepositoryIdentity|ProfileRegistry|CapabilityRegistry|PluginLoader|OptionalPlugin|RepositoryScope|ServiceLocator|Router|RelevanceHistory|Salience|Embedding)\b/;
  const offenders = sourceFiles(join(import.meta.dirname, '..', 'src', 'repository-ci-relevance')).filter(
    (file) => forbidden.test(readFileSync(file, 'utf8')),
  );

  assert.deepEqual(offenders.map((file) => relative(join(import.meta.dirname, '..', 'src'), file)), []);
});

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sourceFiles(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}
