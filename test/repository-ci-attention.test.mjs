import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';

import { Runtime } from '../dist/index.js';
import {
  chroniclePlugin,
  chronicleService,
  initializeChronicle,
  openChronicle,
  resolveChroniclePath,
} from '../dist/chronicle/index.js';
import { continuityPlugin, initializeHikari, restoreHikari } from '../dist/continuity/index.js';
import { gitHubCiService } from '../dist/github-ci/index.js';
import { humanDeliveryService } from '../dist/human-delivery/index.js';
import { languageSpeakingService } from '../dist/language/index.js';
import {
  deliveryFactDraft,
  detectNewFailure,
  failureKey,
  readDeliveredFailures,
  renderOccurrence,
  repositoryCiAttentionPlugin,
} from '../dist/repository-ci-attention/index.js';
import { oneLine } from '../dist/terminal-text/index.js';

// Three parts in one file, and the split is the one `language.test.mjs` describes.
//
// The judgement and the wording are pure functions, so their tests need no pipe, no network and no
// resident, and they run on `ubuntu-latest` — which is where a rule that is only pinned behind a named
// pipe stops being checked at all. That is not a hypothetical here: this repository has already lost a
// rule that way, and the review that opened this slice said so. The fact family joins them: what "the
// same failure" means, what gets admitted, and every shape the reader refuses to recognise are all
// pure, and all of them are exercised without a disk.
//
// The cadence, the two sets and the delivery policy are the second part. They are exercised against
// the real Runtime with four fake capability providers, so a test can choose exactly which observation
// arrives on which cycle, read back what left through the transport, and choose which way the store
// fails. No pipe is involved in any of it: the transport is a fake that answers `unavailable` or
// `failed` on command, which is what lets the *policy* about a failed delivery be tested everywhere
// rather than only on a machine with pipes.
//
// The third part is the one the fakes cannot make: a **real** Chronicle file, written by one
// composition and read back by a different one with its own Runtime. A fake store proves the policy;
// it cannot prove that a draft this owner builds survives `append`, serialization, `fsync` and being
// parsed by a separate reader. That is what the last section is for, and it is the only part of this
// file that touches the disk — which is why it is cordoned off rather than spread through the rest.
//
// What this file deliberately does not test is that a real client receives anything. That claim needs a
// named pipe, it lives in `human-delivery.test.mjs`, and it is reported separately — a green run here
// says nothing about it.

const OBSERVED_AT = '2026-03-01T09:00:00.000Z';
const REPOSITORY = 't1mb2rg/hikari-new';
const OTHER_REPOSITORY = 't1mb2rg/other-repository';
const HEAD_SHA = 'c0ffee1234567890abcdef1234567890abcdef12';

const CI_PROVIDER = 'test.ci-provider';
const SPEAKING_PROVIDER = 'test.speaking-provider';
const DELIVERY_PROVIDER = 'test.delivery-provider';
const CHRONICLE_PROVIDER = 'test.chronicle-provider';

// Written out here rather than taken from the module, for the reason `work-focus.test.mjs` writes out
// its own wording constants: a test that took the fact type from `facts.ts` would agree with whatever
// that file happened to say, including after somebody changed the vocabulary. This is the durable half
// of the module — the part a later activation reads back — so it is the last place to grade itself.
const DELIVERED_FACT_TYPE = 'repository-ci-attention.delivered';
const DELIVERY_SOURCE_KIND = 'repository-ci-attention.delivery';

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

// A fact of this owner's family, spelled out rather than built by `deliveryFactDraft`. The reader under
// test must be able to recognise a history that came off a disk, and a history assembled by the writer
// would only ever prove that the writer agrees with itself.
function deliveredFact(repository, runId) {
  return Object.freeze({
    factId: `seed-${repository}-${runId}`,
    type: DELIVERED_FACT_TYPE,
    version: 1,
    occurredAt: OBSERVED_AT,
    recordedAt: OBSERVED_AT,
    source: { kind: DELIVERY_SOURCE_KIND },
    payload: { repository, runId },
  });
}

// ---------------------------------------------------------------------------------------------
// What counts as a new failure. A truth table over one observation and the two histories, checkable
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
    // Both histories empty, which is the activation that has never run before. Everything this table
    // is about is upstream of the two sets, so the answer must not depend on them being supplied.
    const detected = detectNewFailure(input, new Set(), new Set());
    assert.equal(detected !== undefined, expected, name);
  }
});

test('判定只认 GitHub 自己那三个词，逐字且区分大小写的比较', () => {
  // GitHub's vocabulary is GitHub's, and this module carries it verbatim rather than mapping it onto a
  // set of its own. A comparison that folded case would be this file inventing a spelling GitHub does
  // not use; a prefix or substring match would be it guessing at words nobody has seen yet.
  for (const value of ['Failure', 'FAILURE', 'fail', 'failed', 'failure ', 'timed out', 'timeout', '']) {
    assert.equal(
      detectNewFailure(reported({ conclusion: { kind: 'reported', value } }), new Set(), new Set()),
      undefined,
      `${JSON.stringify(value)} 不该被当作 GitHub 的结论词`,
    );
  }
});

test('说过一次的 run 不再说第二次，两条历史各判各的', () => {
  const detected = detectNewFailure(failure(), new Set(), new Set());
  assert.notEqual(detected, undefined);

  const key = failureKey(REPOSITORY, detected.runId);

  // Two reasons to stay quiet, and they are not interchangeable. The first is "this activation has
  // already taken it on"; the second is "a previous activation already got the word out". Either one
  // alone is enough, and the sets are supplied separately because the plugin keeps them separately.
  assert.equal(detectNewFailure(failure(), new Set([key]), new Set()), undefined, '本 activation 处理过了');
  assert.equal(detectNewFailure(failure(), new Set(), new Set([key])), undefined, '以前投递过了');

  // A key that is not this one suppresses nothing, in either of them. Without this half the test above
  // would pass just as happily against a rule that answered "no" to everything.
  const neighbour = failureKey(REPOSITORY, detected.runId + 1);
  assert.notEqual(detectNewFailure(failure(), new Set([neighbour]), new Set()), undefined);
  assert.notEqual(detectNewFailure(failure(), new Set(), new Set([neighbour])), undefined);
});

