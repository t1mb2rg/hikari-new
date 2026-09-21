import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';

import { requestControl } from '../dist/cli/control.js';
import { observeFailureLines, requestDesktopSessionObserve } from '../dist/cli/observe.js';
import { desktopSessionAwarenessService } from '../dist/desktop-session-awareness/index.js';
import {
  decodeObserveReply,
  decodeObserveRequest,
  DESKTOP_SESSION_OBSERVE_PROTOCOL_VERSION,
  desktopSessionObservePlugin,
  encodeObserveReply,
  encodeObserveRequest,
  MAX_OBSERVE_REPLY_LINE,
  MAX_OBSERVE_REQUEST_LINE,
  ObserveLineReader,
  observeEndpointPath,
  renderAssessment,
} from '../dist/desktop-session-observe/index.js';
import { Runtime } from '../dist/index.js';
import { workFocusEndpointPath } from '../dist/work-focus/index.js';

// Two halves, deliberately in one file because they are two views of one transcription.
//
// The rendering runs everywhere, and it can because it is a pure function of a value that is already
// public. The endpoint and CLI tests need a named pipe and run only where there is one. Splitting
// them would have been tidier and would have put every claim this surface makes about its contracts
// on the side of the split that CI does not run — which is the mistake `judgement.ts` records having
// already been made once in this repository.
const NO_PIPES = process.platform === 'win32' ? false : '命名管道只在 Windows 上存在';

const CLI = join(import.meta.dirname, '..', 'dist', 'cli', 'main.js');
const SRC = join(import.meta.dirname, '..', 'src');

const OBSERVED_AT = '2026-02-01T08:30:00.000Z';
const SNAPSHOT_AT = '2026-02-01T08:30:01.000Z';

function createRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'hikari-observe-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

// ---------------------------------------------------------------------------------------------
// Fixtures. Written to the World's own shape rather than to this module's convenience, so that a
// contract change breaks these rather than being absorbed by them.
// ---------------------------------------------------------------------------------------------

// An unavailable facet is not "a window with nothing to say": it is a source that could not be
// observed, which the World reports as an unavailable facet rather than by rejecting.
//
// It is spelled as a symbol rather than as `undefined` because `undefined` is also what a forgotten
// argument looks like — and with a default parameter, passing `undefined` explicitly would silently
// produce the present fixture, which is the one mistake this file could make that would look like a
// passing test.
const UNAVAILABLE = Symbol('unavailable');

function foregroundFacet(target) {
  if (target === UNAVAILABLE) return { kind: 'unavailable' };
  return {
    kind: 'available',
    observation: { observedAt: OBSERVED_AT, source: 'foreground.windows', foreground: target },
  };
}

function inputActivityFacet(tick) {
  if (tick === UNAVAILABLE) return { kind: 'unavailable' };
  return {
    kind: 'available',
    observation: { observedAt: OBSERVED_AT, source: 'input-activity.windows', lastInputTick: tick },
  };
}

const PRESENT_TARGET = { kind: 'present', title: 'hikari-new — 记事本', processName: 'notepad' };

function snapshot({ target = PRESENT_TARGET, tick = 12345 } = {}) {
  return {
    snapshotAt: SNAPSHOT_AT,
    foreground: foregroundFacet(target),
    inputActivity: inputActivityFacet(tick),
  };
}

function baseline(current = snapshot()) {
  return { kind: 'baseline', current };
}

function comparison({
  previous = snapshot(),
  current = snapshot(),
  foreground = 'changed',
  inputActivity = 'changed',
} = {}) {
  return {
    kind: 'comparison',
    previous,
    current,
    foreground,
    inputActivity,
    change: overallChange(foreground, inputActivity),
  };
}

// The Awareness layer's own rule, restated here so the fixture carries a `change` consistent with its
// facets.
//
// This is a fixture-consistency aid, not a guard, and the distinction is worth stating because the
// obvious reassurance is false: nothing in this file would notice the day this copy stopped agreeing
// with `src/desktop-session-awareness/plugin.ts`. The one test here that asks the real plugin pins the
// verdict *vocabulary* — `changed|stable|indeterminate|baseline` — and cannot see the mapping from
// facets. That mapping is pinned where it lives, in `test/desktop-session-awareness.test.mjs`; the cost
// of divergence is that these fixtures would describe an assessment production no longer produces.
function overallChange(foreground, inputActivity) {
  if (foreground === 'changed' || inputActivity === 'changed') return 'changed';
  if (foreground === 'unchanged' && inputActivity === 'unchanged') return 'stable';
  return 'indeterminate';
}

// The expected blocks, written out.
//
// Every string below is a literal. None of it is computed from the renderer, which is the point: these
// blocks *are* the specification of what a human is told, and they are composed here only so each test
// can state its whole expected output without repeating sixteen lines of it.
const foregroundPresent = (title, processName) => [
  '前台：available',
  `  观察时间：${OBSERVED_AT}`,
  '  来源：foreground.windows',
  '  当前窗口：present',
  `  进程名：${processName}`,
  `  窗口标题：${title}`,
];

const foregroundAbsent = [
  '前台：available',
  `  观察时间：${OBSERVED_AT}`,
  '  来源：foreground.windows',
  '  当前窗口：absent',
];

// The World's `unavailable` facet carries no reason, so neither may this sentence.
const foregroundUnavailable = [
  '前台：unavailable',
  '  （这次快照没有该来源的观察；World 的 unavailable facet 不携带原因）',
];

const inputAvailable = (tick) => [
  '输入活动：available',
  `  观察时间：${OBSERVED_AT}`,
  '  来源：input-activity.windows',
  `  最后输入 tick：${tick}`,
];

