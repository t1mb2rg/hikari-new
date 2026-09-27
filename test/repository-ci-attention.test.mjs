import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';

import { Runtime } from '../dist/index.js';
import { gitHubCiService } from '../dist/github-ci/index.js';
import { humanDeliveryService } from '../dist/human-delivery/index.js';
import { languageSpeakingService } from '../dist/language/index.js';
import { oneLine } from '../dist/terminal-text/index.js';
import {
  detectNewFailure,
  renderOccurrence,
  repositoryCiAttentionPlugin,
} from '../dist/repository-ci-attention/index.js';

// Two halves in one file, and the split is the one `language.test.mjs` describes.
//
// The judgement and the wording are pure functions, so their tests need no pipe, no network and no
// resident, and they run on `ubuntu-latest` — which is where a rule that is only pinned behind a named
// pipe stops being checked at all. That is not a hypothetical here: this repository has already lost a
// rule that way, and the review that opened this slice said so.
//
// The cadence, the announced set and the delivery policy are the other half. They are exercised against
// the real Runtime with three fake capability providers, so a test can choose exactly which observation
// arrives on which cycle and read back what left through the transport. No pipe is involved in any of
// it: the transport is a fake that answers `unavailable` or `failed` on command, which is what lets the
// *policy* about a failed delivery be tested everywhere rather than only on a machine with pipes.
//
// What this file deliberately does not test is that a real client receives anything. That claim needs a
// named pipe, it lives in `human-delivery.test.mjs`, and it is reported separately — a green run here
// says nothing about it.

const OBSERVED_AT = '2026-03-01T09:00:00.000Z';
const REPOSITORY = 't1mb2rg/hikari-new';
const HEAD_SHA = 'c0ffee1234567890abcdef1234567890abcdef12';

const CI_PROVIDER = 'test.ci-provider';
const SPEAKING_PROVIDER = 'test.speaking-provider';
const DELIVERY_PROVIDER = 'test.delivery-provider';

const ATTENTION_SOURCE = join(import.meta.dirname, '..', 'src', 'repository-ci-attention');

// Spelled as code points rather than as escapes or as literal characters, so that this file holds no
// invisible bytes — a test about invisible characters is a poor place to hide some. The same list
// `terminal-text` escapes, and the reason it exists there.
const LINE_BREAKS = [0x0d, 0x0a, 0x0b, 0x0c, 0x85, 0x2028, 0x2029];

function run(overrides = {}) {
  return {
    id: 41,
    workflow: 'ci',
    headBranch: 'main',
    headSha: HEAD_SHA,
    status: 'completed',
    conclusion: { kind: 'reported', value: 'failure' },
    ...overrides,
  };
}

function observation(latestRun, overrides = {}) {
  return {
    observedAt: OBSERVED_AT,
    source: 'github-ci',
    repository: REPOSITORY,
    latestRun,
    ...overrides,
  };
}

function reported(runOverrides = {}) {
  return observation({ kind: 'reported', run: run(runOverrides) });
}

function failure(id = 41) {
  return reported({ id });
}

