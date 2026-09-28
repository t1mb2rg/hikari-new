import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';

import { Runtime } from '../dist/index.js';
import {
  INITIAL_DESKTOP_RETURN_WATCH,
  desktopReturnAttentionPlugin,
  formOccurrence,
  renderOccurrence,
  stepReturn,
} from '../dist/desktop-return-attention/index.js';
import { humanDeliveryService } from '../dist/human-delivery/index.js';
import { inputActivityService } from '../dist/input-activity/index.js';
import {
  languageDesktopReturnSpeakingService,
  languageSpeakingService,
  renderSpokenReturn,
} from '../dist/language/index.js';
import { oneLine } from '../dist/terminal-text/index.js';
import { workFocusCurrentService } from '../dist/work-focus/index.js';

// Two halves in one file, and the split is the one `repository-ci-attention.test.mjs` describes.
//
// The judgement and the wording are pure functions, so their tests need no clock, no Windows host and no
// runtime, and they run on `ubuntu-latest` — which is where a rule that is only pinned behind a Windows
// child process stops being checked at all. That is not hypothetical in this repository: the whole of
// the temporal arithmetic lives in a module whose production caller cannot even be activated on Linux.
//
// The cadence and the delivery policy are the other half, exercised against the real Runtime with fake
// capability providers, so a test can choose exactly which observation arrives on which cycle and read
// back what left through the transport. The observations are driven by the test and never by the clock:
// `delayMs` decides *when* a cycle runs, and nothing in the judgement reads a wall clock, so a test that
// wants a return to happen writes the counter readings that describe one.
//
// What this file deliberately does not test is that a real Windows machine reports real input, or that a
// real client receives anything. Both need this machine, both are reported separately, and a green run
// here says nothing about either.

const OBSERVED_AT = '2026-03-01T09:00:00.000Z';
const SOURCE = 'input-activity.windows';

// A counter reading and a threshold, both arbitrary and both chosen to be small enough that the sums
// below are obviously under the 32-bit ceiling — except where a test is about that ceiling.
const T = 1_000_000;
const AFTER_MS = 60_000;

const INPUT_PROVIDER = 'test.input-activity-provider';
const FOCUS_PROVIDER = 'test.work-focus-provider';
const SPEAKING_PROVIDER = 'test.return-speaking-provider';
const DELIVERY_PROVIDER = 'test.delivery-provider';

const RETURN_SOURCE = join(import.meta.dirname, '..', 'src', 'desktop-return-attention');

// Spelled as code points rather than as escapes or as literal characters, so that this file holds no
// invisible bytes — a test about invisible characters is a poor place to hide some. The same list
// `terminal-text` escapes, and the reason it exists there.
const LINE_BREAKS = [0x0d, 0x0a, 0x0b, 0x0c, 0x85, 0x2028, 0x2029];

function observation(lastInputTick, observedTick, observedAt = OBSERVED_AT) {
  return { observedAt, source: SOURCE, lastInputTick, observedTick };
}

// One whole timeline through the rule, from the state an activation starts in. Each entry is
// `[lastInputTick, observedTick]` — one acquisition's two readings — and what comes back is what each
// step ended, plus where the watch ended up. Nothing here involves a timer, which is the point: the
// cadence decides *when* this is called and never what it decides.
function drive(timeline, afterMs = AFTER_MS) {
  const ended = [];
  let watch = INITIAL_DESKTOP_RETURN_WATCH;

  for (const [lastInputTick, observedTick] of timeline) {
    const step = stepReturn(observation(lastInputTick, observedTick), watch, afterMs);
    watch = step.watch;
    ended.push(step.endedSilenceMs);
  }

  return { watch, ended };
}

// ---------------------------------------------------------------------------------------------
// What counts as a return. A truth table over a counter timeline, checkable without a Runtime, a
// cadence or a Windows host.
// ---------------------------------------------------------------------------------------------

test('基线：还没有观察到任何沉默，什么都不触发', () => {
  const { watch, ended } = drive([[T, T]]);

  assert.deepEqual(ended, [undefined]);
  assert.equal(watch.silence, undefined, '一次都没有武装过');
  assert.equal(watch.observedTick, T, '但读数被记下了，下一次才有东西可比');
});

test('连续输入从不触发：每一次观察都紧跟着一次输入', () => {
  // Twenty observations, each seeing an input within the last 100 ms — a person typing. The
  // difference never comes near the threshold, so nothing is ever armed and nothing can end.
  const timeline = Array.from({ length: 20 }, (unused, i) => [T + i * 100, T + i * 100 + 100]);
  const { watch, ended } = drive(timeline);

  assert.deepEqual(ended, timeline.map(() => undefined));
  assert.equal(watch.silence, undefined);
});