const inputUnavailable = [
  '输入活动：unavailable',
  '  （这次快照没有该来源的观察；World 的 unavailable facet 不携带原因）',
];

const HEADER_LINE = `桌面会话观察：${SNAPSHOT_AT}`;

const verdict = (change, foreground, inputActivity) => [
  `判词：${change}`,
  `  前台相比上一次快照：${foreground}`,
  `  输入活动相比上一次快照：${inputActivity}`,
];

// The whole block, pinned line for line.
//
// This replaced a prefix allow-list, and the replacement fixes a demonstrated hole rather than
// tightening for its own sake. A prefix guard is satisfied by every sentence that *starts* the same
// way, so a renderer that grew interpretive lines passed the entire suite while still claiming to
// enforce this surface's one rule. Measured, not reasoned: injecting
// `  来源：看上去用户正在专注写代码` into the built `presentation.js` left all twenty-nine tests
// green — and that sentence is exactly the one this surface exists to make impossible, the "and that
// means…" that turns transcription into the interpretation layer a human came here to check. The old
// guard was enforcing the letter of the rule and none of its content.
//
// Literal blocks make an added, removed or reworded line fail a test. The cost is that a layout change
// rewrites these literals, and that cost is the intended one: what this surface says to a human is the
// deliverable, so changing it should be a decision someone makes rather than something a refactor
// slips past a prefix check.
function assertExactTranscription(assessment, expected) {
  assert.deepEqual(renderAssessment(assessment), expected);
}

// ---------------------------------------------------------------------------------------------
// The transcription, on every platform.
// ---------------------------------------------------------------------------------------------

test('前台可用且存在时，逐字转述进程名与窗口标题', () => {
  assertExactTranscription(
    comparison({ current: snapshot({ target: { kind: 'present', title: '记事本', processName: 'notepad' } }) }),
    [
      HEADER_LINE,
      ...foregroundPresent('记事本', 'notepad'),
      ...inputAvailable(12345),
      ...verdict('changed', 'changed', 'changed'),
    ],
  );
});

test('前台可用但不存在时，不写出标题与进程名', () => {
  // `absent` carries no title and no process because there is no window they would be about. Printing
  // them as "not reported" would describe a read that never had a subject. The exact block below is
  // what makes their absence a checked fact rather than an omission — a separate
  // `startsWith('  窗口标题：') === false` assertion would now say nothing this does not.
  assertExactTranscription(comparison({ current: snapshot({ target: { kind: 'absent' } }) }), [
    HEADER_LINE,
    ...foregroundAbsent,
    ...inputAvailable(12345),
    ...verdict('changed', 'changed', 'changed'),
  ]);
});

test('前台不可用时，说明 World 的 facet 不携带原因', () => {
  // An unavailable facet is not an absent window, and the exact block is what holds the two words
  // apart: the forbidden line would have to be written out above to appear.
  assertExactTranscription(comparison({ current: snapshot({ target: UNAVAILABLE }) }), [
    HEADER_LINE,
    ...foregroundUnavailable,
    ...inputAvailable(12345),
    ...verdict('changed', 'changed', 'changed'),
  ]);
});

test('输入活动可用时，逐字转述 observedAt、source 与 lastInputTick', () => {
  assertExactTranscription(comparison({ current: snapshot({ tick: 987654321 }) }), [
    HEADER_LINE,
    ...foregroundPresent('hikari-new — 记事本', 'notepad'),
    ...inputAvailable(987654321),
    ...verdict('changed', 'changed', 'changed'),
  ]);
});

test('输入活动不可用时，与前台用同一句说明，不各自发明理由', () => {
  // The two `unavailable` blocks are byte-identical on purpose: inventing a reason per facet is the
  // failure this pins, and it would show up above as two different second lines.
  assertExactTranscription(comparison({ current: snapshot({ tick: UNAVAILABLE }) }), [
    HEADER_LINE,
    ...foregroundPresent('hikari-new — 记事本', 'notepad'),
    ...inputUnavailable,
    ...verdict('changed', 'changed', 'changed'),
  ]);
});

test('changed / stable / indeterminate 三个判词都逐字出现，不被翻译或改写', () => {
  const tail = (assessment) => renderAssessment(assessment).slice(-3);

  assert.deepEqual(
    tail(comparison({ foreground: 'changed', inputActivity: 'unchanged' })),
    verdict('changed', 'changed', 'unchanged'),
  );
  assert.deepEqual(
    tail(comparison({ foreground: 'unchanged', inputActivity: 'unchanged' })),
    verdict('stable', 'unchanged', 'unchanged'),
  );
  assert.deepEqual(
    tail(comparison({ foreground: 'indeterminate', inputActivity: 'indeterminate' })),
    verdict('indeterminate', 'indeterminate', 'indeterminate'),
  );
});

test('facet 判词是 unchanged、整体判词是 stable，两个词不被合并成一个', () => {
  // The contract's asymmetry, surviving transcription: a facet is `unchanged`, the whole is `stable`.
  // Printing `stable` on a facet line would be this layer editing a judgement it only carries — and
  // the expected block below would have to spell that out for it to happen.
  assertExactTranscription(comparison({ foreground: 'unchanged', inputActivity: 'unchanged' }), [
    HEADER_LINE,
    ...foregroundPresent('hikari-new — 记事本', 'notepad'),
    ...inputAvailable(12345),
    ...verdict('stable', 'unchanged', 'unchanged'),
  ]);
});