test('in_progress 从不会被记下，因此它变成 failure 时是一次 first sighting', () => {
  // The whole of the transition rule, and it is stated as a property of what the *caller* records
  // rather than as a state machine: `detectNewFailure` is handed the set the plugin owns, and the
  // plugin adds to it only when an occurrence was actually produced. A run seen in progress therefore
  // leaves nothing behind, and the completion that follows is handled once.
  const handledFailures = new Set();
  const deliveredFailures = new Set();

  const inProgress = reported({ status: 'in_progress' });
  assert.equal(detectNewFailure(inProgress, handledFailures, deliveredFailures), undefined);
  // Nothing was recorded, because nothing was taken on — see `judgement.ts`.
  assert.equal(handledFailures.size, 0);

  const completed = detectNewFailure(failure(), handledFailures, deliveredFailures);
  assert.notEqual(completed, undefined, '同一个 run 从 in_progress 变成 failure 应当被看到一次');
  assert.equal(completed.runId, 41);

  handledFailures.add(failureKey(completed.repository, completed.runId));
  assert.equal(
    detectNewFailure(failure(), handledFailures, deliveredFailures),
    undefined,
    '第二次就不该再处理了',
  );
});

test('candidate 的每个字段都是观察里的原话', () => {
  const detected = detectNewFailure(failure(), new Set(), new Set());

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
// The fact family: what "the same failure" means, what this owner admits, and what it will believe
// when it reads its own history back. All pure, all checkable without a disk.
// ---------------------------------------------------------------------------------------------

test('身份是 (repository, runId) 的复合键，不是 run id', () => {
  // GitHub numbers runs per repository, so run 41 exists in every repository there is. The Chronicle
  // this history is read out of belongs to *Hikari* rather than to a repository, so histories from
  // several repositories land in the same file — and a key of the run id alone would let one
  // repository's delivery silence another repository's failure.
  assert.notEqual(failureKey(REPOSITORY, 41), failureKey(OTHER_REPOSITORY, 41));
  assert.notEqual(failureKey(REPOSITORY, 41), failureKey(REPOSITORY, 42));
  assert.equal(failureKey(REPOSITORY, 41), failureKey(REPOSITORY, 41));

  // The separator is `#`, which a GitHub repository name cannot contain (`[A-Za-z0-9._-]` per half), so
  // there is exactly one, at the end of the repository, and the encoding cannot collide. Pinned rather
  // than assumed: a separator a name *could* contain would let `a#b` + run 1 and `a` + run `b#1` be the
  // same key, and the two checks above would still pass.
  assert.equal(failureKey(REPOSITORY, 41), `${REPOSITORY}#41`);
  assert.equal(failureKey(REPOSITORY, 41).indexOf('#'), REPOSITORY.length);
});

test('另外一个仓库的同号 run 不会被当成同一条失败', () => {
  // The rule above, checked where it is load-bearing rather than where it is cheap: a history that
  // already contains `t1mb2rg/hikari-new` run 41 must not silence `t1mb2rg/other-repository` run 41.
  const handled = new Set([failureKey(REPOSITORY, 41)]);
  const delivered = new Set([failureKey(REPOSITORY, 41)]);

  const other = observation({ kind: 'reported', run: run() }, { repository: OTHER_REPOSITORY });
  const detected = detectNewFailure(other, handled, delivered);

  assert.notEqual(detected, undefined, '另一个仓库的 41 号 run 是一次全新的失败');
  assert.equal(detected.repository, OTHER_REPOSITORY);

  // And the reverse direction, so this is not passing because the key is simply never consulted.
  assert.equal(detectNewFailure(reported(), handled, delivered), undefined);
});

test('写进 Chronicle 的就是那条命题，没有解释，也没有第二份事实', () => {
  const draft = deliveryFactDraft(occurrence());

  assert.equal(draft.type, DELIVERED_FACT_TYPE);
  assert.equal(draft.version, 1);
  assert.deepEqual(draft.source, { kind: DELIVERY_SOURCE_KIND });
  assert.deepEqual(draft.payload, { repository: REPOSITORY, runId: 41 });

  // The payload is identity and nothing else. The workflow, branch, sha and conclusion are all in the
  // occurrence and all *about the failure*; copying them in would make this a second record of the
  // failure rather than a record of the delivery, and the two copies would drift the first time either
  // changed. A reader of this family asks one question, "has this been delivered", and the key answers it.
  assert.deepEqual(Object.keys(draft.payload).sort(), ['repository', 'runId']);

  // The shape `append` will accept, asserted here so that a draft which only fails on disk fails here
  // first. `isUtcTimestamp` requires exactly this form and round-trips it through `toISOString`.
  assert.match(draft.occurredAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(new Date(draft.occurredAt).toISOString(), draft.occurredAt);

  // And the timestamp means the delivery, not the observation. That distinction is the whole reason
  // this function reads the clock instead of copying a field, so it is asserted rather than left to the
  // shape check above — which the fixture's `observedAt` satisfies just as well, because it is also a
  // well-formed UTC timestamp. Mutation testing is what showed the gap: replacing `occurredAt` with
  // `occurrence.observedAt` left the entire suite green. The two are different facts about the world —
  // when CI failed, and when a human was told — and a reader that sorted this history by time would be
  // reading the wrong one. The observed time is set far enough in the past that the direction of the
  // comparison is the assertion, not the calendar.
  const longAgo = '2020-01-01T00:00:00.000Z';
  const at = deliveryFactDraft(occurrence({ observedAt: longAgo }));
  assert.notEqual(at.occurredAt, longAgo, 'occurredAt 是投递时刻，不是观察时刻');
  assert.ok(
    Date.parse(at.occurredAt) > Date.parse(longAgo),
    '投递发生在观察之后，时间戳必须朝前走',
  );
});

test('读自己的历史：只认本族、只认版本 1、payload 不对就不认', () => {
  const good = deliveredFact(REPOSITORY, 41);
  const facts = [
    good,
    // A sibling's fact. The store is shared — `work-focus` writes into the same file — so a reader that
    // stumbled on one would break the moment another owner admitted anything at all.
    { ...good, factId: 'x1', type: 'work-focus.declared', payload: { designation: '仓库 Y' } },
    // The same sibling again, now carrying a payload this family *would* accept and naming a failure
    // of the same repository that is not in the list at all. This is the only entry here that pins the
    // type check: every other foreign line falls out on its payload first, and a sibling repeating a
    // key already present would be swallowed by the set. Mutation testing is what found that —
    // deleting the `fact.type` comparison left the entire suite green. The run id has to differ for
    // the case to be about anything, and it is not contrived: `work-focus` keys its own facts by a
    // repository-shaped designation and writes numbers that look like run ids into the same file, so
    // a payload both families can read is something the store can genuinely hold. A reader without the
    // type check would answer "already delivered" about a failure nobody ever announced.
    {
      ...good,
      factId: 'x1b',
      type: 'work-focus.declared',
      payload: { repository: REPOSITORY, runId: 99 },
    },
    // Not this version. `fact.ts` checks that a version is a positive integer and does *not* reject an
    // unknown one, so refusing to guess at a shape this code has never seen is the reader's job.
    { ...good, factId: 'x2', version: 2 },
    // The store is a file, and a file can be edited. None of these is evidence of a delivery, and
    // reading a run id out of one would be inventing the fact rather than finding it.
    { ...good, factId: 'x3', payload: null },
    { ...good, factId: 'x4', payload: 'repository-ci-attention.delivered' },
    { ...good, factId: 'x5', payload: [] },
    { ...good, factId: 'x6', payload: {} },
    { ...good, factId: 'x7', payload: { repository: 41, runId: REPOSITORY } },
    { ...good, factId: 'x8', payload: { repository: REPOSITORY } },
    { ...good, factId: 'x9', payload: { repository: REPOSITORY, runId: 41.5 } },
    { ...good, factId: 'x10', payload: { repository: REPOSITORY, runId: '41' } },
    { ...good, factId: 'x11', payload: { repository: REPOSITORY, runId: Number.MAX_SAFE_INTEGER + 2 } },
  ];

  // Exactly one key, and the good fact is at the front *and* surrounded — a reader that stopped at the
  // first unrecognised line would return the same thing here, so the good fact is also placed last.
  assert.deepEqual([...readDeliveredFailures(facts)], [failureKey(REPOSITORY, 41)]);
  assert.deepEqual([...readDeliveredFailures([...facts.slice(1), good])], [failureKey(REPOSITORY, 41)]);
});

test('读历史永远不抛：没有历史、全是别人的、全是坏行，都只是空集', () => {
  // The reader's whole failure policy is "skip what it does not recognise", so the honest statement of
  // it is that no input makes it throw — not that a particular input returns a particular set. An
  // empty set is a real answer here; what it must not become is a claim. The caller is the one that
  // decides what an empty set means, and `plugin.ts` is where that is written down.
  const sibling = {
    factId: 'a',
    type: 'work-focus.cleared',
    version: 1,
    occurredAt: OBSERVED_AT,
    recordedAt: OBSERVED_AT,
    source: { kind: 'work-focus.endpoint' },
    payload: {},
  };

  const cases = [
    [],
    [sibling],
    [{ ...deliveredFact(REPOSITORY, 41), version: 3 }],
    [{ ...deliveredFact(REPOSITORY, 41), payload: undefined }],
  ];

  for (const facts of cases) {
    assert.deepEqual([...readDeliveredFailures(facts)], [], '认不出来的一律跳过，不是抛错');
  }
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

test('Attention 的 requires 恰好是那四个问题，provides 为空', () => {
  assert.equal(repositoryCiAttentionPlugin.id, 'repository-ci-attention');
  assert.equal(repositoryCiAttentionPlugin.version, '1.0.0');

  // Four requirements and each is a different question this plugin cannot answer itself: what
  // happened, how to say it, whether anyone is listening, and what it has said before. Asserted as an
  // exact sequence, because the claim that matters includes "and nothing else" — a fifth entry would be
  // this decider reaching for something it has no business knowing.
  //
  // This assertion has been widened once, and the widening is the whole of this slice. It used to say
  // three, and its comment said a fourth entry would be out of bounds. That was true while the plugin
  // had no memory: with nothing to remember, a store would have been a capability it could not use. The
  // Human ruling then asked for exactly the memory this composition could not previously justify — the
  // same failure must not be announced twice across a restart — and the store stopped being speculative
  // the moment there was a question only it could answer. The reason the list is still checked as an
  // exact sequence is that the argument has to be made again for whatever comes fifth.
  assert.deepEqual(repositoryCiAttentionPlugin.requires, [
    gitHubCiService,
    languageSpeakingService,
    humanDeliveryService,
    chronicleService,
  ]);
  assert.deepEqual(
    repositoryCiAttentionPlugin.requires.map((contract) => `${contract.id}@${contract.version}`),
    ['github-ci.current@1', 'language.speaking@1', 'human-delivery.deliver@1', 'chronicle@1'],
  );

  // Empty, and there is nothing to provide. A decider that only ever speaks has no capability another
  // module could ask it for, and giving it one so that it "looks like it has an output" is exactly the
  // cosmetic `provides` the design spec's MUST forbids. Reading a store is not providing one: the
  // durable substrate belongs to `chronicle`, and this plugin's own history stays its own business.
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
  // The durable-history slice added a second list, and it is the one its own mandate names: the
  // structures it was told not to build while making a delivery durable. Same shape as the line above,
  // same reasoning — compound identifiers, so the comments that *deny* these things do not red here.
  const forbiddenByThisSlice =
    /\b(?:ExperienceService|MemoryService|CognitiveBus|GlobalExperienceStore|CentralCognition|HistoricalQueryRouter|HistoryQueryRouter|DeduplicationFramework)\b/;
  const offenders = sourceFiles(ATTENTION_SOURCE).filter((file) => {
    const source = readFileSync(file, 'utf8');
    return forbidden.test(source) || forbiddenByThisSlice.test(source);
  });

  assert.deepEqual(
    offenders.map((file) => relative(ATTENTION_SOURCE, file).replaceAll('\\', '/')),
    [],
  );
});

// ---------------------------------------------------------------------------------------------
// The cadence, the handled set and the delivery policy — against the real Runtime.
// ---------------------------------------------------------------------------------------------

// No injection seam: the plugin under test is the production one, and the four capabilities it
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

// The store, as a fake, for the same reason the transport is a fake: so that a test can command the
// one thing about it that matters here — which way it fails. A real Chronicle cannot be asked to fail
// on demand, and "append failed" and "read failed" are two of the behaviours this slice is required to
// get right rather than to hope about.
//
// It keeps its facts for as long as the *provider* is loaded, not for as long as the decider is. That
// is the whole point: unloading and reloading the decider leaves the store standing, which is what a
// restart looks like from the decider's side. The real thing is exercised at the bottom of this file.
function chronicleProvider({ seed = [], failReads = 0, failAppends = 0 } = {}) {
  const facts = [...seed];
  const counts = { reads: 0, appends: 0 };
  const definition = {
    id: CHRONICLE_PROVIDER,
    version: '1.0.0',
    provides: [chronicleService],
    setup(context) {
      context.services.provide(chronicleService, {
        append(draft) {
          counts.appends += 1;
          if (counts.appends <= failAppends) return Promise.reject(new Error('chronicle 写不进去'));
          const fact = Object.freeze({
            factId: `fake-${counts.appends}`,
            type: draft.type,
            version: draft.version,
            occurredAt: draft.occurredAt,
            recordedAt: draft.occurredAt,
            source: draft.source,
            payload: draft.payload,
          });
          facts.push(fact);
          return Promise.resolve(fact);
        },
        get(factId) {
          return Promise.resolve(facts.find((fact) => fact.factId === factId));
        },
        read() {
          counts.reads += 1;
          if (counts.reads <= failReads) return Promise.reject(new Error('chronicle 读不出来'));
          return Promise.resolve(facts);
        },
      });
    },
  };
  return { definition, facts, counts };
}

async function compose(runtime, { ci, speaking, delivery, chronicle = chronicleProvider(), delayMs }) {
  await runtime.loadPlugin(ci.definition);
  await runtime.loadPlugin(speaking.definition);
  await runtime.loadPlugin(delivery.definition);
  await runtime.loadPlugin(chronicle.definition);
  return loadDecider(runtime, delayMs);
}

// Split out from `compose` so that a test about reactivation can load the decider a second time
// without reloading the four providers, which are already loaded and would be rejected as such.
async function loadDecider(runtime, delayMs) {
  const state = await runtime.loadPlugin(repositoryCiAttentionPlugin, { delayMs });
  assert.equal(state, 'active', '四个 capability 都在时，decider 应当 active');
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

// The same wait, for a condition that has to go and look — the real store, in the section at the
// bottom. It is a separate function rather than an `async` predicate passed to `until` so that a
// condition which never becomes true still fails with the message and not with an unhandled rejection.
async function untilAsync(condition, message, deadlineMs = 2000) {
  const startedAt = Date.now();
  while (!(await condition())) {
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

  // Every cycle reports the same red run. Without the handled set this would be a message every poll —
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
  // narrow. The intermediate sightings must handle nothing and record nothing either, which is what
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
  // sent again on the chance that a client is watching now.
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

test('只有 delivered 会被写进 Chronicle，unavailable 和 failed 不会', async (t) => {
  for (const outcome of ['delivered', 'unavailable', 'failed']) {
    const runtime = new Runtime();
    t.after(() => runtime.shutdown());

    const ci = ciProvider(() => failure());
    const speaking = speakingProvider();
    const delivery = deliveryProvider(() => ({ outcome }));
    const chronicle = chronicleProvider();
    await compose(runtime, { ci, speaking, delivery, chronicle, delayMs: 2 });

    await until(() => delivery.delivered.length >= 1, `${outcome}：没有尝试投递`);
    await until(() => ci.counts.calls >= 3, `${outcome}：轮次不够`);
    await elapsed(20);

    // The whole of the admission rule, and the reason it is worth three runs rather than one. A store
    // that recorded the attempt rather than the result would make `unavailable` and `failed` buy
    // silence — a transport that is down would be the thing that stops Hikari speaking — which is
    // exactly the claim `handled ≠ delivered ≠ human observed` exists to keep out.
    assert.equal(
      chronicle.facts.length,
      outcome === 'delivered' ? 1 : 0,
      `${outcome}：只有 delivered 配得上一条成功记录`,
    );

    if (outcome === 'delivered') {
      assert.equal(chronicle.facts[0].type, DELIVERED_FACT_TYPE);
      assert.deepEqual(chronicle.facts[0].payload, { repository: REPOSITORY, runId: 41 });
    }
  }
});

test('append 失败不会被说成成功，也不回滚、不重试、不抛', async (t) => {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  const ci = ciProvider(() => failure());
  const speaking = speakingProvider();
  const delivery = deliveryProvider();
  const chronicle = chronicleProvider({ failAppends: Number.MAX_SAFE_INTEGER });
  await compose(runtime, { ci, speaking, delivery, chronicle, delayMs: 2 });

  await until(() => chronicle.counts.appends >= 1, 'append 没有被尝试');
  await until(() => ci.counts.calls >= 3, '循环因为一次 append 失败而停了');
  await elapsed(20);

  // Three things at once, and each one is a different way of lying that this does not do. It does not
  // claim the write happened; it does not turn a failed write into a fresh attempt — the announcement
  // did go out, and re-sending it would be a retry loop nobody wrote; and it does not turn a store
  // failure into this plugin's failure.
  assert.equal(chronicle.facts.length, 0, '没写进去就是没写进去');
  assert.equal(delivery.delivered.length, 1, 'append 失败不得变成重投');
  assert.equal(runtime.getPluginState('repository-ci-attention'), 'active');
  assert.equal(runtime.getPluginError('repository-ci-attention'), undefined);
});

test('读历史失败时朝「说」降级，不是朝「沉默」降级', async (t) => {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  // The store holds a record that this failure was delivered, and this activation cannot read it. The
  // one thing that must not follow is silence: a store that cannot be read would become a gag, and the
  // entitlement to stop speaking belongs to a fact somebody can actually see.
  const ci = ciProvider(() => failure());
  const speaking = speakingProvider();
  const delivery = deliveryProvider();
  const chronicle = chronicleProvider({
    seed: [deliveredFact(REPOSITORY, 41)],
    failReads: Number.MAX_SAFE_INTEGER,
  });
  await compose(runtime, { ci, speaking, delivery, chronicle, delayMs: 2 });

  await until(() => delivery.delivered.length >= 1, '读不到历史就什么都不说了——降级方向反了');
  await until(() => ci.counts.calls >= 3, '循环停了');
  await elapsed(20);

  // Speaking again is the honest cost: the fact is on disk, and this activation simply cannot see it.
  // What must not happen is the other reading — "nothing was ever announced" — and nothing here takes
  // it. An empty set is not evidence of an empty past, and the code that catches this read says so.
  assert.equal(delivery.delivered.length, 1);
  assert.equal(runtime.getPluginError('repository-ci-attention'), undefined);
});

test('读历史每个 activation 只试一次，失败之后不在下一轮重试', async (t) => {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  const ci = ciProvider(() => failure());
  const speaking = speakingProvider();
  const delivery = deliveryProvider();
  // Fails the first read and would succeed at the second. That is what makes the count below decide
  // something: a retry loop would read again on the very next cycle, find the seeded fact, and go
  // quiet. This slice has no retry — in the store or in the transport — so the activation stays
  // degraded until it ends, and the seeded fact is never seen.
  const chronicle = chronicleProvider({ seed: [deliveredFact(REPOSITORY, 41)], failReads: 1 });
  await compose(runtime, { ci, speaking, delivery, chronicle, delayMs: 2 });

  await until(() => ci.counts.calls >= 6, '轮次不够，看不出是不是只读了一次');
  await elapsed(20);

  assert.equal(chronicle.counts.reads, 1, '一个 activation 只读一次历史');
  assert.equal(delivery.delivered.length, 1, '降级之后再没有翻过旧账');
});

test('历史里已经成功投递过的失败，新的 activation 不再播报', async (t) => {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  const ci = ciProvider(() => failure());
  const speaking = speakingProvider();
  const delivery = deliveryProvider();
  const chronicle = chronicleProvider({ seed: [deliveredFact(REPOSITORY, 41)] });
  await compose(runtime, { ci, speaking, delivery, chronicle, delayMs: 2 });

  await until(() => ci.counts.calls >= 4, 'polling 没有继续');
  await elapsed(20);

  assert.equal(delivery.delivered.length, 0, '以前投递成功过的失败不得再说一次');
  assert.equal(speaking.spoken.length, 0, 'Language 也不该被叫起来');
  // Staying quiet about one failure is not the same as stopping. It keeps looking, and it is still
  // the same plugin — the history is evidence it consults, not a switch that turns it off.
  assert.equal(runtime.getPluginState('repository-ci-attention'), 'active');
});

test('历史只压住那一条，同一个仓库的新失败照说', async (t) => {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  // The counterweight to the test above. Without it, a plugin that went permanently silent the moment
  // its history was non-empty would pass everything here.
  const ci = ciProvider(() => failure(42));
  const speaking = speakingProvider();
  const delivery = deliveryProvider();
  const chronicle = chronicleProvider({ seed: [deliveredFact(REPOSITORY, 41)] });
  await compose(runtime, { ci, speaking, delivery, chronicle, delayMs: 2 });

  await until(() => delivery.delivered.length >= 1, '新的 run id 被旧的历史压住了');
  await elapsed(20);

  assert.deepEqual(
    speaking.spoken.map((entry) => entry.occurrence.runId),
    [42],
  );
  assert.equal(chronicle.facts.length, 2, '新投递的那一条也应当留下事实');
});

test('一个仓库的历史不会消掉另一个仓库的同号失败', async (t) => {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  // The Chronicle belongs to Hikari, not to a repository, so this is the ordinary case rather than a
  // contrived one: two repositories' histories sit in the same file. Keyed on the run id alone, this
  // test's first history would silence a failure in a different repository entirely.
  const ci = ciProvider(() => failure());
  const speaking = speakingProvider();
  const delivery = deliveryProvider();
  const chronicle = chronicleProvider({ seed: [deliveredFact(OTHER_REPOSITORY, 41)] });
  await compose(runtime, { ci, speaking, delivery, chronicle, delayMs: 2 });

  await until(() => delivery.delivered.length >= 1, '另一个仓库的历史把这条压掉了');
  await elapsed(20);

  assert.equal(speaking.spoken[0].occurrence.repository, REPOSITORY);
  assert.equal(speaking.spoken[0].occurrence.runId, 41);
});

test('再激活一次：投递成功过的不再重报', async (t) => {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  // This test used to assert the opposite, and its comment used to explain that "a restart remembers"
  // would require exactly the store this slice forbade. That is no longer the answer, and the store it
  // named is the one this plugin now reads: the handled set is still activation-local, but a delivery
  // that came back `delivered` is a fact about the past, and the next activation is entitled to it.
  //
  // The store survives the decider's unload because it is a different plugin. That is what a restart
  // looks like from here; the real thing, with a real file, is at the bottom of this file.
  const ci = ciProvider(() => failure());
  const speaking = speakingProvider();
  const delivery = deliveryProvider();
  const chronicle = chronicleProvider();
  await compose(runtime, { ci, speaking, delivery, chronicle, delayMs: 2 });

  await until(() => delivery.delivered.length >= 1, '第一次激活没有播报');
  await until(() => chronicle.facts.length >= 1, '成功投递没有留下事实');

  const seen = ci.counts.calls;
  await runtime.unloadPlugin('repository-ci-attention');
  await loadDecider(runtime, 2);

  await until(() => ci.counts.calls >= seen + 3, '第二次激活没有继续看');
  await elapsed(20);

  assert.equal(delivery.delivered.length, 1, '投递成功过的失败不该在重启后重报');
  assert.deepEqual(
    speaking.spoken.map((entry) => entry.occurrence.runId),
    [41],
  );
});

test('重启只压住投递成功过的：一次 unavailable 之后，重启仍然会说', async (t) => {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  // The boundary of the silence, stated as behaviour rather than as a sentence. `unavailable` means
  // nobody was connected; it does not mean anybody was told, so the next activation has no fact to
  // stand on and must speak again. Silence is bought with a successful delivery and with nothing else.
  const ci = ciProvider(() => failure());
  const speaking = speakingProvider();
  const delivery = deliveryProvider(() => ({ outcome: 'unavailable' }));
  const chronicle = chronicleProvider();
  await compose(runtime, { ci, speaking, delivery, chronicle, delayMs: 2 });

  await until(() => delivery.delivered.length >= 1, '第一次激活没有尝试投递');
  await until(() => ci.counts.calls >= 2, '轮次不够');
  assert.equal(chronicle.facts.length, 0, 'unavailable 不得留下成功记录');

  const seen = ci.counts.calls;
  await runtime.unloadPlugin('repository-ci-attention');
  await loadDecider(runtime, 2);

  await until(() => delivery.delivered.length >= 2, '没投递成功过，重启后应当再说一次');
  assert.deepEqual(
    speaking.spoken.map((entry) => entry.occurrence.runId),
    [41, 41],
  );
});

test('这次改动没有动任何协议：三个被借用的 contract 仍是原来的 id 与版本', () => {
  // A protocol change in this repository has to be published as a version, so the claim "nothing was
  // bent to make room for this slice" has a mechanical form: the versions are what they were. The
  // fourth entry is new, and it is the only one — Human Delivery still answers three outcomes, Language
  // still takes the occurrence, and the Runtime itself was not touched at all.
  const ids = repositoryCiAttentionPlugin.requires.map((contract) => `${contract.id}@${contract.version}`);
  assert.equal(ids.length, 4);
  for (const unchanged of ['github-ci.current@1', 'language.speaking@1', 'human-delivery.deliver@1']) {
    assert.ok(ids.includes(unchanged), `${unchanged} 不该因为这次改动而变版本`);
  }
  assert.equal(ids.at(-1), 'chronicle@1', '新增的是那一个，而且只有一个');
});

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sourceFiles(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

// ---------------------------------------------------------------------------------------------
// The real thing. A store on a disk, written by one composition and read back by another one with
// its own Runtime — which is the only way to check the half a fake cannot reach: that a draft this
// owner builds survives `append`, serialization, `fsync`, and being parsed by a reader that is not
// the writer.
// ---------------------------------------------------------------------------------------------

function realRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'hikari-ci-attention-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // The same two calls `hikari init` and `hikari chronicle init` make. A resident that has not been
  // initialized does not start at all, so a test that skipped these would be exercising a composition
  // no operator can actually run.
  const identity = initializeHikari({ rootDir: root });
  initializeChronicle({ rootDir: root, identity });
  return root;
}

// The composition the resident has, as closely as a test can build one: continuity and the store are
// the real plugins over a real directory, while perception and the two transports stay faked because a
// test cannot ask GitHub anything and has no pipe. Loaded in the resident's order — the store before
// the decider (`src/cli/resident.ts:226` before `:342`), because a requirement that arrives late
// leaves the decider `waiting` rather than active.
async function realComposition(root, { ci, speaking, delivery, delayMs, beforeDecider }) {
  const runtime = new Runtime();
  await runtime.loadPlugin(continuityPlugin, { rootDir: root });
  await runtime.loadPlugin(chroniclePlugin, { rootDir: root });
  await runtime.loadPlugin(ci.definition);
  await runtime.loadPlugin(speaking.definition);
  await runtime.loadPlugin(delivery.definition);

  // A seam for the one failure the rest of the file cannot reach: the store opening successfully and
  // then going bad before the decider's first cycle reads it. `openChronicle` parses the whole file, so
  // a store that is already broken when the composition starts never gets this far — the store's own
  // plugin fails first. Corrupting here is what makes a *read* failure reachable while active.
  if (beforeDecider !== undefined) beforeDecider();

  const state = await runtime.loadPlugin(repositoryCiAttentionPlugin, { delayMs });
  assert.equal(state, 'active', '真实组合里 decider 应当 active');
  return runtime;
}

// Read by a service that is not the one the plugin is using: a separate reader opened on the same
// directory, which parses the store out of the file on every call. Asking the Runtime's own service
// would be asking the plugin to grade its own work, and would pass just as happily if nothing had
// reached the disk.
function readFacts(root) {
  return openChronicle({ rootDir: root, identity: restoreHikari({ rootDir: root }) }).read();
}

test('真实 Chronicle：成功投递落盘，另一个 Runtime 读得回来，并且不再重报', async (t) => {
  const root = realRoot(t);

  const ci = ciProvider(() => failure());
  const speaking = speakingProvider();
  const delivery = deliveryProvider();
  const first = await realComposition(root, { ci, speaking, delivery, delayMs: 2 });

  await untilAsync(async () => (await readFacts(root)).length >= 1, '成功投递的事实没有落盘');
  await first.shutdown();

  // What actually reached the file, read by somebody else, with every field the store insists on.
  const [fact] = await readFacts(root);
  assert.equal(fact.type, DELIVERED_FACT_TYPE);
  assert.equal(fact.version, 1);
  assert.equal(fact.source.kind, DELIVERY_SOURCE_KIND);
  assert.deepEqual(fact.payload, { repository: REPOSITORY, runId: 41 });
  // The store generates this, not this owner — a UUID rather than anything derived from the failure,
  // which is why the reader cannot look a fact up by id and has to read the history instead.
  assert.match(fact.factId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

  // A second Runtime, built from the same data directory and nothing else. This is the restart the
  // product decision is about: the first composition is gone, out of memory, shut down. Everything the
  // second one knows about the past it has to get off the disk.
  const after = ciProvider(() => failure());
  const afterSpeaking = speakingProvider();
  const afterDelivery = deliveryProvider();
  const second = await realComposition(root, {
    ci: after,
    speaking: afterSpeaking,
    delivery: afterDelivery,
    delayMs: 2,
  });
  t.after(() => second.shutdown());

  await until(() => after.counts.calls >= 4, '重启后的激活没有继续看');
  await elapsed(20);

  assert.equal(afterDelivery.delivered.length, 0, '重启后把一条已经投递过的失败又说了一遍');
  assert.equal(afterSpeaking.spoken.length, 0);
});

test('真实 Chronicle：一次不成功的投递不落盘，重启后仍然会说', async (t) => {
  const root = realRoot(t);

  const ci = ciProvider(() => failure());
  const delivery = deliveryProvider(() => ({ outcome: 'unavailable' }));
  const first = await realComposition(root, { ci, speaking: speakingProvider(), delivery, delayMs: 2 });

  await until(() => delivery.delivered.length >= 1, '第一次激活没有尝试投递');
  await until(() => ci.counts.calls >= 3, '轮次不够');
  await elapsed(20);

  // The file is empty, and it is really empty — read off the disk rather than inferred from a fake.
  // This is the other half of the case above: silence has to be bought with a delivery that succeeded,
  // or a transport that is down would be the thing that stops Hikari speaking.
  assert.deepEqual(await readFacts(root), []);
  await first.shutdown();

  const after = ciProvider(() => failure());
  const afterDelivery = deliveryProvider();
  const second = await realComposition(root, {
    ci: after,
    speaking: speakingProvider(),
    delivery: afterDelivery,
    delayMs: 2,
  });
  t.after(() => second.shutdown());

  await until(() => afterDelivery.delivered.length >= 1, '没投递成功过，重启后应当再说一次');
  await elapsed(20);
  assert.equal(afterDelivery.delivered.length, 1);
});

test('真实 Chronicle：投递在激活收尾途中才返回，落盘照做而不是作废', async (t) => {
  const root = realRoot(t);

  // A transport this test answers by hand, because the rule under test lives in the window between the
  // bytes going out and the outcome coming back, and nothing else can hold that window open.
  let release;
  let announceStarted;
  const started = new Promise((resolve) => {
    announceStarted = resolve;
  });
  const delivery = {
    definition: {
      id: DELIVERY_PROVIDER,
      version: '1.0.0',
      provides: [humanDeliveryService],
      setup(context) {
        context.services.provide(humanDeliveryService, {
          deliver() {
            announceStarted();
            return new Promise((resolve) => {
              release = resolve;
            });
          },
        });
      },
    },
  };

  const ci = ciProvider(() => failure());
  const runtime = await realComposition(root, {
    ci,
    speaking: speakingProvider(),
    delivery,
    delayMs: 2,
  });

  await started;

  // The termination begins while the delivery is still in flight: the composition is asked to stop
  // before the transport has answered. The shutdown promise is held rather than awaited, because it
  // cannot resolve until this cycle does — it awaits the plugin's own deferred cleanup, which awaits
  // the cycle, which is where the delivery is parked. Awaiting it here would deadlock the test.
  const shutdown = runtime.shutdown();

  release({ outcome: 'delivered' });
  await shutdown;

  // The bytes went out, so the fact is written — even though this activation was already being torn
  // down when the answer arrived. That is the deliberate omission of a `stopped` check between the two:
  // a delivery that really happened is not made un-happened by the activation ending during it, and
  // dropping the record would lose a true fact about the past to keep a tidier boundary. The visible
  // price of the opposite choice is that the next activation re-announces a failure that was in fact
  // announced, and this assertion is what makes that price visible before it is paid.
  const [fact] = await readFacts(root);
  assert.equal(fact?.type, DELIVERED_FACT_TYPE);
  assert.deepEqual(fact?.payload, { repository: REPOSITORY, runId: 41 });
});

test('真实 Chronicle：文件里混着别人的事实时，读回仍然只认自己那一条', async (t) => {
  const root = realRoot(t);

  // A sibling's fact, written through the store's own service — the same thing `work-focus` does to
  // this file every time a human declares a focus. The store is shared, so this is the ordinary state
  // of the file rather than a contrived one, and a reader that stumbled on it would break the moment
  // any other owner admitted anything.
  await openChronicle({ rootDir: root, identity: restoreHikari({ rootDir: root }) }).append({
    type: 'work-focus.declared',
    version: 1,
    occurredAt: OBSERVED_AT,
    source: { kind: 'work-focus.endpoint' },
    payload: { designation: '仓库 Y' },
  });

  const ci = ciProvider(() => failure());
  const delivery = deliveryProvider();
  const runtime = await realComposition(root, {
    ci,
    speaking: speakingProvider(),
    delivery,
    delayMs: 2,
  });
  t.after(() => runtime.shutdown());

  await untilAsync(async () => (await readFacts(root)).length >= 2, '成功投递的事实没有落盘');
  await elapsed(20);

  const facts = await readFacts(root);
  assert.deepEqual(
    facts.map((fact) => fact.type).sort(),
    [DELIVERED_FACT_TYPE, 'work-focus.declared'],
    '两条事实都在文件里，读回只认自己那一条',
  );
  assert.equal(delivery.delivered.length, 1);
  assert.equal(runtime.getPluginError('repository-ci-attention'), undefined);
});

test('真实 Chronicle：一次成功投递之后 store 被写坏，同一轮就朝「说」降级', async (t) => {
  const root = realRoot(t);

  // A delivered fact for exactly the failure CI is about to report, written through the store's own
  // service — the same call the plugin makes when it succeeds. So the history on disk says "this one has
  // been announced", and a readable store would keep the decider quiet about it.
  await openChronicle({ rootDir: root, identity: restoreHikari({ rootDir: root }) }).append({
    type: DELIVERED_FACT_TYPE,
    version: 1,
    occurredAt: OBSERVED_AT,
    source: { kind: DELIVERY_SOURCE_KIND },
    payload: { repository: REPOSITORY, runId: 41 },
  });
  assert.equal((await readFacts(root)).length, 1, '历史得先在盘上，测的才是「读不到」');

  // Then the store goes bad — one malformed line, appended the way any writer of this file could append
  // one, while this composition's store is already open. That ordering is the whole point: the read
  // failure the ruling names is only reachable while the store is open, because opening it parses the
  // file and a store that is already broken never gets this far (see the next test).
  const afterDelivery = deliveryProvider();
  const ci = ciProvider(() => failure());
  // A cadence longer than the whole observation window below, and that is a deliberate part of what this
  // test decides rather than a slow constant. The read failure has to be contained *inside the cycle it
  // happened in*: if it were allowed to escape, the cycle's own catch would swallow it, the next cycle
  // would find the flag already set, skip the read and speak normally — a full cadence later, and with no
  // one the wiser. At `delayMs: 2` that variant passed, because a second cycle arrives long before
  // `until` gives up. With the cadence past the deadline, the only cycle that can answer is the first
  // one, so "it spoke" and "it spoke without waiting out a broken read" become the same assertion.
  const runtime = await realComposition(root, {
    ci,
    speaking: speakingProvider(),
    delivery: afterDelivery,
    delayMs: 10_000,
    beforeDecider: () => appendFileSync(resolveChroniclePath(root), 'not json\n'),
  });
  t.after(() => runtime.shutdown());

  // It speaks — and it speaks about the very failure the unreadable history says was already announced.
  // That is the degradation direction stated as behaviour rather than as intent: an unreadable store
  // must not be able to gag Hikari, and it must not be turned into the claim "nothing was ever announced
  // before" either. Empty is what it degrades to, and empty is not evidence.
  await until(() => afterDelivery.delivered.length >= 1, '读历史失败时必须照常播报，而不是沉默');
  await elapsed(20);
  assert.equal(afterDelivery.delivered.length, 1, '一个激活里仍然只说一次');
});

test('真实 Chronicle：启动时 store 就已经坏了，decider 停在 waiting 而不是假装有历史', async (t) => {
  const root = realRoot(t);

  // Appending a bad line *before* anything opens the store hits the other failure. `openChronicle` calls
  // `readStoreForOwner` eagerly, so the store's own plugin fails to set up, the contract is never
  // provided, and this decider — which requires it — is never activated. This is a real consequence of
  // requiring the store rather than a hypothetical, and it is pinned here rather than left implied: for
  // as long as the store cannot be opened, Hikari does not watch CI at all. The alternative shape would
  // be an optional requirement, which the Runtime does not have; see the boundary record §5.
  appendFileSync(resolveChroniclePath(root), 'not json\n');

  const runtime = new Runtime();
  await runtime.loadPlugin(continuityPlugin, { rootDir: root });
  assert.equal(await runtime.loadPlugin(chroniclePlugin, { rootDir: root }), 'failed');

  const ci = ciProvider(() => failure());
  const delivery = deliveryProvider();
  await runtime.loadPlugin(ci.definition);
  await runtime.loadPlugin(speakingProvider().definition);
  await runtime.loadPlugin(delivery.definition);
  t.after(() => runtime.shutdown());

  assert.equal(await runtime.loadPlugin(repositoryCiAttentionPlugin, { delayMs: 2 }), 'waiting');

  // Waiting, and not quietly running without its history: `setup` never ran, so no cycle was ever armed
  // and nothing was asked of CI or of the transport. The gate is the Runtime's own requirement mechanic
  // rather than a branch in this plugin, which is why the assertion is about calls that never happened.
  await elapsed(20);
  assert.equal(ci.counts.calls, 0);
  assert.equal(delivery.delivered.length, 0);
});