test('不到阈值的停顿不触发，哪怕停顿之后人又回来了', () => {
  // The case that makes the threshold mean something: the counter really did stand still for 30 s and
  // then move again, which is a pause and not a return at this threshold.
  const { watch, ended } = drive([
    [T, T],
    [T, T + 30_000],
    [T + 30_000, T + 30_000],
  ]);

  assert.deepEqual(ended, [undefined, undefined, undefined]);
  assert.equal(watch.silence, undefined);
});

test('沉默涨到阈值以上，人也回来了，恰好触发一次', () => {
  // The whole of the positive case, with the arming steps included so that "nothing was said while the
  // human was away" is a claim about a window that really was open rather than one that happened to be
  // narrow. The silence that ends is the *latest* reading and not the largest — here they are the same
  // number, and the next test is where the distinction would show.
  const { watch, ended } = drive([
    [T, T],
    [T, T + AFTER_MS],
    [T, T + AFTER_MS * 2],
    [T + AFTER_MS * 2, T + AFTER_MS * 2 + 5],
  ]);

  assert.deepEqual(ended, [undefined, undefined, undefined, AFTER_MS * 2]);
  assert.equal(watch.silence, undefined, '这一次沉默已经结束了');
  assert.equal(watch.observedTick, T + AFTER_MS * 2 + 5);
});

test('同一次返回不会说第二遍；要再说一次，得重新攒够一个完整的阈值', () => {
  const { ended } = drive([
    [T, T],
    [T, T + 70_000], // armed at 70 s
    [T + 70_000, T + 70_005], // the return: ends a 70 s silence
    [T + 70_005, T + 70_010], // typing right after — the same return, not a new one
    [T + 70_005, T + 140_000], // a second stretch begins
    [T + 70_005, T + 200_000], // and grows
    [T + 200_000, T + 200_005], // the second return: ends a 129_995 ms silence
  ]);

  assert.deepEqual(
    ended,
    [undefined, undefined, 70_000, undefined, undefined, undefined, 129_995],
    '两次触发之间必须隔着一整个阈值，而中间那次打字不该被再说一遍',
  );
});

test('计数器倒退时不判定，也不伪造一次返回', () => {
  // A reboot and a 32-bit wrap look identical from here — the counter reads lower than it did — and
  // this rule refuses to tell them apart. What it must not do is read the discontinuity as a return:
  // without the guard, the third reading would land in the "under it" case and report the still-armed
  // 70 s silence as an ended one — a return fabricated out of a machine that had just restarted with
  // nobody at the keyboard.
  const { watch, ended } = drive([
    [T, T],
    [T, T + 70_000], // armed
    [20, 30], // the counter went backwards
    [30, 30], // and the activation remembers nothing about the silence it had
    [30, 30 + 70_000], // a real silence, counted from the new baseline
    [30 + 70_000, 30 + 70_005], // and a real return
  ]);

  assert.deepEqual(ended, [undefined, undefined, undefined, undefined, undefined, 70_000]);
  assert.equal(watch.observedTick, 30 + 70_005, '倒退之后读数照常往前走');
});

test('跨过 32 位回绕的那段沉默，差值是它真实的长度', () => {
  // The wrap: the last input at 0xffff0000, just before the counter rolls over, and the first reading
  // this activation takes at 0x10000, just after — 131072 ms of silence, and the only step where the
  // unsigned conversion is load-bearing, because there is no previous reading for the guard to compare
  // against. A signed subtraction would make this difference a large negative number, so the silence
  // would be missed; `>>> 0` is what turns it into the duration it actually was.
  const { ended } = drive([
    [0xffff_0000, 0x1_0000],
    [0x1_0000, 0x1_0000],
  ]);

  assert.deepEqual(ended, [undefined, 0x2_0000]);
  assert.equal(0x2_0000, 131_072);

  // The other half of the same fact, and the one that keeps the wrap from being a back door: once a
  // reading has been seen, a wrap *between two observations* is a backwards counter like any other and
  // is refused just as a reboot is.
  const across = drive([
    [0xffff_0000, 0xffff_0100],
    [0x1_0000, 0x1_0001],
  ]);
  assert.deepEqual(across.ended, [undefined, undefined]);
  assert.equal(across.watch.silence, undefined);

  // And a wrap that carries a silence shorter than the threshold is still a silence shorter than the
  // threshold: the conversion is arithmetic, not a permission to arm.
  const short = drive([[0xffff_ff00, 0x1_00]]);
  assert.deepEqual(short.ended, [undefined]);
  assert.equal(short.watch.silence, undefined);
});