test('title 缺失与 title 为 null 是两句不同的话', () => {
  // A read that did not happen — the Win32 title call threw — and a read that happened and found a
  // window with no text are different facts, and the acquisition takes both branches.
  // The message describes the snapshot, never a cause: `windows.ts` omits the key both when the Win32
  // call throws and when it returns zero for a window that is already gone, so any sentence naming one
  // of those as *the* reason would be a claim the contract does not carry.
  const withTitleLine = (titleLine) => [
    HEADER_LINE,
    ...foregroundPresent(titleLine, 'notepad'),
    ...inputAvailable(12345),
    ...verdict('changed', 'changed', 'changed'),
  ];

  const missing = renderAssessment(
    comparison({ current: snapshot({ target: { kind: 'present', processName: 'notepad' } }) }),
  );
  const empty = renderAssessment(
    comparison({ current: snapshot({ target: { kind: 'present', title: null, processName: 'notepad' } }) }),
  );

  assert.deepEqual(missing, withTitleLine('源未报告（快照里没有这个字段）'));
  assert.deepEqual(empty, withTitleLine('无（源报告为空）'));
  assert.doesNotMatch(missing.join('\n'), /读取未发生/);
});

// The one field on this surface that carries bytes somebody else chose, trying to become structure.
//
// Reachable, and measured rather than argued: a window whose caption was set to two lines read back
// through `GetWindowTextW` — the exact call `src/foreground/windows.ts` makes — with the line feed
// still in it, and nothing between there and here strips it.
test('窗口标题里的换行不能伪造出一行判词', () => {
  const forged = '记事本\n判词：stable\n  前台相比上一次快照：unchanged';
  const lines = renderAssessment(
    comparison({ current: snapshot({ target: { kind: 'present', title: forged, processName: 'notepad' } }) }),
  );

  assert.deepEqual(lines, [
    HEADER_LINE,
    // Carried verbatim in content, escaped in form: note that the whole title is one element, and the
    // text is still all there.
    ...foregroundPresent('记事本\\n判词：stable\\n  前台相比上一次快照：unchanged', 'notepad'),
    ...inputAvailable(12345),
    ...verdict('changed', 'changed', 'changed'),
  ]);

  // The structural claims, which are what actually broke: one element is one line, and the only
  // verdict on this surface is Hikari's own. Before `oneLine`, this fixture produced a second
  // `判词：stable` line above the real one and a human read two contradicting verdicts.
  assert.equal(lines.some((line) => line.includes('\n')), false);
  assert.deepEqual(
    lines.filter((line) => line.startsWith('判词：')),
    ['判词：changed'],
  );
});

test('回车、垂直制表、换页与两个 Unicode 行分隔符同样被转义', () => {
  const characters = [0x0d, 0x0b, 0x0c, 0x85, 0x2028, 0x2029].map((code) => String.fromCodePoint(code));
  const lines = renderAssessment(
    comparison({
      current: snapshot({
        target: { kind: 'present', title: `a${characters.join('b')}c`, processName: 'notepad' },
      }),
    }),
  );

  // Built from a code point rather than written as an escape, for the same reason `presentation.ts`
  // is: an escape in a source literal is precisely the ambiguity this test is about.
  const backslash = String.fromCodePoint(0x5c);
  const expected = `a${backslash}rb${backslash}vb${backslash}fb${backslash}u0085b${backslash}u2028b${backslash}u2029c`;

  assert.deepEqual(
    lines.filter((line) => line.startsWith('  窗口标题：')),
    [`  窗口标题：${expected}`],
  );
  // One element, so the surface's own structure survives whatever the title contained.
  assert.equal(lines.some((line) => line.includes('\n') || line.includes('\r')), false);
});

// The second road to the same forgery, and the more direct one.
//
// A line break only lets a title add a line. An escape sequence lets it clear the screen the verdict
// is printed on and draw its own — so this is not "one extra line slipped in", it is the entire
// reading replaced by something Hikari never said. Measured before it was fixed: a title carrying
// `ESC [ 2 J` and `ESC [ 3 1 m` came back out of `renderAssessment` with the ESC bytes intact, and
// the terminal that printed it obeyed them.
//
// A rule that enumerated line breaks would have passed this, which is why it enumerates control
// characters instead.
test('窗口标题里的转义序列不能涂改屏幕，也就是不能伪造判词', () => {
  const esc = String.fromCodePoint(0x1b);
  const bel = String.fromCodePoint(0x07);
  const hostile = `${esc}[2J${esc}[31mPWNED${esc}[0m${esc}]0;${bel}notepad`;

  const lines = renderAssessment(
    comparison({ current: snapshot({ target: { kind: 'present', title: hostile, processName: 'notepad' } }) }),
  );

  const backslash = String.fromCodePoint(0x5c);
  const expected = `${backslash}u001b[2J${backslash}u001b[31mPWNED${backslash}u001b[0m${backslash}u001b]0;${backslash}u0007notepad`;
  assert.deepEqual(lines.filter((line) => line.startsWith('  窗口标题：')), [`  窗口标题：${expected}`]);

  // Stated over the whole output rather than over the title line alone, because "only the title is
  // free text today" is a fact about today's snapshot shape and not a property of this surface.
  const codes = [...lines.join('\n')].map((character) => character.codePointAt(0));
  assert.deepEqual(codes.filter((code) => code < 0x20 && code !== 0x0a), []);
  assert.deepEqual(codes.filter((code) => code >= 0x7f && code <= 0x9f), []);
});

// The one control character left alone, and the test is here so that leaving it alone stays a
// decision rather than becoming an oversight. A tab cannot begin a line and cannot move the cursor
// anywhere a verdict could be drawn, so preserving it is fidelity that costs nothing.
test('制表符是唯一被原样保留的控制字符，因为它无法伪造结构', () => {
  const tab = String.fromCodePoint(0x09);
  const lines = renderAssessment(
    comparison({ current: snapshot({ target: { kind: 'present', title: `a${tab}b`, processName: 'notepad' } }) }),
  );

  assert.deepEqual(lines.filter((line) => line.startsWith('  窗口标题：')), [`  窗口标题：a${tab}b`]);
});