function occurrence(overrides = {}) {
  return Object.freeze({
    repository: REPOSITORY,
    runId: 41,
    workflow: 'ci',
    headBranch: 'main',
    headSha: HEAD_SHA,
    conclusion: 'failure',
    observedAt: OBSERVED_AT,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------------------------
// What counts as a new failure. A truth table over one observation and one set of ids, checkable
// without a Runtime, a socket or a clock.
// ---------------------------------------------------------------------------------------------

test('完成的失败运行才是 candidate，其余每一种都不是', () => {
  const cases = [
    ['GitHub 没有可报的运行', observation({ kind: 'none' }), false],
    ['运行还没结束', reported({ status: 'in_progress' }), false],
    ['还在排队', reported({ status: 'queued' }), false],
    ['跑完了但 GitHub 还没有给结论', reported({ conclusion: { kind: 'absent' } }), false],
    ['cancelled：人自己取消的，不是失败', reported({ conclusion: { kind: 'reported', value: 'cancelled' } }), false],
    ['action_required：等着人批，不是失败', reported({ conclusion: { kind: 'reported', value: 'action_required' } }), false],
    ['neutral', reported({ conclusion: { kind: 'reported', value: 'neutral' } }), false],
    ['skipped', reported({ conclusion: { kind: 'reported', value: 'skipped' } }), false],
    ['stale', reported({ conclusion: { kind: 'reported', value: 'stale' } }), false],
    ['success：它跑完了，而且跑好了', reported({ conclusion: { kind: 'reported', value: 'success' } }), false],
    ['failure', reported(), true],
    ['timed_out', reported({ conclusion: { kind: 'reported', value: 'timed_out' } }), true],
    ['startup_failure', reported({ conclusion: { kind: 'reported', value: 'startup_failure' } }), true],
  ];

  for (const [name, input, expected] of cases) {
    const detected = detectNewFailure(input, new Set());
    assert.equal(detected !== undefined, expected, name);
  }
});

test('判定只认 GitHub 自己那三个词，逐字且区分大小写的比较', () => {
  // GitHub's vocabulary is GitHub's, and this module carries it verbatim rather than mapping it onto a
  // set of its own. A comparison that folded case would be this file inventing a spelling GitHub does
  // not use; a prefix or substring match would be it guessing at words nobody has seen yet.
  for (const value of ['Failure', 'FAILURE', 'fail', 'failed', 'failure ', 'timed out', 'timeout', '']) {
    assert.equal(
      detectNewFailure(reported({ conclusion: { kind: 'reported', value } }), new Set()),
      undefined,
      `${JSON.stringify(value)} 不该被当作 GitHub 的结论词`,
    );
  }
});

test('说过一次的 run 不再说第二次', () => {
  const detected = detectNewFailure(failure(), new Set());
  assert.notEqual(detected, undefined);

  assert.equal(detectNewFailure(failure(), new Set([detected.runId])), undefined);
  // The set is of run ids and nothing else: an id that is not this one does not suppress this one.
  assert.notEqual(detectNewFailure(failure(), new Set([detected.runId + 1])), undefined);
});

test('in_progress 从不会被记下，因此它变成 failure 时是一次 first sighting', () => {
  // The whole of the transition rule, and it is stated as a property of what the *caller* records
  // rather than as a state machine: `detectNewFailure` is handed the set the plugin owns, and the
  // plugin adds to it only when an occurrence was actually produced. A run seen in progress therefore
  // leaves nothing behind, and the completion that follows is announced once.
  const announced = new Set();

  const inProgress = reported({ status: 'in_progress' });
  assert.equal(detectNewFailure(inProgress, announced), undefined);
  // Nothing was recorded, because nothing was said — see `judgement.ts`.
  assert.equal(announced.size, 0);

  const completed = detectNewFailure(failure(), announced);
  assert.notEqual(completed, undefined, '同一个 run 从 in_progress 变成 failure 应当被看到一次');
  assert.equal(completed.runId, 41);

  announced.add(completed.runId);
  assert.equal(detectNewFailure(failure(), announced), undefined, '第二次就不该再说了');
});

test('candidate 的每个字段都是观察里的原话', () => {
  const detected = detectNewFailure(failure(), new Set());

  assert.deepEqual(detected, {
    repository: REPOSITORY,
    runId: 41,
    workflow: 'ci',
    headBranch: 'main',
    headSha: HEAD_SHA,
    conclusion: 'failure',
    observedAt: OBSERVED_AT,
  });
  // Frozen, because it is handed to another module and a mutation on the far side would be a change to a
  // judgement that had already been rendered. The renderer reads it, and nothing downstream writes.
  assert.ok(Object.isFrozen(detected));
});

// ---------------------------------------------------------------------------------------------
// What it reads like. The owner's own renderer, so that Language has exactly one statement of this
// domain's wording rather than a copy of it.
// ---------------------------------------------------------------------------------------------

test('occurrence 的每一行要么是表头要么是某个字段，没有一句是解释', () => {
  assert.deepEqual(renderOccurrence(occurrence()), [
    'Repository CI attention：',
    `  仓库：${REPOSITORY}`,
    '  运行：41',
    '  工作流：ci',
    '  分支：main',
    `  提交：${HEAD_SHA}`,
    '  结论：failure',
    `  观察时间：${OBSERVED_AT}`,
  ]);
});

test('字段里的换行与控制序列都写不出第二行', () => {
  // These fields are as free as GitHub makes them: a workflow name, a branch name and a conclusion are
  // somebody else's bytes. A branch called `main\n  结论：success` would otherwise print a second line
  // that reads like a judgement this module never made — which is the failure `oneLine` exists for.
  const hostile = occurrence({
    workflow: String.fromCodePoint(0x0a) + '  结论：success',
    headBranch: 'main' + String.fromCodePoint(0x0d) + String.fromCodePoint(0x0d),
    conclusion: 'failure' + String.fromCodePoint(0x1b) + '[2J',
    repository: 'a' + String.fromCodePoint(0x09) + 'b',
  });

  const lines = renderOccurrence(hostile);
  assert.equal(lines.length, 8, '转义之后行数不变');

  for (const line of lines) {
    for (const point of line) {
      const code = point.codePointAt(0);
      assert.ok(!LINE_BREAKS.includes(code), `U+${code.toString(16)} 不该留在渲染结果里`);
      assert.ok(
        code === 0x09 || code >= 0x20,
        `U+${code.toString(16)} 是终端会执行的字符`,
      );
    }
  }

  // Escaped rather than dropped: the byte that was there is still readable, it just cannot act.
  assert.ok(lines[3].includes(String.raw`\n`), '换行应当被写成它的码点');
  assert.ok(lines[4].includes(String.raw`\r`), '回车应当被写成它的码点');
  assert.ok(lines[6].includes(String.raw`\u001b`), 'ESC 应当被写成它的码点');
  assert.ok(lines[1].includes('a\tb'), '制表符保留原样，它既不能换行也不能移动光标');
});

test('渲染整条值时也过一遍 oneLine，而不是只过今天需要的那几个字段', () => {
  // The property claimed is about the *return value*, not about its inputs, so it is checked that way:
  // whatever the fields are, every element that comes back is already exactly one line. A field added
  // later cannot quietly reopen the hole.
  const lines = renderOccurrence(
    occurrence({
      workflow: String.fromCodePoint(0x2028, 0x7f),
      headBranch: String.fromCodePoint(0x85, 0x1b),
      conclusion: String.fromCodePoint(0x0a, 0x0d),
      repository: String.fromCodePoint(0x09),
    }),
  );

  for (const line of lines) {
    assert.equal(oneLine(line), line, '每个元素都应当已经是一次 oneLine 的结果');
    for (const point of line) {
      const code = point.codePointAt(0);
      assert.ok(!LINE_BREAKS.includes(code), `U+${code.toString(16)} 不该留在渲染结果里`);
      assert.ok(code === 0x09 || code >= 0x20, `U+${code.toString(16)} 是终端会执行的字符`);
    }
  }

  assert.ok(lines[3].includes(String.raw`\u2028`), 'U+2028 应当被写成它的码点');
  assert.ok(lines[3].includes(String.raw`\u007f`), 'DEL 应当被写成它的码点');
});

// ---------------------------------------------------------------------------------------------
// The boundary, as a contract and as a roster.
// ---------------------------------------------------------------------------------------------

test('Attention 的 requires 恰好是那三个问题，provides 为空', () => {
  assert.equal(repositoryCiAttentionPlugin.id, 'repository-ci-attention');
  assert.equal(repositoryCiAttentionPlugin.version, '1.0.0');

  // Three requirements and each is a different question this plugin cannot answer itself: what
  // happened, how to say it, and whether anyone is listening. Asserted as an exact sequence, because
  // the claim that matters includes "and nothing else" — a fourth entry would be this decider reaching
  // for something it has no business knowing.
  assert.deepEqual(repositoryCiAttentionPlugin.requires, [
    gitHubCiService,
    languageSpeakingService,
    humanDeliveryService,
  ]);
  assert.deepEqual(
    repositoryCiAttentionPlugin.requires.map((contract) => `${contract.id}@${contract.version}`),
    ['github-ci.current@1', 'language.speaking@1', 'human-delivery.deliver@1'],
  );

  // Empty, and there is nothing to provide. A decider that only ever speaks has no capability another
  // module could ask it for, and giving it one so that it "looks like it has an output" is exactly the
  // cosmetic `provides` the design spec's MUST forbids.
  assert.deepEqual(repositoryCiAttentionPlugin.provides, []);
});

test('cadence 由本插件判定，且必须是它真的能执行的值', async (t) => {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  for (const delayMs of [
    undefined,
    null,
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    '5',
    2_147_483_648,
  ]) {
    await assert.rejects(
      () => runtime.loadPlugin(repositoryCiAttentionPlugin, { delayMs }),
      /requires an integer delayMs between 1 and 2147483647/,
      `delayMs ${String(delayMs)} 应当被本插件拒绝`,
    );
  }
});

test('这个 decider 不发布事件：它只通过 Service 找那两个具名消费者', () => {
  // The claim `plugin.ts` makes in prose — "it does not publish: it has a named consumer and a named
  // transport, and it reaches both through Services" — checked as a property of the source rather than
  // left as a sentence that could quietly stop being true. An `emit` here would put the EventBus's
  // AggregateError between a transport failure and the perception loop, and would also make "who
  // receives this" a question for whoever happened to subscribe.
  const offenders = sourceFiles(ATTENTION_SOURCE).filter((file) =>
    /\bcontext\.events\b|\bevents\.emit\b|\bevents\.on\b/.test(readFileSync(file, 'utf8')),
  );

  assert.deepEqual(
    offenders.map((file) => relative(ATTENTION_SOURCE, file).replaceAll('\\', '/')),
    [],
  );
});

test('没有新的通用机制跟着这次改动进来', () => {
  // The same second-road check the language package has, and for the same reason: naming an identifier
  // is what a generic mechanism would have to do before it could be used. Every entry is a compound
  // identifier rather than the bare noun, because this module's own comments negate the nouns in the
  // plain — "no generic attention framework", "relevant ≠ salient" — and a pattern naming the nouns
  // would red on the sentences that deny the thing.
  const forbidden =
    /\b(?:ServiceLocator|ServiceRegistry|CapabilityRegistry|GlobalRouter|OutboundCoordinator|NotificationService|NotificationQueue|SalienceService|ImportanceService|AttentionRegistry|EventSink|MessageBroker|DeliveryServer)\b/;
  const offenders = sourceFiles(ATTENTION_SOURCE).filter((file) =>
    forbidden.test(readFileSync(file, 'utf8')),
  );

  assert.deepEqual(
    offenders.map((file) => relative(ATTENTION_SOURCE, file).replaceAll('\\', '/')),
    [],
  );
});

// ---------------------------------------------------------------------------------------------
// The cadence, the announced set and the delivery policy — against the real Runtime.
// ---------------------------------------------------------------------------------------------

// No injection seam: the plugin under test is the production one, and the three capabilities it
// consumes are supplied by ordinary fake plugins that the real Runtime dependency graph decides to
// activate. What the tests below exercise is therefore the shipped wiring, not a copy of it.
function ciProvider(sequence) {
  const counts = { calls: 0 };
  const definition = {
    id: CI_PROVIDER,
    version: '1.0.0',
    provides: [gitHubCiService],
    setup(context) {
      context.services.provide(gitHubCiService, {
        current() {
          const call = counts.calls;
          counts.calls += 1;
          return Promise.resolve(sequence(call));
        },
      });
    },
  };
  return { definition, counts };
}

function speakingProvider() {
  const spoken = [];
  const definition = {
    id: SPEAKING_PROVIDER,
    version: '1.0.0',
    provides: [languageSpeakingService],
    setup(context) {
      context.services.provide(languageSpeakingService, {
        speak(value) {
          const lines = Object.freeze([`说第 ${value.runId} 号运行：`, `  结论：${value.conclusion}`]);
          spoken.push({ occurrence: value, lines });
          return lines;
        },
      });
    },
  };
  return { definition, spoken };
}

function deliveryProvider(outcome = () => ({ outcome: 'delivered' })) {
  const delivered = [];
  const definition = {
    id: DELIVERY_PROVIDER,
    version: '1.0.0',
    provides: [humanDeliveryService],
    setup(context) {
      context.services.provide(humanDeliveryService, {
        deliver(lines) {
          delivered.push(lines);
          return Promise.resolve(outcome(delivered.length));
        },
      });
    },
  };
  return { definition, delivered };
}

async function compose(runtime, { ci, speaking, delivery, delayMs }) {
  await runtime.loadPlugin(ci.definition);
  await runtime.loadPlugin(speaking.definition);
  await runtime.loadPlugin(delivery.definition);
  return loadDecider(runtime, delayMs);
}

// Split out from `compose` so that a test about reactivation can load the decider a second time
// without reloading the three providers, which are already loaded and would be rejected as such.
async function loadDecider(runtime, delayMs) {
  const state = await runtime.loadPlugin(repositoryCiAttentionPlugin, { delayMs });
  assert.equal(state, 'active', '三个 capability 都在时，decider 应当 active');
  return state;
}

// Yields one whole event-loop turn, which drains every pending microtask. A macrotask boundary is
// deterministic — unlike a sleep, it proves the pending work is finished rather than that it probably
// had enough time.
function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

// Waits for an observable condition rather than for a duration, so a cadence test asserts that the
// cycles happened and never that they happened on time. The deadline turns a condition that can never
// hold into a failure instead of a hang.
async function until(condition, message, deadlineMs = 2000) {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > deadlineMs) assert.fail(message);
    await nextTurn();
  }
}

// Real elapsed time, used only where a test must show that something did *not* happen.
async function elapsed(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

test('一个新的失败在一个激活里只说一次', async (t) => {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  // Every cycle reports the same red run. Without the announced set this would be a message every poll —
  // which is not "proactive", it is a stuck record, and it is the failure mode the activation-local set
  // exists to prevent.
  const ci = ciProvider(() => failure());
  const speaking = speakingProvider();
  const delivery = deliveryProvider();
  await compose(runtime, { ci, speaking, delivery, delayMs: 2 });

  await until(() => delivery.delivered.length >= 1, '第一次播报没有发生');
  await until(() => ci.counts.calls >= 3, 'polling 没有继续');
  await elapsed(20);

  assert.equal(delivery.delivered.length, 1, '同一个 failed run 不得被说第二次');
  assert.equal(speaking.spoken.length, 1, 'Language 也不该被再要求一次');
});

test('新的 run id 再失败，是新的 candidate', async (t) => {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  const ids = [41, 41, 42, 42, 42, 41];
  const ci = ciProvider((call) => failure(ids[Math.min(call, ids.length - 1)]));
  const speaking = speakingProvider();
  const delivery = deliveryProvider();
  await compose(runtime, { ci, speaking, delivery, delayMs: 2 });

  await until(() => delivery.delivered.length >= 2, '第二个 run id 的失败没有被播报');
  await until(() => ci.counts.calls >= 6, 'polling 没有跑满这一串');
  await elapsed(20);

  assert.equal(delivery.delivered.length, 2);
  assert.deepEqual(
    speaking.spoken.map((entry) => entry.occurrence.runId),
    [41, 42],
  );
});

test('一次 in_progress → failure 的转变恰好产生一条播报', async (t) => {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  // The run is seen running for as many cycles as it takes and then reports completed/failure. The
  // phase is changed by the test rather than after a fixed number of calls, so "nothing was said while
  // it was running" is a claim about a window that really was open rather than one that happened to be
  // narrow. The intermediate sightings must announce nothing and record nothing either, which is what
  // makes the completion a first sighting rather than a second one.
  let phase = 'running';
  const ci = ciProvider(() => (phase === 'running' ? reported({ status: 'in_progress' }) : failure()));
  const speaking = speakingProvider();
  const delivery = deliveryProvider();
  await compose(runtime, { ci, speaking, delivery, delayMs: 2 });

  await until(() => ci.counts.calls >= 3, 'in_progress 的几轮没有跑完');
  await elapsed(20);
  assert.equal(delivery.delivered.length, 0, '还没结束的运行不得被播报');

  phase = 'failed';
  await until(() => delivery.delivered.length >= 1, 'failure 转变没有被播报');
  await elapsed(20);
  assert.equal(delivery.delivered.length, 1, '转变之后仍应只有一条');
  assert.equal(speaking.spoken[0].occurrence.conclusion, 'failure');
});

test('送出去的就是 Language 写的那几行，一个字都没被改写', async (t) => {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  const ci = ciProvider(() => failure());
  const speaking = speakingProvider();
  const delivery = deliveryProvider();
  await compose(runtime, { ci, speaking, delivery, delayMs: 2 });

  await until(() => delivery.delivered.length >= 1, '没有任何东西被送出去');

  // Identity, not deep equality. A decider that copied the array, joined it, added a prefix or
  // re-wrapped it would be a second expression surface — the one nobody reviews. The lines travel from
  // the renderer to the transport as the same object, which is the strongest form this claim can take
  // in a language where the wire itself is a copy.
  assert.equal(delivery.delivered[0], speaking.spoken[0].lines);

  // And Language was handed the occurrence itself, so it is the owner's renderer that decided the
  // words. The decider's whole contribution is which occurrence, never what is said about it.
  assert.equal(speaking.spoken[0].occurrence.runId, 41);
  assert.equal(speaking.spoken[0].occurrence.conclusion, 'failure');
});

test('没人连着的时候，Hikari 照常注意到，也照常什么都不说', async (t) => {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  const ci = ciProvider(() => failure());
  const speaking = speakingProvider();
  // `unavailable` is the ordinary evening: a human opens their listener when they want to be told
  // things, and there is no queue behind this — a message formed while nobody is connected is gone.
  const delivery = deliveryProvider(() => ({ outcome: 'unavailable' }));
  const state = await compose(runtime, { ci, speaking, delivery, delayMs: 2 });

  await until(() => delivery.delivered.length >= 1, 'decider 没有尝试投递');
  await until(() => ci.counts.calls >= 4, 'polling 停了');
  await elapsed(20);

  // Three separate facts, and the test is that they stay separate. The transport reported that nobody
  // was there; the decider's activation did not change because of it; and the failure it judged is not
  // re-announced on the chance that a client is watching now.
  assert.equal(state, 'active');
  assert.equal(runtime.getPluginState('repository-ci-attention'), 'active');
  assert.equal(delivery.delivered.length, 1, '没人连着不是重发的理由');
  assert.equal(speaking.spoken.length, 1);
});

test('投递失败不回滚判定：不重发、不抛出、循环继续', async (t) => {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  const ci = ciProvider(() => failure());
  const speaking = speakingProvider();
  const delivery = deliveryProvider(() => ({ outcome: 'failed' }));
  const state = await compose(runtime, { ci, speaking, delivery, delayMs: 2 });

  await until(() => delivery.delivered.length >= 1, 'decider 没有尝试投递');
  await until(() => ci.counts.calls >= 4, '循环因为一次投递失败而停了');
  await elapsed(20);

  assert.equal(state, 'active');
  assert.equal(runtime.getPluginState('repository-ci-attention'), 'active');
  assert.equal(delivery.delivered.length, 1, 'failed 不得变成 retry loop');

  // Nothing was made observable because a pipe broke: the outcome is discarded on purpose, because
  // there is nothing this plugin could do differently for `failed` than for `unavailable` — see
  // `plugin.ts`. What is asserted here is that the failure did not become this plugin's error.
  assert.equal(runtime.getPluginError('repository-ci-attention'), undefined);
});

test('采集本身抛错也只吃掉这一轮，循环继续', async (t) => {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  const ci = ciProvider((call) =>
    call === 1 ? Promise.reject(new Error('GitHub 读不到')) : Promise.resolve(failure()),
  );
  const speaking = speakingProvider();
  const delivery = deliveryProvider();
  await compose(runtime, { ci, speaking, delivery, delayMs: 2 });

  await until(() => delivery.delivered.length >= 1, '被拒绝的那一轮之后，循环没有继续');

  assert.equal(runtime.getPluginState('repository-ci-attention'), 'active');
  assert.equal(runtime.getPluginError('repository-ci-attention'), undefined);
});

test('停用之后到达的 occurrence 不再被播报', async (t) => {
  const runtime = new Runtime();

  // The acquisition is held open across the deactivation, so a request that was already in flight when
  // the plugin went away is the case under test. It is checked on the far side of the await because the
  // work being already underway does not make its result this activation's to speak.
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const ci = ciProvider(() => held);
  const speaking = speakingProvider();
  const delivery = deliveryProvider();
  await compose(runtime, { ci, speaking, delivery, delayMs: 10_000 });

  await until(() => ci.counts.calls >= 1, '第一轮没有开始');

  const shutdown = runtime.shutdown();
  await nextTurn();
  release(failure());
  await shutdown;

  await elapsed(20);
  assert.equal(delivery.delivered.length, 0, '停用之后到达的观察不得被说出去');
  assert.equal(speaking.spoken.length, 0);
});

test('同一个组合里再激活一次，会重新播报当前红着的运行', async (t) => {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  // The announced set is activation-local and there is deliberately nothing else: no token, no Chronicle
  // reader, no durable queue. A restart therefore re-announces whatever is red right now, which is the
  // v0 semantics the Repository CI Attention review settled on — and the reason this test exists is that
  // the alternative reading, "a restart remembers", would require exactly the store this slice forbids.
  const ci = ciProvider(() => failure());
  const speaking = speakingProvider();
  const delivery = deliveryProvider();
  await compose(runtime, { ci, speaking, delivery, delayMs: 2 });
  await until(() => delivery.delivered.length >= 1, '第一次激活没有播报');

  await runtime.unloadPlugin('repository-ci-attention');
  await loadDecider(runtime, 2);

  await until(() => delivery.delivered.length >= 2, '新的一次激活应当重新播报当前红着的运行');
  assert.deepEqual(
    speaking.spoken.map((entry) => entry.occurrence.runId),
    [41, 41],
  );
});

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sourceFiles(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}