test('阈值为 1 时，刚到的那次输入仍然落在「不到阈值」这一支', () => {
  // The threshold is at least 1, and this is why a just-arrived input always lands in the
  // under-threshold case rather than the arming one: a difference of zero is below every legal
  // threshold, so a return can always be recognised by the input that produced it.
  assert.deepEqual(drive([[T, T], [T, T + 1], [T + 1, T + 1]], 1).ended, [undefined, undefined, 1]);
});

// ---------------------------------------------------------------------------------------------
// The occurrence, and what it reads like.
// ---------------------------------------------------------------------------------------------

test('没有关注对象就没有 occurrence', () => {
  // The refusal lives in `formOccurrence` rather than at the transport, because "there was nothing to
  // say" is a decision about whether this value exists and not a fourth thing for it to mean.
  assert.equal(formOccurrence(OBSERVED_AT, 70_000, []), undefined);
  assert.equal(formOccurrence(OBSERVED_AT, 70_000, Object.freeze([])), undefined);
});

test('occurrence 冻结，且关注对象是拷进来的，不是借来的视图', () => {
  const designations = ['写 README'];
  const occurrence = formOccurrence(OBSERVED_AT, 70_000, designations);

  assert.deepEqual(occurrence, {
    observedAt: OBSERVED_AT,
    silentForMs: 70_000,
    designations: ['写 README'],
  });
  assert.ok(Object.isFrozen(occurrence));
  assert.ok(Object.isFrozen(occurrence.designations));

  // An occurrence owns the facts it states. The Service that produced this array hands back one it has
  // already frozen, so this is not a defence against mutation in fact — it is that a later write to the
  // source array must not change what a judgement already said.
  designations.push('修 CI');
  assert.deepEqual(occurrence.designations, ['写 README']);
});

test('occurrence 的每一行要么是表头要么是某个字段，没有一句是解释', () => {
  assert.deepEqual(renderOccurrence(formOccurrence(OBSERVED_AT, 70_000, ['写 README', '修 CI'])), [
    'Desktop return attention：',
    `  观察时间：${OBSERVED_AT}`,
    '  已观测到的无输入时长（下界）：70000 ms',
    '  触发时的关注对象：',
    '    写 README',
    '    修 CI',
  ]);
});

test('观察时间与关注对象里的一切都写不出第二行', () => {
  // The designations are free text a human typed, and `observedAt` is a formatted instant; a
  // designation containing a newline and a colon would otherwise print a second line shaped like a
  // judgement this module never made. `oneLine` is what refuses that.
  const lines = renderOccurrence(
    formOccurrence(
      String.fromCodePoint(0x0a, 0x1b) + OBSERVED_AT,
      70_000,
      ['main' + String.fromCodePoint(0x0d) + '  触发时的关注对象：'],
    ),
  );

  assert.equal(lines.length, 5, '转义之后行数不变');

  for (const line of lines) {
    for (const point of line) {
      const code = point.codePointAt(0);
      assert.ok(!LINE_BREAKS.includes(code), `U+${code.toString(16)} 不该留在渲染结果里`);
      assert.ok(code === 0x09 || code >= 0x20, `U+${code.toString(16)} 是终端会执行的字符`);
    }
  }

  // Escaped rather than dropped: the byte that was there is still readable, it just cannot act.
  assert.ok(lines[1].includes(String.raw`\n`), '换行应当被写成它的码点');
  assert.ok(lines[1].includes(String.raw`\u001b`), 'ESC 应当被写成它的码点');
  assert.ok(lines[4].includes(String.raw`\r`), '回车应当被写成它的码点');
});

test('渲染整条值时也过一遍 oneLine，而不是只过今天需要的那几个字段', () => {
  // The property claimed is about the *return value*, not about its inputs, so it is checked that way:
  // whatever the fields are, every element that comes back is already exactly one line. A field added
  // later cannot quietly reopen the hole.
  const lines = renderOccurrence(
    formOccurrence(String.fromCodePoint(0x2028, 0x7f), 70_000, [
      String.fromCodePoint(0x85, 0x1b),
      String.fromCodePoint(0x0c),
    ]),
  );

  for (const line of lines) {
    assert.equal(oneLine(line), line, '每个元素都应当已经是一次 oneLine 的结果');
    for (const point of line) {
      const code = point.codePointAt(0);
      assert.ok(!LINE_BREAKS.includes(code), `U+${code.toString(16)} 不该留在渲染结果里`);
      assert.ok(code === 0x09 || code >= 0x20, `U+${code.toString(16)} 是终端会执行的字符`);
    }
  }

  assert.ok(lines[1].includes(String.raw`\u2028`), 'U+2028 应当被写成它的码点');
  assert.ok(lines[1].includes(String.raw`\u007f`), 'DEL 应当被写成它的码点');
});