test('baseline 不被写成 indeterminate，也不假装有一次比较', () => {
  // The snapshot is still rendered in full: a baseline is an absence of a comparison, not an absence
  // of an observation, and the facts a human came to check are all there. Rendering only the verdict
  // would fail this, and so would spelling `baseline` as `indeterminate`.
  assertExactTranscription(baseline(), [
    HEADER_LINE,
    ...foregroundPresent('hikari-new — 记事本', 'notepad'),
    ...inputAvailable(12345),
    '判词：baseline',
    '  这是该感知链实例的第一次评估：还没有可比对的前一次快照，因此没有 change 判词。',
  ]);
});

test('渲染只读取 assessment.current，两种形态都渲染完整的当前快照', () => {
  const current = snapshot({ tick: 4242 });
  const asBaseline = renderAssessment(baseline(current));
  const asComparison = renderAssessment(comparison({ current }));

  // The same snapshot produces the same fact lines in both shapes; only the verdict section differs.
  const facts = (lines) => lines.filter((line) => !line.startsWith('判词：') && !line.startsWith('  前台相比') && !line.startsWith('  输入活动相比') && !line.startsWith('  这是该感知链实例'));
  assert.deepEqual(facts(asBaseline), facts(asComparison));
  assert.ok(facts(asBaseline).includes('  最后输入 tick：4242'));
});

test('渲染不修改交给它的 assessment', () => {
  const assessment = comparison();
  const frozenBytes = JSON.stringify(assessment);
  renderAssessment(assessment);
  assert.equal(JSON.stringify(assessment), frozenBytes);
});

// ---------------------------------------------------------------------------------------------
// The wire vocabulary and the failure wording, on every platform.
//
// Everything below is a pure function over strings, so none of it needs a pipe — and leaving it to the
// endpoint tests further down would mean CI never ran it at all: on the machine CI uses, every one of
// those is skipped, encoding, decoding and line framing included. This repository has already paid for
// that mistake once (`judgement.ts`), and `repository-ci-relevance/index.ts` states the rule plainly —
// a rule pinned only by tests that need a named pipe is a rule CI does not check at all.
// ---------------------------------------------------------------------------------------------

test('请求往返：编码后的 status 解码回来还是同一个请求', () => {
  assert.deepEqual(decodeObserveRequest(encodeObserveRequest({ word: 'status' }).trimEnd()), {
    kind: 'request',
    request: { word: 'status' },
  });
});

test('应答往返：ok 与 failed 各自带的行逐字保留', () => {
  for (const outcome of ['ok', 'failed']) {
    const reply = { outcome, lines: ['第一行', '第二行'] };
    assert.deepEqual(decodeObserveReply(encodeObserveReply(reply).trimEnd()), { kind: 'reply', reply });
  }
});

test('请求的每一种拒绝都真的被拒绝', () => {
  const refused = (line) => {
    const decoded = decodeObserveRequest(line);
    assert.equal(decoded.kind, 'refused', `应被拒绝：${line}`);
    return decoded.reason;
  };
  const withProtocol = (extra) =>
    JSON.stringify({ protocol: DESKTOP_SESSION_OBSERVE_PROTOCOL_VERSION, request: 'status', ...extra });

  assert.match(refused('不是 JSON'), /不是一个 JSON 对象/);
  assert.match(refused('[1,2]'), /不是一个 JSON 对象/);
  assert.match(refused('null'), /不是一个 JSON 对象/);
  assert.match(refused(JSON.stringify({ protocol: 999, request: 'status' })), /协议版本不匹配/);
  assert.match(refused(withProtocol({ request: '别的' })), /未知请求/);
  // An unknown field is refused rather than shrugged at: an envelope that tolerated one would already
  // be an extensible schema, and the next person to want a field would find the room reserved. A
  // client cannot name a facet here, which is what keeps this one question and not a query language.
  assert.match(refused(withProtocol({ facet: 'foreground' })), /字段必须恰好是/);
});

test('应答的每一种不可读都真的不可读', () => {
  const unreadable = (line) => {
    const decoded = decodeObserveReply(line);
    assert.equal(decoded.kind, 'unreadable', `应不可读：${line}`);
    return decoded.reason;
  };
  const withProtocol = (extra) =>
    JSON.stringify({ protocol: DESKTOP_SESSION_OBSERVE_PROTOCOL_VERSION, outcome: 'ok', lines: [], ...extra });

  assert.match(unreadable('不是 JSON'), /不是一个 JSON 对象/);
  assert.match(unreadable(JSON.stringify({ protocol: 2, outcome: 'ok', lines: [] })), /协议版本不匹配/);
  assert.match(unreadable(withProtocol({ lines: undefined })), /字段必须恰好是/);
  assert.match(unreadable(withProtocol({ outcome: '也许' })), /未知应答结果/);
  assert.match(unreadable(withProtocol({ lines: 'x' })), /不是一个字符串数组/);
  assert.match(unreadable(withProtocol({ lines: [1] })), /不是一个字符串数组/);
  // The wire carries no machine-readable judgement of its own — a reply that grew a `change` field
  // would be a second opinion rather than the transcription this surface exists to be, and it does not
  // decode. This is the one place that says so on every platform.
  assert.match(unreadable(withProtocol({ change: 'stable' })), /字段必须恰好是/);
});

test('行框定：拼块成行，超限即溢出，且溢出之后不再恢复', () => {
  // A line split across two chunks is still one line.
  const split = new ObserveLineReader(MAX_OBSERVE_REQUEST_LINE);
  assert.deepEqual(split.push('{"protocol"'), { kind: 'pending' });
  assert.deepEqual(split.push(':1}\n'), { kind: 'line', line: '{"protocol":1}' });

  // Under the limit with no newline is pending, not a line.
  const waiting = new ObserveLineReader(MAX_OBSERVE_REQUEST_LINE);
  assert.deepEqual(waiting.push('1234567890'), { kind: 'pending' });

  // The limit is a limit and not a prohibition: a line of exactly the limit is served.
  const exact = new ObserveLineReader(4);
  assert.deepEqual(exact.push('1234\n'), { kind: 'line', line: '1234' });

  // A terminated line over the limit overflows; the newline does not rescue it.
  const longLine = new ObserveLineReader(4);
  assert.deepEqual(longLine.push('12345\n'), { kind: 'overflow' });

  // Unterminated and over the limit overflows too, and stays overflowed — the refusal is not a
  // per-chunk verdict that a later chunk can undo.
  const unterminated = new ObserveLineReader(4);
  assert.deepEqual(unterminated.push('12345'), { kind: 'overflow' });
  assert.deepEqual(unterminated.push('\n'), { kind: 'overflow' });
  assert.deepEqual(unterminated.push(''), { kind: 'overflow' });
});

test('两种失败的措辞各自成立，且「有东西但坏了」不被说成「什么都没有」', () => {
  const absent = observeFailureLines({ kind: 'absent' });
  const unavailable = observeFailureLines({ kind: 'unavailable', detail: '连接被拒绝。' });

  assert.deepEqual(absent, [
    '这个数据目录上没有正在提供桌面会话观察入口的 Hikari 常驻。',
    '若常驻尚未启动，请先运行：hikari resident --data-dir <path> --desktop-awareness-delay-ms <integer>；若它正在启动或停止，请稍后重试。',
  ]);
  // The forbidden claim is that Hikari saw nothing, and the remedy is stated conditionally because the
  // ENOENT this comes from also covers a resident in the act of stopping.
  assert.doesNotMatch(absent.join('\n'), /没有观察到/);
  assert.match(absent.join('\n'), /正在启动或停止/);

  assert.deepEqual(unavailable, ['无法访问 Hikari 桌面会话观察入口：连接被拒绝。']);
  assert.doesNotMatch(unavailable.join('\n'), /没有正在提供/);
});

// ---------------------------------------------------------------------------------------------
// The endpoint, where there is a pipe.
// ---------------------------------------------------------------------------------------------

// No injection seam, as elsewhere in this suite: the tests supply a fake *provider* as an ordinary
// plugin and let the real Runtime dependency graph decide who is active. The plugin under test is the
// production one, reached through its real endpoint by the production client.
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

async function compose(t, assessment) {
  const root = createRoot(t);
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  const states = [];
  states.push(
    await runtime.loadPlugin(
      provider('test.awareness-provider', desktopSessionAwarenessService, Object.freeze({ current: assessment })),
    ),
  );
  states.push(await runtime.loadPlugin(desktopSessionObservePlugin, { rootDir: root }));

  assert.deepEqual(states, ['active', 'active'], '测试组合应全部 active');
  return { root, runtime };
}

test('插件发布声明就是它的全部输入面', () => {
  assert.equal(desktopSessionObservePlugin.id, 'desktop-session-observe');
  assert.equal(desktopSessionObservePlugin.version, '1.0.0');
  assert.deepEqual(desktopSessionObservePlugin.requires, [desktopSessionAwarenessService]);
  // No Service, because nothing in the composition asks this plugin for anything.
  assert.deepEqual(desktopSessionObservePlugin.provides, []);
});

test('缺少 Awareness 时插件不激活，而不是稍后在提问时才失败', async (t) => {
  const root = createRoot(t);
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  assert.equal(await runtime.loadPlugin(desktopSessionObservePlugin, { rootDir: root }), 'waiting');
});

test('端点把 assessment 渲染成的行原样交给提问者', { skip: NO_PIPES }, async (t) => {
  const assessment = comparison({ current: snapshot({ tick: 777 }) });
  const { root } = await compose(t, async () => assessment);

  const answer = await requestDesktopSessionObserve(root);

  assert.equal(answer.kind, 'answered');
  assert.equal(answer.reply.outcome, 'ok');
  assert.deepEqual(answer.reply.lines, renderAssessment(assessment));
  assert.deepEqual(answer.reply.lines, renderAssessment(await Promise.resolve(assessment)));
});

test('重复提问拿到的是新状态，不是上一次的缓存', { skip: NO_PIPES }, async (t) => {
  let tick = 1000;
  const { root } = await compose(t, async () => comparison({ current: snapshot({ tick: (tick += 1) }) }));

  const first = await requestDesktopSessionObserve(root);
  const second = await requestDesktopSessionObserve(root);

  assert.equal(first.kind, 'answered');
  assert.equal(second.kind, 'answered');
  assert.ok(first.reply.lines.includes('  最后输入 tick：1001'), first.reply.lines.join('\n'));
  assert.ok(second.reply.lines.includes('  最后输入 tick：1002'), second.reply.lines.join('\n'));
});