// ---------------------------------------------------------------------------------------------
// The boundary, as a contract and as a roster.
// ---------------------------------------------------------------------------------------------

test('Return attention 的 requires 恰好是那四个问题，provides 为空', () => {
  assert.equal(desktopReturnAttentionPlugin.id, 'desktop-return-attention');
  assert.equal(desktopReturnAttentionPlugin.version, '1.0.0');

  // Four requirements, each a different question this plugin cannot answer itself: what the machine's
  // input has been doing, what the human declared they were focused on, how to say it, and whether
  // anyone is listening. Asserted as an exact sequence, because the claim that matters includes "and
  // nothing else" — a fifth entry would be this decider reaching for something it has no question
  // about, and the desktop awareness chain is the one that is conspicuously absent.
  assert.deepEqual(desktopReturnAttentionPlugin.requires, [
    inputActivityService,
    workFocusCurrentService,
    languageDesktopReturnSpeakingService,
    humanDeliveryService,
  ]);
  assert.deepEqual(
    desktopReturnAttentionPlugin.requires.map((contract) => `${contract.id}@${contract.version}`),
    [
      'input-activity.current@1',
      'work-focus.current@1',
      'language.desktop-return-speaking@1',
      'human-delivery.deliver@1',
    ],
  );

  // The two speaking contracts are two, and this is where that stops being a claim about naming: a
  // decider that named the CI entry point would be reaching an expression surface for an owner it does
  // not speak for. It is also the only way this could go wrong — the contracts are separate, so the
  // requirement above is what decides which one a caller can get at.
  assert.equal(
    desktopReturnAttentionPlugin.requires.includes(languageSpeakingService),
    false,
    '不得要求 CI 的发言入口',
  );
  assert.equal(languageDesktopReturnSpeakingService.id, 'language.desktop-return-speaking');

  // Empty, and there is nothing to provide. A decider that only ever speaks has no capability another
  // module could ask it for, and giving it one so that it "looks like it has an output" is exactly the
  // cosmetic `provides` the design spec's MUST forbids.
  assert.deepEqual(desktopReturnAttentionPlugin.provides, []);
});

test('cadence 与阈值各自有各自的边界，两个上限来自两个不同的地方', async (t) => {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  // The cadence is bounded by what a Node timer can actually execute — `setTimeout` rewrites anything
  // above 2^31 - 1 into 1 ms, so a value past that bound would be accepted and then run as the
  // shortest cadence there is.
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
      () => runtime.loadPlugin(desktopReturnAttentionPlugin, { delayMs, afterMs: AFTER_MS }),
      /requires an integer delayMs between 1 and 2147483647/,
      `delayMs ${String(delayMs)} 应当被本插件拒绝`,
    );
  }

  // The threshold is bounded by the counter it is compared against: a silence is a difference of two
  // 32-bit readings, so a larger threshold is one no silence could ever reach — a configuration that
  // silently never speaks.
  for (const afterMs of [
    undefined,
    null,
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    '5',
    4_294_967_296,
  ]) {
    await assert.rejects(
      () => runtime.loadPlugin(desktopReturnAttentionPlugin, { delayMs: 1, afterMs }),
      /requires an integer afterMs between 1 and 4294967295/,
      `afterMs ${String(afterMs)} 应当被本插件拒绝`,
    );
  }

  // Both ceilings at once, which is the state the two separate ranges make reachable and neither
  // range alone would: `waiting` rather than rejected, because no capability provider is loaded here.
  assert.equal(
    await runtime.loadPlugin(desktopReturnAttentionPlugin, {
      delayMs: 2_147_483_647,
      afterMs: 4_294_967_295,
    }),
    'waiting',
  );
});