test('上游失败是 failed，不是一次「两个 facet 都不可用」的观察', { skip: NO_PIPES }, async (t) => {
  const { root } = await compose(t, async () => {
    throw new Error('桌面来源暂时不可用');
  });

  const answer = await requestDesktopSessionObserve(root);

  assert.equal(answer.kind, 'answered');
  assert.equal(answer.reply.outcome, 'failed');
  assert.match(answer.reply.lines.join('\n'), /桌面会话观察未能完成：桌面来源暂时不可用/);
  // The whole difference the two outcomes exist for: a rejected acquisition must never come back as a
  // well-formed assessment whose facets happen to read `unavailable`, because that would tell a human
  // the World reported no source.
  assert.equal(answer.reply.lines.join('\n').includes('unavailable'), false);
});

test('不认识的请求被拒绝，而不是被当成别的问题', { skip: NO_PIPES }, async (t) => {
  const { root } = await compose(t, async () => baseline());

  const reply = await new Promise((settle, fail) => {
    const socket = connect(observeEndpointPath(root));
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${JSON.stringify({ protocol: DESKTOP_SESSION_OBSERVE_PROTOCOL_VERSION, request: 'history' })}\n`));
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (!buffer.includes('\n')) return;
      socket.destroy();
      settle(buffer);
    });
    socket.on('error', fail);
  });

  const decoded = JSON.parse(reply.trim());
  assert.equal(decoded.outcome, 'failed');
  assert.match(decoded.lines.join('\n'), /未知请求/);
});

test('超长请求不被应答，连接被断开', { skip: NO_PIPES }, async (t) => {
  const { root } = await compose(t, async () => baseline());

  const closed = await new Promise((settle, fail) => {
    const socket = connect(observeEndpointPath(root));
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write('x'.repeat(MAX_OBSERVE_REQUEST_LINE + 1)));
    socket.on('data', () => fail(new Error('超长请求不应有应答')));
    socket.on('close', () => settle(true));
    socket.on('error', () => settle(true));
  });

  assert.equal(closed, true);
});

// The bound has two sides and only one of them was tested: refusing over the limit says nothing about
// whether a legal request *at* the limit still gets served. An off-by-one in the reader would reject
// exactly the largest request this protocol promises to answer, and every test above would still pass.
test('正好等于上限的请求仍然拿得到应答', { skip: NO_PIPES }, async (t) => {
  const { root } = await compose(t, async () => baseline());

  const encoded = encodeObserveRequest({ word: 'status' }).trimEnd();
  const withPad = (padding) => encoded.replace('"request":"status"', `"request":"status","pad":"${padding}"`);

  // Sized from the encoder rather than from a hand-counted constant, so this test cannot drift into
  // asserting a length that is merely near the limit.
  const padding = 'x'.repeat(MAX_OBSERVE_REQUEST_LINE - withPad('').length);
  const padded = withPad(padding);

  // The request that reaches the reader is exactly as long as the reader accepts, and it is not a
  // request this endpoint answers — the padding is an unknown field, so it must decode to `failed`.
  // That is the point: the frame arrived, was read, and was judged on its contents.
  assert.equal(padded.length, MAX_OBSERVE_REQUEST_LINE);

  const reply = await new Promise((settle, fail) => {
    const socket = connect(observeEndpointPath(root));
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${padded}\n`));
    socket.on('data', (chunk) => {
      buffer += chunk;
    });
    socket.on('end', () => settle(buffer));
    socket.on('error', fail);
  });

  const decoded = decodeObserveReply(reply.trim());
  assert.equal(decoded.kind, 'reply');
  assert.equal(decoded.reply.outcome, 'failed');
  assert.match(decoded.reply.lines.join('\n'), /字段必须恰好是/);
});

test('客户端说了一半就消失：不拖住端点，也不影响下一个请求', { skip: NO_PIPES }, async (t) => {
  const assessment = comparison({ current: snapshot({ tick: 4242 }) });
  const { root } = await compose(t, async () => assessment);

  // A half-written frame, then gone. The reader is left holding a partial line and the socket is left
  // holding a `served = false` that will never become true.
  await new Promise((settle) => {
    const socket = connect(observeEndpointPath(root));
    socket.on('connect', () => {
      socket.write('{"protocol":1,"reque');
      socket.destroy();
    });
    socket.on('close', () => settle());
    socket.on('error', () => settle());
  });

  // The next human gets a real answer, and the abandoned connection is not still queued on the
  // endpoint when the plugin unloads.
  const answer = await requestDesktopSessionObserve(root);
  assert.equal(answer.kind, 'answered');
  assert.equal(answer.reply.outcome, 'ok');
  assert.ok(answer.reply.lines.includes('  最后输入 tick：4242'));
});

test('卸载插件后端点随之消失，且卸载当时排队的连接不会拖住它', { skip: NO_PIPES }, async (t) => {
  const { root, runtime } = await compose(t, async () => baseline());

  assert.equal((await requestDesktopSessionObserve(root)).kind, 'answered');

  await runtime.unloadPlugin(desktopSessionObservePlugin.id);

  assert.equal((await requestDesktopSessionObserve(root)).kind, 'absent');
});

test('观察入口不是控制通道，也不是工作焦点的端点', { skip: NO_PIPES }, async (t) => {
  const { root } = await compose(t, async () => baseline());

  // Three endpoints derived from one data directory and none of them is another: a collision here
  // would make one capability answer for a different domain's vocabulary.
  assert.notEqual(observeEndpointPath(root), workFocusEndpointPath(root));
  // The Resident's control surface is not this plugin's to speak through, and the proof that it has
  // not is that control is exactly as unreachable as it was before.
  assert.deepEqual(await requestControl(root, 'status'), { kind: 'absent' });
});

// ---------------------------------------------------------------------------------------------
// The client, where there is no resident.
// ---------------------------------------------------------------------------------------------

test('没有常驻时，客户端说的是「没有入口」而不是「没有观察到」', { skip: NO_PIPES }, async (t) => {
  const root = createRoot(t);
  const answer = await requestDesktopSessionObserve(root);

  assert.equal(answer.kind, 'absent');

  const lines = observeFailureLines(answer);
  assert.match(lines.join('\n'), /没有正在提供桌面会话观察入口的 Hikari 常驻/);
  // The claim ENOENT actually proves, and the remedy stated conditionally: a resident on its way down
  // takes this endpoint with it while the process is still alive, and the unconditional remedy is
  // advice this product refuses in that window.
  assert.match(lines.join('\n'), /若它正在启动或停止，请稍后重试/);
});

// ---------------------------------------------------------------------------------------------
// Real processes: the vertical slice as a human runs it.
// ---------------------------------------------------------------------------------------------

function runCli(...args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  assert.equal(result.error, undefined);
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

// The same thing, without blocking this process's event loop — which matters when the endpoint being
// asked is one this test composed in-process. `spawnSync` would hold the loop that has to answer, so
// the client would sit there until its own 30s bound expired and report `unavailable`: a test that
// looks like it is exercising an answer while only ever exercising a timeout.
function runCliAsync(...args) {
  return new Promise((settle) => {
    const child = spawn(process.execPath, [CLI, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = collect(child.stdout);
    const err = collect(child.stderr);
    child.on('close', (code) => settle({ code, stdout: out.text, stderr: err.text }));
  });
}

function collect(stream) {
  const state = { text: '' };
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    state.text += chunk;
  });
  return state;
}

async function until(predicate, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resume) => setTimeout(resume, 50));
  }
  throw new Error(message);
}

test('真实进程：默认常驻里，人真的能读到 Hikari 看到的东西', { skip: NO_PIPES, timeout: 120_000 }, async (t) => {
  const root = createRoot(t);
  assert.equal(runCli('init', '--data-dir', root).code, 0);
  assert.equal(runCli('chronicle', 'init', '--data-dir', root).code, 0);

  // The default composition, and nothing else: no `--repository-root`, no `--repository`. This is the
  // test that says the capability is available to a resident a human actually started.
  //
  // `spawn` rather than `spawnSync`, because a resident does not exit on its own: the command that
  // starts it is stopped over its own control channel, and every `runCli` below is a second process
  // talking to the first.
  const resident = spawn(process.execPath, [CLI, 'resident', '--data-dir', root, '--desktop-awareness-delay-ms', '60000'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => resident.kill());
  const out = collect(resident.stdout);
  const err = collect(resident.stderr);

  await until(() => out.text.includes('Hikari 常驻已启动。'), 60_000, `常驻没有就绪：${err.text}`);

  // Active in the composition, asked of the running resident rather than inferred from the fact that
  // it started — the same discipline the production roster test uses.
  const status = runCli('status', '--data-dir', root);
  assert.equal(status.code, 0);
  assert.ok(status.stdout.includes('desktop-session-observe 状态：active'), status.stdout);

  const answer = runCli('observe', 'desktop-session', 'status', '--data-dir', root);
  assert.equal(answer.code, 0, `应读到一次观察：${answer.stderr}`);
  assert.equal(answer.stderr, '');

  const lines = answer.stdout.split('\n');
  assert.match(lines[0] ?? '', /^桌面会话观察：/);
  assert.ok(lines.includes('前台：available'), answer.stdout);
  assert.ok(lines.includes('输入活动：available'), answer.stdout);
  // The verdict is one of the contract's three words, and which one it is depends on whether anything
  // moved between the loop's cycle and this question — so the test pins the vocabulary, not the value.
  assert.match(answer.stdout, /^判词：(?:changed|stable|indeterminate|baseline)$/m);
  // No line-level transcription guard here, deliberately. The one that used to be here scanned prefixes
  // and was demonstrated to pass a renderer that appended interpretive sentences, so it bought nothing
  // that this test's own assertions do not. What the *real* end of this is pinned by, transitively and
  // exactly: `renderAssessment` is pinned line for line by the ungated tests above, and
  // 「端点把 assessment 渲染成的行原样交给提问者」 pins that the wire carries that function's output
  // unchanged. The live machine values here are the real plugin's, which is why nothing more exact than
  // this can be written down.

  // Reading it twice must not require restarting anything: the endpoint answered twice.
  assert.equal(runCli('observe', 'desktop-session', 'status', '--data-dir', root).code, 0);

  assert.equal(runCli('stop', '--data-dir', root).code, 0);
  await until(() => out.text.includes('Hikari 常驻已停止。'), 30_000, `常驻没有停止：${err.text}`);
});

test('真实进程：没有常驻时 CLI 说没有常驻', { skip: NO_PIPES }, (t) => {
  const root = createRoot(t);
  assert.equal(runCli('init', '--data-dir', root).code, 0);

  const answer = runCli('observe', 'desktop-session', 'status', '--data-dir', root);
  assert.equal(answer.code, 1);
  assert.equal(answer.stdout, '');
  assert.match(answer.stderr, /没有正在提供桌面会话观察入口的 Hikari 常驻/);
});

// The third failure, and the one that has to be a different sentence from the one above.
//
// A resident with a live endpoint whose assessment throws is not a resident that is missing, and the
// mistake this rules out is the tempting one: reusing "no resident is serving this" as a catch-all,
// which would tell a human there is nothing to look at while Hikari is standing there saying it could
// not look.
//
// Worth its own process for a reason beyond that. The `failed` branch of `observe-command.ts` — the
// one that sends the plugin's own words to stderr and exits 1 — is reachable only through a resident
// whose acquisition rejects, which the resident test above cannot produce without breaking the machine
// it runs on. Composed in-process and asked over the real pipe, it costs one child process and is the
// only place that branch runs at all.
test('真实进程：上游失败时 CLI 说「没有完成」，不说「没有观察到」', { skip: NO_PIPES }, async (t) => {
  const { root } = await compose(t, async () => {
    throw new Error('桌面来源暂时不可用');
  });

  const answer = await runCliAsync('observe', 'desktop-session', 'status', '--data-dir', root);

  assert.equal(answer.code, 1);
  // Nothing on stdout: half an answer is not an answer, and a caller redirecting stdout must not
  // collect a plausible-looking observation out of a failed one.
  assert.equal(answer.stdout, '');
  assert.equal(answer.stderr, '桌面会话观察未能完成：桌面来源暂时不可用\n');
  assert.equal(answer.stderr.includes('没有正在提供'), false);
  assert.equal(answer.stderr.includes('unavailable'), false);
});

test('语法：observe 只接受这两个字面量，不接受额外参数，也不接受别的 domain', () => {
  const usage = runCli('observe', 'desktop-session', 'status', '--data-dir', 'root');
  // Without a resident the command still parsed: exit 1 is the absent answer, not a usage error.
  assert.equal(usage.code, 1);
  assert.equal(usage.stderr.includes('用法：'), false);

  const wrongDomain = runCli('observe', 'repository-ci', 'status', '--data-dir', 'root');
  assert.equal(wrongDomain.code, 2);
  assert.match(wrongDomain.stderr, /observe 目前只支持 desktop-session/);

  const wrongWord = runCli('observe', 'desktop-session', 'history', '--data-dir', 'root');
  assert.equal(wrongWord.code, 2);
  assert.match(wrongWord.stderr, /observe desktop-session 目前只支持 status/);

  const extra = runCli('observe', 'desktop-session', 'status', '--data-dir', 'root', '--range', 'now');
  assert.equal(extra.code, 2);
  assert.match(extra.stderr, /未知参数：--range/);
});

// ---------------------------------------------------------------------------------------------
// What this slice must not have become.
// ---------------------------------------------------------------------------------------------

function sourceFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(path));
    else if (entry.name.endsWith('.ts')) found.push(path);
  }
  return found;
}