test('这个 decider 不发布事件：它只通过 Service 找那两个具名消费者', () => {
  // The claim `plugin.ts` makes in prose — it has a named consumer and a named transport, and it
  // reaches both through Services — checked as a property of the source rather than left as a sentence
  // that could quietly stop being true. An `emit` here would put the EventBus's AggregateError between
  // a transport failure and the perception loop, and would also make "who receives this" a question
  // for whoever happened to subscribe.
  const offenders = sourceFiles(RETURN_SOURCE).filter((file) =>
    /\bcontext\.events\b|\bevents\.emit\b|\bevents\.on\b/.test(readFileSync(file, 'utf8')),
  );

  assert.deepEqual(
    offenders.map((file) => relative(RETURN_SOURCE, file).replaceAll('\\', '/')),
    [],
  );
});

test('没有新的通用机制跟着这次改动进来', () => {
  // The same second-road check the other packages have, and for the same reason: naming an identifier
  // is what a generic mechanism would have to do before it could be used. Every entry is a compound
  // identifier rather than the bare noun, because this module's own comments negate the nouns in the
  // plain — "the salience judgement this slice does not build", "presence is not what this observes" —
  // and a pattern naming the nouns would red on the sentences that deny the thing.
  const forbidden =
    /\b(?:ServiceLocator|ServiceRegistry|CapabilityRegistry|GlobalRouter|GlobalWorldState|ModelRouter|CentralBrain|NotificationService|NotificationQueue|SalienceService|ImportanceService|AttentionRegistry|EventSink|MessageBroker|DeliveryServer|PresenceService|PresenceTracker|AwayState|UserState|ActivityState|TemporalReasoning|GenericOccurrence|GenericMessage|UniversalSpeakingMaterial|DedupRegistry|IdleService|ChronicleReader|MemoryStore)\b/;
  const offenders = sourceFiles(RETURN_SOURCE).filter((file) =>
    forbidden.test(readFileSync(file, 'utf8')),
  );

  assert.deepEqual(
    offenders.map((file) => relative(RETURN_SOURCE, file).replaceAll('\\', '/')),
    [],
  );
});

// ---------------------------------------------------------------------------------------------
// The cadence and the delivery policy — against the real Runtime.
// ---------------------------------------------------------------------------------------------

// No injection seam: the plugin under test is the production one, and the capabilities it consumes are
// supplied by ordinary fake plugins that the real Runtime dependency graph decides to activate. What
// the tests below exercise is therefore the shipped wiring, not a copy of it.