test('没有引入通用观察 / 查询 / 路由抽象', () => {
  const forbidden =
    /\b(?:ObservationService|ObservationQuery|ObservationApi|GenericObservation|QueryService|QueryDsl|QueryLanguage|SearchService|FilterExpression|FieldSelection|Projection|HistoryStore|TimeRange|DataRouter|MessageRouter|GlobalWorldState)\b/;

  const offenders = sourceFiles(SRC)
    .filter((file) => forbidden.test(readFileSync(file, 'utf8')))
    .map((file) => relative(SRC, file).replaceAll('\\', '/'));

  assert.deepEqual(offenders, []);
});

test('这个模块自己不发布任何 Service', async () => {
  const module = await import('../dist/desktop-session-observe/index.js');
  const services = Object.keys(module).filter((name) => /Service$/.test(name));

  // `desktopSessionAwarenessService` is the plugin's input and is imported from its owner, never
  // re-exported as this module's own: the Contract Creation Gate has nothing to grant here, because
  // nothing inside the composition asks this plugin a question.
  assert.deepEqual(services, []);
});

test('观察入口不读取 World，也不直接读取任何来源', () => {
  const statements = sourceFiles(join(SRC, 'desktop-session-observe')).flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(/import\s+(?:type\s+)?[^;]*from '([^']+)'/g)].map(
      (match) => ({ text: match[0], specifier: match[1] }),
    ),
  );

  // The assessment carries the whole snapshot, so a World read would be a second acquisition of the
  // same instant — the one thing the Boundary Freeze settled against. Same for the two sources: they
  // are behind the World for a reason, and reaching past it would be this module acquiring facts the
  // assessment is already carrying.
  for (const owner of ['desktop-session-world', 'foreground', 'input-activity', 'chronicle']) {
    assert.equal(
      statements.some((statement) => statement.specifier.includes(owner)),
      false,
      `观察入口不应直接依赖 ${owner}`,
    );
  }

  // The Runtime is imported as a type and never as code: `PluginDefinition` is what every plugin in
  // this repository names its own shape with, so forbidding the import would forbid the plugin
  // contract. Binding the Runtime itself would be the different, real mistake, and it is the one
  // asserted against here.
  const runtimeImports = statements.filter((statement) => statement.specifier.includes('runtime/'));
  assert.deepEqual(
    runtimeImports.filter((statement) => !statement.text.startsWith('import type')),
    [],
  );
  for (const statement of runtimeImports) {
    assert.ok(
      statement.specifier.endsWith('/runtime/plugin.js'),
      `从 Runtime 只能取 PluginDefinition 类型，收到：${statement.specifier}`,
    );
  }
});

// The same prohibition, over the client end — a different directory, and so outside the scan above.
//
// `src/cli/observe.ts` states this rule in prose: "Nothing here probes control, and nothing here
// should." This is what makes the prose checkable. Reaching for the Resident's own vocabulary to
// explain a domain plugin's absence is the first step toward asking it domain questions, and adding
// that probe would leave every other test in this file green — the composition the client-level tests
// build has no control endpoint, so nothing there could notice.
test('客户端不触达常驻控制通道，也不从它借一个结论', () => {
  for (const client of ['observe.ts', 'observe-command.ts']) {
    const source = readFileSync(join(SRC, 'cli', client), 'utf8');
    assert.doesNotMatch(source, /from '[^']*\/control\.js'/, `${client} 不应 import 控制通道`);
    assert.doesNotMatch(source, /\brequestControl\b/, `${client} 不应调用 requestControl`);
  }
});