function inputProvider(sequence) {
  const counts = { calls: 0 };
  const definition = {
    id: INPUT_PROVIDER,
    version: '1.0.0',
    provides: [inputActivityService],
    setup(context) {
      context.services.provide(inputActivityService, {
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

function focusProvider(designations = () => ['写 README']) {
  const reads = [];
  const definition = {
    id: FOCUS_PROVIDER,
    version: '1.0.0',
    provides: [workFocusCurrentService],
    setup(context) {
      context.services.provide(workFocusCurrentService, {
        current() {
          const value = Object.freeze([...designations(reads.length)]);
          reads.push(value);
          return Promise.resolve(value);
        },
      });
    },
  };
  return { definition, reads };
}

function speakingProvider() {
  const spoken = [];
  const definition = {
    id: SPEAKING_PROVIDER,
    version: '1.0.0',
    provides: [languageDesktopReturnSpeakingService],
    setup(context) {
      context.services.provide(languageDesktopReturnSpeakingService, {
        // Language's real expression path and not a stand-in, so the identity assertion below is about
        // the shipped words rather than about a fake that agrees with itself.
        speak(occurrence) {
          const lines = renderSpokenReturn(occurrence);
          spoken.push({ occurrence, lines });
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

async function compose(runtime, { input, focus, speaking, delivery, delayMs = 2 }) {
  await runtime.loadPlugin(input.definition);
  await runtime.loadPlugin(focus.definition);
  await runtime.loadPlugin(speaking.definition);
  await runtime.loadPlugin(delivery.definition);
  return loadDecider(runtime, { delayMs });
}

// Split out from `compose` so that a test about reactivation can load the decider a second time
// without reloading the four providers, which are already loaded and would be rejected as such.
async function loadDecider(runtime, { delayMs, afterMs = AFTER_MS }) {
  const state = await runtime.loadPlugin(desktopReturnAttentionPlugin, { delayMs, afterMs });
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

// Real elapsed time, used only where a test must show that something did *not* happen.
async function elapsed(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

test('一次跨过阈值的沉默，恰好产生一条播报', async (t) => {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  // Every cycle from the fourth on reports the input that ended the silence. Without the watch going
  // back to `undefined` when it produced an occurrence, that would be a message every poll — which is
  // not "proactive", it is a stuck record.
  const readings = [
    observation(T, T),
    observation(T, T + AFTER_MS),
    observation(T, T + AFTER_MS * 2),
    observation(T + AFTER_MS * 2, T + AFTER_MS * 2 + 5),
  ];
  const input = inputProvider((call) => readings[Math.min(call, readings.length - 1)]);
  const focus = focusProvider();
  const speaking = speakingProvider();
  const delivery = deliveryProvider();
  await compose(runtime, { input, focus, speaking, delivery, delayMs: 2 });

  await until(() => delivery.delivered.length >= 1, '一次跨过阈值的返回没有被播报');
  await until(() => input.counts.calls >= 6, 'polling 没有继续');
  await elapsed(20);

  assert.equal(delivery.delivered.length, 1, '同一个返回不得被说第二次');
  assert.equal(speaking.spoken.length, 1, 'Language 也不该被再要求一次');

  // The occurrence says the silence that was actually observed, and it is the latest reading rather
  // than whenever the human happened to leave — nothing here could reconstruct the latter.
  assert.equal(speaking.spoken[0].occurrence.silentForMs, AFTER_MS * 2);
  assert.equal(speaking.spoken[0].occurrence.observedAt, OBSERVED_AT);
  assert.deepEqual(speaking.spoken[0].occurrence.designations, ['写 README']);
});

test('送出去的就是 Language 写的那几行，一个字都没被改写', async (t) => {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  let phase = 'away';
  const input = inputProvider(() =>
    phase === 'away'
      ? observation(T, T + 70_000)
      : observation(T + 70_000, T + 70_005),
  );
  const focus = focusProvider();
  const speaking = speakingProvider();
  const delivery = deliveryProvider();
  await compose(runtime, { input, focus, speaking, delivery, delayMs: 2 });

  await until(() => input.counts.calls >= 2, '沉默还没有被观察到');
  phase = 'back';
  await until(() => delivery.delivered.length >= 1, '没有任何东西被送出去');

  // Identity, not deep equality. A decider that copied the array, joined it, added a prefix or
  // re-wrapped it would be a second expression surface — the one nobody reviews. The lines travel from
  // the renderer to the transport as the same object, which is the strongest form this claim can take
  // in a language where the wire itself is a copy.
  assert.equal(delivery.delivered[0], speaking.spoken[0].lines);

  // And the human-visible text is the owner's own rendering, laid out by Language — no line of it is
  // this decider's, and no line of it is a claim about where the human had been.
  assert.deepEqual(delivery.delivered[0], [
    'Desktop return attention：',
    `  观察时间：${OBSERVED_AT}`,
    '  已观测到的无输入时长（下界）：70000 ms',
    '  触发时的关注对象：',
    '    写 README',
  ]);
});

test('连续输入从不触发：没有可结束的沉默', async (t) => {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  const input = inputProvider((call) => observation(T + call * 100, T + call * 100 + 100));
  const focus = focusProvider();
  const speaking = speakingProvider();
  const delivery = deliveryProvider();
  await compose(runtime, { input, focus, speaking, delivery, delayMs: 2 });

  await until(() => input.counts.calls >= 4, 'polling 没有跑起来');
  await elapsed(20);

  assert.equal(delivery.delivered.length, 0);
  assert.equal(speaking.spoken.length, 0);
  assert.equal(focus.reads.length, 0, '没有判定成立过，就不该去读关注对象');
});

test('不到阈值的停顿不触发', async (t) => {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  // A pause and a return: the counter really does stand still and then move, and at this threshold
  // that is not a return.
  let phase = 'pause';
  const input = inputProvider(() =>
    phase === 'pause' ? observation(T, T + 30_000) : observation(T + 30_000, T + 30_000),
  );
  const focus = focusProvider();
  const speaking = speakingProvider();
  const delivery = deliveryProvider();
  await compose(runtime, { input, focus, speaking, delivery, delayMs: 2 });

  await until(() => input.counts.calls >= 2, '停顿没有被观察到');
  phase = 'back';
  await until(() => input.counts.calls >= 5, '回来的那几次观察没有跑完');
  await elapsed(20);

  assert.equal(delivery.delivered.length, 0, '不到阈值的停顿不是返回');
  assert.equal(speaking.spoken.length, 0);
});

test('关注对象为空时不说话，Language 也不会被叫到', async (t) => {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  // The mandate is to watch for a return and, having seen one, remind the human of what they declared.
  // With nothing declared there is nothing to remind them of, so the path ends at the judgement rather
  // than at the transport — and Language is not asked to word a message nobody has a reason to read.
  let phase = 'away';
  const input = inputProvider(() =>
    phase === 'away'
      ? observation(T, T + 70_000)
      : observation(T + 70_000, T + 70_005),
  );
  const focus = focusProvider(() => []);
  const speaking = speakingProvider();
  const delivery = deliveryProvider();
  await compose(runtime, { input, focus, speaking, delivery, delayMs: 2 });

  await until(() => input.counts.calls >= 2, '沉默还没有被观察到');
  phase = 'back';
  await until(() => focus.reads.length >= 1, '返回时没有去读关注对象');
  await until(() => input.counts.calls >= 6, 'polling 停了');
  await elapsed(20);

  assert.equal(delivery.delivered.length, 0, '没有关注对象就没有可说的话');
  assert.equal(speaking.spoken.length, 0, 'Language 不该被要求为一条空消息措辞');
  assert.equal(focus.reads.length, 1, '关注对象只在判定成立那一刻读一次');
});

test('关注对象在离开之后被换掉，返回时说的是换掉之后的那一份', async (t) => {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  // Read at the moment of the judgement and never cached across cycles, which is what makes these the
  // designations *as of the return*: a set the human replaced while they were away is what they had
  // declared when they came back, and an hour-old snapshot is not.
  let designation = '写 README';
  let phase = 'away';
  const input = inputProvider(() =>
    phase === 'away'
      ? observation(T, T + 70_000)
      : observation(T + 70_000, T + 70_005),
  );
  const focus = focusProvider(() => [designation]);
  const speaking = speakingProvider();
  const delivery = deliveryProvider();
  await compose(runtime, { input, focus, speaking, delivery, delayMs: 2 });

  await until(() => input.counts.calls >= 2, '沉默还没有被观察到');
  designation = '修 CI';
  phase = 'back';
  await until(() => delivery.delivered.length >= 1, '返回没有被播报');

  assert.deepEqual(speaking.spoken[0].occurrence.designations, ['修 CI']);
});

test('读不到输入活动不是「没有输入」：那一轮不算数，后面的返回照常算一次', async (t) => {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  // An acquisition that rejects says nothing about the human's machine. The two things it must not
  // become are a judgement (nothing is inferred from the absence) and an error on this plugin (the
  // Runtime does not turn a rejection from an active plugin's background work into a failed state, so
  // nothing else would catch it — see `plugin.ts`).
  let phase = 'broken';
  const input = inputProvider((call) => {
    if (phase === 'broken') return Promise.reject(new Error('读不到输入活动'));
    if (phase === 'away') return observation(T, T + 70_000);
    if (phase === 'back') return observation(T + 70_000, T + 70_005);
    return observation(T, T + 100);
  });
  const focus = focusProvider();
  const speaking = speakingProvider();
  const delivery = deliveryProvider();
  await compose(runtime, { input, focus, speaking, delivery, delayMs: 2 });

  await until(() => input.counts.calls >= 3, '被拒绝的那几轮没有跑完');
  await elapsed(20);

  assert.equal(delivery.delivered.length, 0, '读不到不是「没人输入」');
  assert.equal(speaking.spoken.length, 0);
  assert.equal(runtime.getPluginState('desktop-return-attention'), 'active', '一轮失败不等于这个插件失败');
  assert.equal(runtime.getPluginError('desktop-return-attention'), undefined);

  // And the loop really did continue rather than merely not crashing: a return observed afterwards is
  // reported exactly once. The wait is measured from where the counter stood when the phase changed,
  // because the failing cycles have been running all along — a threshold on the absolute count would
  // already be met, and the phase would move on before a single away reading was taken.
  const beforeAway = input.counts.calls;
  phase = 'away';
  await until(() => input.counts.calls >= beforeAway + 2, '失败之后循环没有继续');
  phase = 'back';
  await until(() => delivery.delivered.length >= 1, '失败之后的一次真实返回没有被播报');
  await elapsed(20);
  assert.equal(delivery.delivered.length, 1);
});

test('没人连着的时候，Hikari 照常注意到，也照常什么都不说', async (t) => {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  // `unavailable` is the ordinary evening: a human opens their listener when they want to be told
  // things, and there is no queue behind this — a message formed while nobody is connected is gone.
  let phase = 'away';
  const input = inputProvider(() =>
    phase === 'away'
      ? observation(T, T + 70_000)
      : observation(T + 70_000, T + 70_005),
  );
  const focus = focusProvider();
  const speaking = speakingProvider();
  const delivery = deliveryProvider(() => ({ outcome: 'unavailable' }));
  const state = await compose(runtime, { input, focus, speaking, delivery, delayMs: 2 });

  await until(() => input.counts.calls >= 2, '沉默还没有被观察到');
  phase = 'back';
  await until(() => delivery.delivered.length >= 1, 'decider 没有尝试投递');
  await until(() => input.counts.calls >= 6, 'polling 停了');
  await elapsed(20);

  // Three separate facts, and the test is that they stay separate. The transport reported that nobody
  // was there; the decider's activation did not change because of it; and the return it judged is not
  // sent again on the chance that a client is watching now.
  assert.equal(state, 'active');
  assert.equal(runtime.getPluginState('desktop-return-attention'), 'active');
  assert.equal(delivery.delivered.length, 1, '没人连着不是重发的理由');
  assert.equal(speaking.spoken.length, 1);
});

test('投递失败不回滚判定：不重发、不抛出、循环继续', async (t) => {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  let phase = 'away';
  const input = inputProvider(() =>
    phase === 'away'
      ? observation(T, T + 70_000)
      : observation(T + 70_000, T + 70_005),
  );
  const focus = focusProvider();
  const speaking = speakingProvider();
  const delivery = deliveryProvider(() => ({ outcome: 'failed' }));
  const state = await compose(runtime, { input, focus, speaking, delivery, delayMs: 2 });

  await until(() => input.counts.calls >= 2, '沉默还没有被观察到');
  phase = 'back';
  await until(() => delivery.delivered.length >= 1, 'decider 没有尝试投递');
  await until(() => input.counts.calls >= 6, '循环因为一次投递失败而停了');
  await elapsed(20);

  assert.equal(state, 'active');
  assert.equal(runtime.getPluginState('desktop-return-attention'), 'active');
  assert.equal(delivery.delivered.length, 1, 'failed 不得变成 retry loop');
  assert.equal(runtime.getPluginError('desktop-return-attention'), undefined);
});

test('停用之后到达的观察不再被播报', async (t) => {
  const runtime = new Runtime();

  // The acquisition is held open across the deactivation, so a request that was already in flight when
  // the plugin went away is the case under test. It is checked on the far side of the await because the
  // work being already underway does not make its result this activation's to speak.
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const input = inputProvider(() => held);
  const focus = focusProvider();
  const speaking = speakingProvider();
  const delivery = deliveryProvider();
  await compose(runtime, { input, focus, speaking, delivery, delayMs: 10_000 });

  await until(() => input.counts.calls >= 1, '第一轮没有开始');

  const shutdown = runtime.shutdown();
  await nextTurn();
  release(observation(T, T + 70_000));
  await shutdown;

  await elapsed(20);
  assert.equal(delivery.delivered.length, 0, '停用之后到达的观察不得被说出去');
  assert.equal(speaking.spoken.length, 0);
});

test('重新激活从初始状态开始：激活之前的沉默不算本次激活的返回', async (t) => {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  // The temporal state is activation-local and there is deliberately nothing else: no token, no
  // Chronicle reader, no durable store. The discriminating moment is the one below rather than a
  // second report: the silence is armed and unspoken when the activation ends — exactly the state a
  // durable store would have preserved — and the human comes back while nothing is watching. An
  // activation that inherited that watch would find an armed silence for this reading to end and would
  // speak; one that starts from the initial watch has nothing armed and forms no occurrence at all.
  let phase = 'away';
  const input = inputProvider(() =>
    phase === 'away'
      ? observation(T, T + 70_000)
      : observation(T + 70_000, T + 70_005),
  );
  const focus = focusProvider();
  const speaking = speakingProvider();
  const delivery = deliveryProvider();
  await compose(runtime, { input, focus, speaking, delivery, delayMs: 2 });

  await until(() => input.counts.calls >= 2, '沉默还没有被观察到');
  await elapsed(20);
  assert.equal(delivery.delivered.length, 0, '人还没回来，此刻不该有任何话');

  await runtime.unloadPlugin('desktop-return-attention');

  phase = 'back';
  await loadDecider(runtime, { delayMs: 2 });
  const afterReload = input.counts.calls;
  await until(() => input.counts.calls >= afterReload + 3, '重新激活之后没有继续观察');
  await elapsed(20);

  assert.equal(delivery.delivered.length, 0, '本次激活没有见过那段沉默，就报不出这次返回');
  assert.equal(speaking.spoken.length, 0);
});

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sourceFiles(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}
