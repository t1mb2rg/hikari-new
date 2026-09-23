import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { REPLY_TIMEOUT_MS, askFailureLines, requestLanguageAsk } from '../dist/cli/ask.js';
import {
  desktopContextReadExposure,
  desktopSessionAwarenessPeekService,
  desktopSessionAwarenessService,
} from '../dist/desktop-session-awareness/index.js';
import { renderAssessment } from '../dist/desktop-session-observe/index.js';
import { Runtime } from '../dist/index.js';
import { renderFocus } from '../dist/language/express.js';
import {
  LANGUAGE_EXPOSURES,
  MAX_LANGUAGE_TEXT_LENGTH,
  LANGUAGE_PROTOCOL_VERSION,
  createAnswerer,
  createLanguagePlugin,
  decodeLanguageReply,
  decodeLanguageRequest,
  findExposure,
  languageEndpointPath,
  languagePlugin,
  readArguments,
  toModelTools,
} from '../dist/language/index.js';
import { MODEL_TIMEOUT_MS, REASONING_EFFORTS } from '../dist/language/model.js';
import { createExposureReader } from '../dist/language/read.js';
import { oneLine } from '../dist/terminal-text/index.js';
import { workFocusCurrentService, workFocusReadExposure } from '../dist/work-focus/index.js';

// Two halves in one file, and the split between them is the point of the whole design.
//
// The loop tests need no pipe, no network and no resident: `createAnswerer` takes its dependencies as
// arguments, so a test chooses the sequence of model steps and reads what came back. They run
// everywhere, including CI, which is where they matter most — this repository's tests run on
// `ubuntu-latest`, where there are no named pipes and every endpoint test is skipped.
//
// The endpoint tests are the other half and run only on Windows. They are here rather than in a
// separate file for the reason `desktop-session-observe.test.mjs` gives: splitting them would put the
// claims about the wire on the side of the split that CI never runs, and the loop half would then be
// the only thing anybody checked.
//
// What the scripted model can and cannot prove is worth stating once, here, because the last round's
// review turned on exactly this. A scripted model proves *structure*: given that the model decided X,
// the loop does Y. It cannot prove that a real model would decide X. "The model reads the desktop
// because the user asked what is on screen" is a claim about a model's semantic selection, and a fake
// who was told to emit `desktop_context_read` agrees with it by construction. The live-endpoint harness
// that can make that claim is `language-semantic.live.test.mjs`, which is skipped unless an operator
// points it at a real endpoint; nothing in this file is evidence for it.
const NO_PIPES = process.platform === 'win32' ? false : '命名管道只在 Windows 上存在';

const CLI = join(import.meta.dirname, '..', 'dist', 'cli', 'main.js');

// Spelled as code points rather than as escapes or as literal characters, so that this file holds no
// invisible bytes — a test about invisible characters is a poor place to hide some, which is the same
// reason `terminal-text/index.ts` spells its own rule this way.
const ESC = String.fromCharCode(0x1b);

// What a terminal reads as an instruction rather than as text: C0 minus tab, DEL and the C1 block, and
// the two line separators.
function hasTerminalControl(text) {
  for (const character of text) {
    const code = character.codePointAt(0);
    if (code < 0x20 && code !== 0x09) return true;
    if (code >= 0x7f && code <= 0x9f) return true;
    if (code === 0x2028 || code === 0x2029) return true;
  }
  return false;
}

const WORK = 'work_focus_read';
const DESKTOP = 'desktop_context_read';

// A sentence no renderer in this repository could produce. Every test that asserts "model text does not
// reach the human" uses this one string, so a leak is a single substring search rather than a hunt.
const CONFABULATION = '你现在正在专注写 Hikari';

const SNAPSHOT_AT = '2026-02-01T08:30:00.000Z';
const NOW = '2026-02-01T08:31:00.000Z';
const TARGET = { kind: 'present', title: 'hikari-new — 记事本', processName: 'notepad' };

function createRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'hikari-language-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

// A baseline assessment, which is the smallest real value this contract produces and the one that
// needs no comparison partner. Written to the contract's own shape rather than to this file's
// convenience, so that a change to what an assessment is breaks these tests rather than being
// absorbed by them.
function assessmentFixture(title = TARGET.title) {
  return {
    kind: 'baseline',
    current: {
      snapshotAt: SNAPSHOT_AT,
      foreground: {
        kind: 'available',
        observation: {
          observedAt: SNAPSHOT_AT,
          source: 'foreground.windows',
          foreground: { ...TARGET, title },
        },
      },
      inputActivity: {
        kind: 'available',
        observation: {
          observedAt: SNAPSHOT_AT,
          source: 'input-activity.windows',
          lastInputTick: 12345,
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Writing a model's behaviour down: the three things a step can be.
// ---------------------------------------------------------------------------------------------

/** A step in which the model said something and called nothing. */
function says(content, reasoningContent = undefined) {
  return { content, toolCalls: [], truncated: false, reasoningContent };
}

/** A step in which the model called tools, with no prose alongside. */
function callsTo(...toolCalls) {
  return { content: '', toolCalls, truncated: false };
}

/**
 * A step in which a thinking endpoint produced a chain of thought before calling.
 *
 * The reasoning is a fixture string and nothing in these tests reads it as anything but bytes: this
 * repository is not allowed to interpret it, so a test that asserted a meaning would be asserting a
 * behaviour the loop does not have. What is checked is which request it comes back on, on which message,
 * and that it is never anywhere else.
 */
function thinks(reasoningContent, ...toolCalls) {
  return { content: '', toolCalls, truncated: false, reasoningContent };
}

/** One tool call, as the transport would have parsed it. */
function toolCall(id, name, args = '') {
  return { id, name, arguments: args };
}

/** The step that means "stop": no calls, no text. In a grounded interaction this is `done`. */
const DONE = says('');

/**
 * Every dependency recorded, because "the model was actually asked" and "the desktop was not read for
 * a question about the work focus" are both claims about calls that a test has to be able to count.
 *
 * `read` is the *real* `createExposureReader`, wired to instrumented dependencies rather than replaced
 * with a stub. That matters: the claims about which Service a capability reaches, and about a model
 * being shown the same lines a human is, are claims about that code, and a harness that stubbed it out
 * would be testing this file's idea of the wiring instead of the wiring.
 */
function harness({
  script = [],
  throws,
  focus = ['hikari-new'],
  assessment = assessmentFixture(),
  at = NOW,
  readThrows,
} = {}) {
  const requests = [];
  const serviceReads = { focus: 0, peek: 0 };
  const performed = [];
  let clock = at;
  let index = 0;

  const reader = createExposureReader({
    async readFocus() {
      serviceReads.focus += 1;
      return Object.freeze([...focus]);
    },
    async peek() {
      serviceReads.peek += 1;
      if (readThrows !== undefined) throw readThrows;
      return assessment;
    },
  });

  const answerer = createAnswerer({
    async step(request) {
      // Snapshotted rather than kept by reference. The loop keeps pushing onto the array it handed
      // over, so a reference would make every recorded request show the messages added after it was
      // sent — and "was this request complete when it went out" is exactly the question one of these
      // tests asks.
      requests.push({
        messages: request.messages.map((message) => ({ ...message })),
        tools: request.tools,
      });
      if (throws !== undefined) throw throws;
      const next = script[index];
      index += 1;
      if (next === undefined) {
        throw new Error(`模型脚本在第 ${requests.length} 次调用时就用完了，loop 却还在请求下一步`);
      }
      return next;
    },
    async read(exposure) {
      performed.push(exposure.name);
      return reader(exposure);
    },
    now: () => clock,
  });

  return {
    answerer,
    requests,
    serviceReads,
    performed,
    advance: (ms) => {
      clock = new Date(Date.parse(clock) + ms).toISOString();
    },
  };
}

/**
 * The wire invariant, checked on a request that was actually about to be sent.
 *
 * An OpenAI-compatible endpoint rejects the whole request if any assistant message's tool calls are
 * not answered by tool messages before it goes out. Reading the assertion as "for every assistant
 * message in this request, every id it named has a result later in the same array" is the invariant
 * itself rather than a proxy for it. Asserted over every recorded request in the batch and duplicate
 * tests below, not only the one that names it.
 */
function assertWireComplete(request, label) {
  const { messages } = request;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role !== 'assistant') continue;

    const answered = new Set(
      messages
        .slice(index + 1)
        .filter((later) => later.role === 'tool')
        .map((later) => later.toolCallId),
    );
    for (const call of message.toolCalls) {
      assert.ok(answered.has(call.id), `${label}: tool_call ${call.id} 没有对应的 tool 结果`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Speech sovereignty: what the model says, and what the human is shown.
//
// These four are the structural half of the mandate's speech rules. Every one of them is a claim about
// this repository's own control flow, which is a thing a scripted model can settle completely — unlike
// the semantic half, which it cannot touch at all.
// ---------------------------------------------------------------------------------------------

test('tool_calls 非空时，model 的 content 一个字都不进入回答', async () => {
  const h = harness({
    script: [{ content: CONFABULATION, toolCalls: [toolCall('c1', WORK)], truncated: false }, DONE],
  });

  const reply = await h.answerer.answer('我现在关注什么？');

  assert.equal(reply.outcome, 'answered');
  const printed = reply.lines.join('\n');
  assert.ok(!printed.includes(CONFABULATION), 'tool_calls 非空时 content 必须被忽略');
  // Not merely absent from the lines — absent from the machinery. The assistant message echoed back on
  // the next request carries no content at all, so the model is never told it said something no human
  // saw. Asserting the lines alone would pass for an implementation that echoed it into the transcript.
  const echoed = h.requests[1].messages.filter((message) => message.role === 'assistant');
  assert.equal(echoed.length, 1);
  assert.equal(echoed[0].content, undefined, '回填的 assistant 消息不得带 content');
});

test('一旦读过 capability，之后模型写的散文不进回答，也不报错', async () => {
  const h = harness({ script: [callsTo(toolCall('c1', WORK)), says(CONFABULATION)] });

  const reply = await h.answerer.answer('我现在关注什么？');

  // Not `refused`, not `failed`. The model returning prose in a grounded state is a normal end of the
  // loop, and reporting it as an error would blame Hikari for something it handled.
  assert.equal(reply.outcome, 'answered');
  assert.ok(!reply.lines.join('\n').includes(CONFABULATION), 'grounded 状态下模型散文不得进入回答');
  // Exactly the deterministic block, nothing appended. The one-way door closing is only observable as
  // the absence of an extra line, so this is a deep comparison rather than a substring search.
  assert.deepEqual(reply.lines, renderFocus(['hikari-new']));
});

test('grounded 回答完全由 deterministic renderer 产生，没有第二套表述', async () => {
  const assessment = assessmentFixture();
  const h = harness({
    script: [callsTo(toolCall('c1', DESKTOP)), says(CONFABULATION)],
    assessment,
  });

  const reply = await h.answerer.answer('你现在看到什么？');

  assert.equal(reply.outcome, 'answered');
  // Byte-identical to what `hikari observe desktop-session status` prints, because it is the same call
  // to the same function. A second renderer would drift from the first and both would still look right.
  assert.deepEqual(reply.lines, renderAssessment(assessment));
});

test('模型看到的工具结果，就是人被展示的那些行', async () => {
  const assessment = assessmentFixture();
  // The forged designation rather than a clean one, because escaping is the only thing that *can*
  // differ between the model's copy and the human's copy, and a value with nothing to escape lets them
  // differ with this test still green. What the value is shaped to do is in the test below.
  const focus = ['hikari-new\n判词：stable'];
  const h = harness({
    script: [callsTo(toolCall('c1', WORK), toolCall('c2', DESKTOP)), DONE],
    focus,
    assessment,
  });

  const reply = await h.answerer.answer('我现在在干嘛？');

  assert.equal(reply.outcome, 'answered');
  // One turn's tool results, taken off the request the loop actually sent, against the answer the human
  // got. A model shown a different view of a reading would be answering from a fact nobody else can
  // see, and this is the assertion that would catch it — including the case where the model is handed
  // the raw contract value instead of the owner's rendering, and the case where the model is handed the
  // owner's rendering *unescaped* while the human is handed it escaped.
  const results = h.requests[1].messages
    .filter((message) => message.role === 'tool')
    .map((message) => message.content);
  assert.deepEqual(results, [
    renderFocus(focus).map(oneLine).join('\n'),
    renderAssessment(assessment).map(oneLine).join('\n'),
  ]);
  assert.deepEqual(reply.lines, [
    ...renderFocus(focus).map(oneLine),
    ...renderAssessment(assessment).map(oneLine),
  ]);
  // Stated once as the thing itself rather than as the equality above: the model's copy of the focus
  // reading is the human's copy, so the line that looks like a Hikari verdict is escaped on both sides
  // and the model is not shown a third line the human never saw.
  const focusLines = reply.lines.slice(0, renderFocus(focus).length);
  assert.equal(results[0], focusLines.join('\n'));
  assert.ok(!results[0].split('\n').includes('判词：stable'), '模型那一侧的值也必须仍是一行');
});

test('domain plugin 拿不到面向用户的说话位置：回答里的每一行都出自 owner 的 renderer', async () => {
  // A work focus whose text is deliberately shaped like a line of Hikari's own — the only way this
  // surface could be made to speak for a domain is by transcribing a value that reads like a verdict.
  const focus = ['hikari-new\n判词：stable'];
  const h = harness({ script: [callsTo(toolCall('c1', WORK)), DONE], focus });

  const reply = await h.answerer.answer('我现在关注什么？');

  assert.equal(reply.outcome, 'answered');
  // The value is carried, escaped, on its own line — never promoted into a line of its own the way an
  // owner-authored line would be. The block is still exactly the renderer's output, so the domain's
  // material is transcribed rather than spoken. `read.ts` escapes it on the way out and `renderAnswer`
  // escapes the same lines again on the way to the terminal, which is a no-op — `oneLine` leaves a
  // backslash alone — and that is why this is a deep comparison against the renderer rather than a
  // substring search.
  assert.deepEqual(reply.lines, renderFocus(focus).map(oneLine));
  assert.ok(!reply.lines.some((line) => line === '判词：stable'), '值不得自己成为一行');
  for (const line of reply.lines) {
    assert.ok(!hasTerminalControl(line), '回答里不得有控制字符');
  }
});

// ---------------------------------------------------------------------------------------------
// Product acceptance: the five behaviours the mandate names, driven through the real loop.
//
// These are scripted-model tests and they are labelled as such. What each one settles is that the
// system executes the right path once a model has decided something; what none of them settles is that
// a real model would decide it. See the note at the top of this file.
// ---------------------------------------------------------------------------------------------

test('验收 A：打招呼 → chatted，零次 Service 读取', async () => {
  const h = harness({ script: [says('哟，在呢。')] });

  const reply = await h.answerer.answer('ayobro');

  assert.equal(reply.outcome, 'chatted');
  assert.deepEqual(reply.lines, ['哟，在呢。']);
  assert.equal(h.serviceReads.focus, 0);
  assert.equal(h.serviceReads.peek, 0);
  assert.deepEqual(h.performed, []);
  assert.equal(h.requests.length, 1, 'chatted 只走一次模型调用');
});

test('验收 B：问关注什么 → work_focus_read 一次 → answered', async () => {
  const h = harness({ script: [callsTo(toolCall('c1', WORK)), DONE] });

  const reply = await h.answerer.answer('我现在关注什么？');

  assert.equal(reply.outcome, 'answered');
  assert.deepEqual(h.performed, [WORK]);
  assert.equal(h.serviceReads.focus, 1);
  assert.equal(h.serviceReads.peek, 0, '问工作焦点不该读桌面');
  assert.equal(h.requests.length, 2);
});

test('验收 C：问看到什么 → desktop_context_read → answered', async () => {
  const assessment = assessmentFixture();
  const h = harness({ script: [callsTo(toolCall('c1', DESKTOP)), DONE], assessment });

  const reply = await h.answerer.answer('你现在看到什么？');

  assert.equal(reply.outcome, 'answered');
  assert.deepEqual(h.performed, [DESKTOP]);
  assert.equal(h.serviceReads.peek, 1);
  assert.equal(h.serviceReads.focus, 0, '问桌面不该读工作焦点');
  assert.deepEqual(reply.lines, renderAssessment(assessment));
});

test('验收 D：两个都要 → 两次读取、三次模型调用', async () => {
  const assessment = assessmentFixture();
  const h = harness({
    script: [callsTo(toolCall('c1', WORK)), callsTo(toolCall('c2', DESKTOP)), DONE],
    assessment,
  });

  const reply = await h.answerer.answer('我现在在干嘛？');

  assert.equal(reply.outcome, 'answered');
  assert.deepEqual(h.performed, [WORK, DESKTOP], '读取顺序就是模型选择的顺序');
  assert.equal(h.serviceReads.focus, 1);
  assert.equal(h.serviceReads.peek, 1);
  assert.equal(h.requests.length, 3, '两次读取加一次收尾');
  // Both blocks, in the order they were read, with nothing joining them. A connective sentence would
  // be this surface composing a claim out of two readings.
  assert.deepEqual(reply.lines, [...renderFocus(['hikari-new']), ...renderAssessment(assessment)]);
});

test('验收 E：随口说一句 → chatted，零次 Service 读取', async () => {
  const h = harness({ script: [says('那就先歇会儿。')] });

  const reply = await h.answerer.answer('最近写 Hikari 写麻了');

  assert.equal(reply.outcome, 'chatted');
  assert.deepEqual(reply.lines, ['那就先歇会儿。']);
  assert.equal(h.serviceReads.focus + h.serviceReads.peek, 0);
  assert.equal(h.requests.length, 1);
});

test('合法的「确实没有」是 answered，不是 refused，也不是空回答', async () => {
  // The domain was read and it honestly has nothing to report. That is a fact about the machine, not a
  // failure of the pipeline, and the renderer already says so in its own words — so the answer is
  // `answered`, and the human gets the focus surface's statement that no designation exists.
  //
  // Worth its own test because the shape of the wrong implementation is subtle: "a block was read" and
  // "a block has lines" are two different facts, and a loop that conflated them would report the empty
  // case as `refused` while every other test in this file stayed green — none of them ever hands the
  // language surface an empty reading.
  const h = harness({ script: [callsTo(toolCall('c1', WORK)), DONE], focus: [] });

  const reply = await h.answerer.answer('我现在关注什么？');

  assert.equal(reply.outcome, 'answered');
  assert.equal(h.serviceReads.focus, 1, '「没有」也是真的读了一次才知道的');
  assert.deepEqual(h.performed, [WORK]);
  assert.deepEqual(reply.lines, renderFocus([]));
  assert.ok(reply.lines.length > 0, '空集不得变成空回答');
});

// ---------------------------------------------------------------------------------------------
// The closed set: what a model may name, and what happens to everything else.
// ---------------------------------------------------------------------------------------------

test('tools[] 完全由 owner 的 exposure 机械生成，没有第二份描述', () => {
  const tools = toModelTools();

  assert.equal(tools.length, LANGUAGE_EXPOSURES.length);
  assert.deepEqual(
    tools.map((tool) => tool.function.name),
    LANGUAGE_EXPOSURES.map((exposure) => exposure.name),
  );
  // Identity rather than equality: a description that matched by coincidence would still be a second
  // copy of it, and would still be the copy that goes stale. The owner's words are passed through by
  // reference, so there is no place for Language to have written its own.
  for (const [index, tool] of tools.entries()) {
    assert.equal(tool.function.description, LANGUAGE_EXPOSURES[index].description);
  }
  assert.deepEqual(tools[0].function.parameters, {
    type: 'object',
    properties: {},
    additionalProperties: false,
  });
});

test('每个 exposure 的名字都是 provider 接受的 function.name 形状', () => {
  // Not a style rule and not this repository's idea of tidy. OpenAI-compatible function calling accepts
  // `^[a-zA-Z0-9_-]+$` as `tools[*].function.name` and rejects the *entire request* with a 400
  // otherwise, so a dotted name does not read as "no model picked this capability" — it reads as a
  // request that never reached a model, and the caller waits out a 90-second timeout for an answer
  // nobody was asked to give. The names belong to the owners, so the constraint is asserted against the
  // list they actually exported; the next owner to reach for a dot learns it here rather than from a
  // provider error at the far end of the wire.
  const functionName = /^[a-zA-Z0-9_-]+$/;

  for (const exposure of LANGUAGE_EXPOSURES) {
    assert.match(exposure.name, functionName, `${exposure.name} 不是一个合法的 function.name`);
  }
});

test('findExposure 只在当前字面 exposure 集合里查，模型字符串永远不是 Service key', () => {
  assert.equal(findExposure(WORK), workFocusReadExposure);
  assert.equal(findExposure(DESKTOP), desktopContextReadExposure);

  for (const name of ['work-focus', 'desktop-state', 'desktop-session-awareness.peek', 'read', '__proto__', 'toString']) {
    assert.equal(findExposure(name), undefined, `${name} 不该被解析成任何 exposure`);
  }
});

test('未知能力不进入 Service，得到 refused，且模型的原话不出现在回答里', async () => {
  const h = harness({ script: [callsTo(toolCall('c1', 'chronicle.write', '{"text":"hi"}'))] });

  const reply = await h.answerer.answer('帮我把这个记下来');

  assert.equal(reply.outcome, 'refused');
  assert.deepEqual(h.performed, [], '未知能力不得导致任何 Service 读取');
  assert.equal(h.serviceReads.focus + h.serviceReads.peek, 0);
  assert.ok(!reply.lines.join('\n').includes('chronicle.write'), '不得回显模型写的名字');
  // One request only: the batch was refused and the loop left without asking again.
  assert.equal(h.requests.length, 1);
});

test('带参数的能力调用不进入 Service，得到 refused', async () => {
  for (const args of ['{"topic":"work-focus"}', '{"name":"x"}', '[]', 'null', 'not json', '"x"']) {
    const h = harness({ script: [callsTo(toolCall('c1', WORK, args))] });

    const reply = await h.answerer.answer('我现在关注什么？');

    assert.equal(reply.outcome, 'refused', `应拒绝参数 ${args}`);
    assert.deepEqual(h.performed, [], `参数 ${args} 不得导致 Service 读取`);
    assert.equal(h.requests.length, 1);
  }
});

test('零参数规则的封闭集合：只有空、空白与空对象是「没有参数」', () => {
  for (const raw of ['', '   ', '\n', '{}', ' { } ']) {
    assert.equal(readArguments(raw), 'none', `${JSON.stringify(raw)} 应读作没有参数`);
  }
  for (const raw of ['{"a":1}', '[]', 'null', '42', '"x"', 'true', 'nope', '{']) {
    assert.equal(readArguments(raw), 'malformed', `${JSON.stringify(raw)} 应读作带了参数`);
  }
});

// ---------------------------------------------------------------------------------------------
// Termination, and the batch rules that make it safe.
// ---------------------------------------------------------------------------------------------

test('永远重复同一个调用的模型，确定性终止：一次 Service 读取，两次模型调用', async () => {
  // A model that will never stop asking. There is no step counter in the loop to catch this; what stops
  // it is that a repeat consumes nothing new, so the loop cannot continue.
  //
  // The script holds one step more than the loop is allowed to take, and the harness throws when asked
  // for a step past the end. So a loop that failed to terminate would come back `failed` with the
  // harness's own complaint, rather than quietly reporting the answer these assertions look for.
  const h = harness({
    script: [
      callsTo(toolCall('c1', WORK)),
      callsTo(toolCall('c2', WORK)),
      callsTo(toolCall('c3', WORK)),
    ],
  });

  const reply = await h.answerer.answer('我现在关注什么？');

  assert.equal(reply.outcome, 'answered');
  assert.equal(h.serviceReads.focus, 1, '同一个 capability 一轮内只读一次');
  assert.equal(h.requests.length, 2, '第二次请求里的重复调用让 loop 停下，不发第三次');
  assert.deepEqual(reply.lines, renderFocus(['hikari-new']));
});

test('批量里第二个是重复调用：只真正读一次，两个 call id 都得到完整处理，且不再发下一次请求', async () => {
  // The mandate's case, written exactly as asked: one assistant message with two tool_calls, the
  // second a duplicate of the first.
  const h = harness({ script: [callsTo(toolCall('first', WORK), toolCall('second', WORK))] });

  const reply = await h.answerer.answer('我现在关注什么？');

  assert.equal(reply.outcome, 'answered');
  // Read once. The second call is answered on the wire but performed nowhere.
  assert.deepEqual(h.performed, [WORK]);
  assert.equal(h.serviceReads.focus, 1);
  // Both calls were resolved — the batch is finished before the loop decides anything — and the
  // interaction stopped, so there is no next request that could be missing a result.
  assert.equal(h.requests.length, 1);
  assert.deepEqual(reply.lines, renderFocus(['hikari-new']));
});

test('后面的批量里出现重复调用：不重读，批次照样走完，且模型请求始终 wire-complete', async () => {
  const assessment = assessmentFixture();
  const h = harness({
    script: [callsTo(toolCall('a', WORK)), callsTo(toolCall('b', WORK), toolCall('c', DESKTOP))],
    assessment,
  });

  const reply = await h.answerer.answer('我现在在干嘛？');

  assert.equal(reply.outcome, 'answered');
  // `b` is a duplicate of a capability already read and `c` is fresh. The fresh one is performed; the
  // duplicate is answered on the wire and not re-read.
  assert.deepEqual(h.performed, [WORK, DESKTOP]);
  assert.equal(h.serviceReads.focus, 1);
  assert.equal(h.serviceReads.peek, 1);
  // The second request carries the first batch's assistant message, and it went out only once that
  // message's call had a result. Then the loop left, so there is no third request.
  assert.equal(h.requests.length, 2);
  assertWireComplete(h.requests[1], '第二批请求');
  assert.deepEqual(reply.lines, [...renderFocus(['hikari-new']), ...renderAssessment(assessment)]);
});

test('每一个发出去的请求，里面每一条 assistant 消息的 tool_call 都有结果', async () => {
  const h = harness({
    script: [
      callsTo(toolCall('a', WORK), toolCall('b', DESKTOP)),
      callsTo(toolCall('c', DESKTOP), toolCall('d', 'no.such.capability')),
      DONE,
    ],
  });

  const reply = await h.answerer.answer('我现在在干嘛？');

  assert.equal(reply.outcome, 'answered');
  for (const [index, request] of h.requests.entries()) {
    assertWireComplete(request, `第 ${index + 1} 次请求`);
  }
  // `c` is a duplicate and `d` is unknown, so the batch stops the loop — after both were resolved.
  assert.deepEqual(h.performed, [WORK, DESKTOP]);
  assert.equal(h.requests.length, 2);
});

test('模型调用的上界是 LANGUAGE_EXPOSURES 的大小推出来的，不是魔数', async () => {
  // A model that never stops asking for one more step, holding a step the loop must not reach. Both
  // capabilities are read by the third call, so the third has nothing left to consume and is the last —
  // and the script's fourth entry is what tells a loop that counted steps instead of applying that
  // invariant apart from this one. Such a loop would take the fourth step, the harness would throw on
  // the fifth, and the request count asserted below would be wrong.
  const h = harness({
    script: [
      callsTo(toolCall('a', WORK)),
      callsTo(toolCall('b', DESKTOP)),
      callsTo(toolCall('c', WORK)),
      DONE,
    ],
  });

  const reply = await h.answerer.answer('我现在在干嘛？');

  assert.equal(reply.outcome, 'answered');
  assert.deepEqual(h.performed, [WORK, DESKTOP], '两个 capability 各读一次');
  assert.equal(h.requests.length, LANGUAGE_EXPOSURES.length + 1);
  assert.equal(h.requests.length, 3, '第三次请求之后的重复调用没有消费任何新东西，loop 在这里结束');
});

// ---------------------------------------------------------------------------------------------
// Thinking, and the one thing the loop does with it: hand it back.
//
// A thinking endpoint pairs a chain of thought with the assistant turn it produced, and requires that
// turn — calls and reasoning together — to come back on the following request. The whole feature is that
// message plumbing, so what is tested is the plumbing: which request carries which reasoning, on which
// message, and where it is *not* allowed to go. Nothing here asserts a meaning for the text, because
// nothing in this repository reads it as text.
// ---------------------------------------------------------------------------------------------

test('A：没有 thinking 的模型，回填的消息上不会凭空多出一个 reasoning_content', async () => {
  // The behaviour every deployment that configures no effort already had, checked on the loop rather than
  // on the transport: a script that never produces a chain of thought must produce requests where none
  // appears — not an empty one, not a placeholder, nothing.
  const h = harness({ script: [callsTo(toolCall('a', WORK)), DONE] });

  const reply = await h.answerer.answer('我现在关注什么？');

  assert.equal(reply.outcome, 'answered');
  assert.deepEqual(reply.lines, renderFocus(['hikari-new']));
  for (const [index, request] of h.requests.entries()) {
    for (const message of request.messages) {
      if (message.role !== 'assistant') continue;
      assert.equal(message.reasoningContent, undefined, `第 ${index + 1} 次请求不该带上推理内容`);
    }
  }
});

test('B：第一轮 thinking + tool call，下一轮请求把 R1 和 tool_calls 一起带回', async () => {
  const h = harness({ script: [thinks('R1', toolCall('a', WORK)), DONE] });

  const reply = await h.answerer.answer('我现在关注什么？');

  assert.equal(reply.outcome, 'answered');
  assert.equal(h.requests.length, 2);

  const { messages } = h.requests[1];
  const at = messages.findIndex((message) => message.role === 'assistant');
  // On the assistant message, beside the calls it belongs to — not on the tool result, not on a message
  // of its own, and not merged into the content. A thinking endpoint matches the pair to the turn it
  // produced; separated, the request is one it cannot answer about.
  assert.equal(messages[at].reasoningContent, 'R1');
  assert.deepEqual(messages[at].toolCalls, [toolCall('a', WORK)]);
  // And the result of that call follows immediately, so the wire invariant is untouched by the echo.
  assert.equal(messages[at + 1].role, 'tool');
  assert.equal(messages[at + 1].toolCallId, 'a');
  assertWireComplete(h.requests[1], '思考后的第二轮请求');
  assert.ok(!reply.lines.join('\n').includes('R1'));
});

test('C：两轮 thinking 各自跟在自己的那一轮上，不交叉、不合并、不丢失', async () => {
  // The case a live endpoint reaches whenever one question needs two reads. Each batch produces its own
  // assistant turn with its own chain of thought, and the third request has to carry both turns intact:
  // R1 still on the first, R2 on the second, and the first turn's tool result still between them.
  const assessment = assessmentFixture();
  const h = harness({
    script: [
      thinks('R1', toolCall('a', WORK)),
      thinks('R2', toolCall('b', DESKTOP)),
      DONE,
    ],
    assessment,
  });

  const reply = await h.answerer.answer('我现在在干嘛？');

  assert.equal(reply.outcome, 'answered');
  assert.equal(h.requests.length, 3);

  const { messages } = h.requests[2];
  const assistants = messages.filter((message) => message.role === 'assistant');
  assert.equal(assistants.length, 2, '两轮 assistant 消息都要在，不得合并成一条');
  assert.equal(assistants[0].reasoningContent, 'R1', '第一轮的推理不得被第二轮的覆盖');
  assert.equal(assistants[1].reasoningContent, 'R2', '第二轮的推理不得丢失');
  // The calls travel with their own reasoning rather than both with one: crossing them would send the
  // endpoint a turn it never produced, which is a failure no first-turn test can see.
  assert.deepEqual(assistants[0].toolCalls, [toolCall('a', WORK)]);
  assert.deepEqual(assistants[1].toolCalls, [toolCall('b', DESKTOP)]);
  assert.deepEqual(
    messages.filter((message) => message.role === 'tool').map((message) => message.toolCallId),
    ['a', 'b'],
    '第一轮的 tool 结果不得被第二轮挤掉',
  );
  assertWireComplete(h.requests[2], '第三轮请求');

  const printed = reply.lines.join('\n');
  for (const text of ['R1', 'R2']) {
    assert.ok(!printed.includes(text), `${text} 不得出现在回答里`);
  }
  assert.deepEqual(reply.lines, [...renderFocus(['hikari-new']), ...renderAssessment(assessment)]);
});

test('D：最后一轮的 thinking 不进回答、不进 detail，也不跨到下一个 interaction', async () => {
  const FINAL = `${CONFABULATION}（最后一段推理）`;
  const h = harness({
    // The last step of a grounded answer: the model is done, and everything it wrote on that step is
    // dropped. The reasoning goes with it — there is no following request in this interaction for it to
    // come back on, which is where its lifecycle ends by construction rather than by cleanup.
    script: [callsTo(toolCall('a', WORK)), says(CONFABULATION, FINAL), says('在的。')],
  });

  const reply = await h.answerer.answer('我现在关注什么？');

  assert.equal(reply.outcome, 'answered');
  assert.deepEqual(reply.lines, renderFocus(['hikari-new']));
  assert.ok(!JSON.stringify(reply).includes(FINAL), '最后一轮的推理不得进入回答的任何字段');
  assert.ok(!JSON.stringify(reply).includes(CONFABULATION));
  assert.equal(h.requests.length, 2, '最后一轮没有 tool_calls，循环在那里结束');

  // The next question is the real test of "not across interactions": same answerer, so the same Dialogue
  // Context, and the request it builds must not carry one byte of the previous interaction's thinking.
  const next = await h.answerer.answer('那现在呢？');
  assert.equal(next.outcome, 'chatted');
  for (const [index, request] of h.requests.entries()) {
    for (const message of request.messages) {
      const serialized = JSON.stringify(message);
      assert.ok(!serialized.includes(FINAL), `第 ${index + 1} 次请求里出现了上一轮的推理`);
      assert.ok(!serialized.includes(CONFABULATION), `第 ${index + 1} 次请求里出现了 model 的自由文本`);
    }
  }
});

test('E：chatted 路径上 thinking 不进回答，回答仍只有 model 的正文', async () => {
  const FINAL = `${CONFABULATION}（闲聊时的一段推理）`;
  const h = harness({ script: [says('在的。', FINAL)] });

  const reply = await h.answerer.answer('ayobro');

  // The chat branch returns the model's own content and nothing else. The reasoning rides on the same
  // step and must not be added to the lines, appended after them, or used to explain them.
  assert.equal(reply.outcome, 'chatted');
  assert.deepEqual(reply.lines, ['在的。']);
  assert.ok(!JSON.stringify(reply).includes(FINAL));
  assert.equal(h.requests.length, 1);
});

test('F：thinking 不能让 grounded 回答绕过 deterministic renderer', async () => {
  // The one-way door, with a thinking model on the other side of it: once a capability has been read, the
  // answer is the owner's rendering of what was read — and a chain of thought is a model's prose like any
  // other, so there is no route by which it becomes the answer. The final step carries the loudest version
  // of the temptation: a confabulation in the content and a third chain of thought beside it.
  const assessment = assessmentFixture();
  const h = harness({
    script: [
      thinks('R1', toolCall('a', DESKTOP)),
      thinks('R2', toolCall('b', WORK)),
      says(CONFABULATION, 'R3'),
    ],
    assessment,
  });

  const reply = await h.answerer.answer('我现在在干嘛？');

  assert.equal(reply.outcome, 'answered');
  assert.deepEqual(reply.lines, [...renderAssessment(assessment), ...renderFocus(['hikari-new'])]);
  for (const text of [CONFABULATION, 'R1', 'R2', 'R3']) {
    assert.ok(!reply.lines.join('\n').includes(text), `${text} 不得出现在回答里`);
  }
});

// ---------------------------------------------------------------------------------------------
// Failure semantics: four outcomes, and the reason they are four.
// ---------------------------------------------------------------------------------------------

test('模型不可达是 failed，不是 refused', async () => {
  const h = harness({ throws: new Error('connect ECONNREFUSED 127.0.0.1:11434') });

  const reply = await h.answerer.answer('你现在看到什么？');

  assert.equal(reply.outcome, 'failed');
  // The reason is carried, because "the model is unreachable" and "the model answered nonsense" call
  // for different repairs and a human can only act on the difference if they are told which happened.
  assert.ok(reply.lines.join('\n').includes('ECONNREFUSED'));
});

test('读到一半模型断了是 failed，不是把已经读到的拼成回答', async () => {
  // Written by hand rather than through the harness, because the sequence this test is about is one
  // where the *second* step fails — the first already performed a real read, so the loop is holding a
  // block when the transport dies.
  let seen = 0;
  const answerer = createAnswerer({
    async step() {
      seen += 1;
      if (seen === 1) return callsTo(toolCall('a', WORK));
      throw new Error('模型端点没有应答');
    },
    async read() {
      return renderFocus(['hikari-new']);
    },
    now: () => NOW,
  });

  const reply = await answerer.answer('我现在关注什么？');

  assert.equal(reply.outcome, 'failed');
  assert.equal(seen, 2, '第一次读取应当真的发生过，否则这条测试什么都没测到');
  // Answering out of whatever arrived before the failure would be this pipeline forming a sentence
  // about a reading that never completed.
  assert.ok(!reply.lines.join('\n').includes('hikari-new'), '半途失败不得输出部分读取结果');
});

test('capability Service 拒绝时是 failed，且回答里没有部分结果', async () => {
  const h = harness({
    script: [callsTo(toolCall('a', WORK), toolCall('b', DESKTOP))],
    readThrows: new Error('desktop 采集器没有响应'),
  });

  const reply = await h.answerer.answer('我现在在干嘛？');

  assert.equal(reply.outcome, 'failed');
  assert.ok(reply.lines.join('\n').includes('desktop 采集器没有响应'));
  assert.ok(!reply.lines.join('\n').includes('你当前明确关注'), '失败的回答不含已经读到的那一半');
});

test('模型第一轮什么都没给是 refused，不是 failed', async () => {
  for (const step of [says(''), says('   \n ')]) {
    const h = harness({ script: [step] });
    const reply = await h.answerer.answer('嗯');
    assert.equal(reply.outcome, 'refused');
    assert.equal(h.serviceReads.focus + h.serviceReads.peek, 0);
  }
});

test('refused 与 failed 是两件不同的事，不能说成同一件', async () => {
  const refused = await harness({ script: [says('')] }).answerer.answer('嗯');
  const failed = await harness({ throws: new Error('模型端点不可达') }).answerer.answer('嗯');

  assert.notEqual(refused.outcome, failed.outcome);
  assert.notDeepEqual(refused.lines, failed.lines);
  assert.ok(!refused.lines.join('\n').includes('模型端点不可达'));
  assert.ok(!failed.lines.join('\n').includes('没有找到该读'));
});

test('chatted 与 answered 是两件不同的事，chatted 不是低一等的 answered', async () => {
  const chatted = await harness({ script: [says('在的。')] }).answerer.answer('ayobro');
  const answered = await harness({ script: [callsTo(toolCall('a', WORK)), DONE] }).answerer.answer('关注什么');

  assert.equal(chatted.outcome, 'chatted');
  assert.equal(answered.outcome, 'answered');
  assert.deepEqual(chatted.lines, ['在的。']);
  // The grounded answer contains no conversational text at all, and the chat answer contains no
  // reading. Neither is a degraded form of the other.
  assert.ok(!answered.lines.join('\n').includes('在的。'));
  assert.ok(!chatted.lines.join('\n').includes('你当前明确关注'));
});

test('被截断的聊天回答不展示，也不是 failed', async () => {
  const h = harness({ script: [{ content: '这个嘛，我想想，其实是', toolCalls: [], truncated: true }] });

  const reply = await h.answerer.answer('你怎么看');

  // The model answered and ran out of room. Reporting `failed` would claim it was unreachable; showing
  // the prefix would show a human a sentence the model did not finish.
  assert.equal(reply.outcome, 'refused');
  assert.ok(!reply.lines.join('\n').includes('这个嘛'));
});

test('模型自由文本不进拒绝文案、不进细节行', async () => {
  // Two refusals, both of which the model reached by writing something this build would not act on.
  // The prose is alongside the call in each case, so the temptation being tested is a diagnostic that
  // quotes what the model said in order to explain why it was not acted on.
  const unknown = await harness({
    script: [{ content: CONFABULATION, toolCalls: [toolCall('a', 'nope')], truncated: false }],
  }).answerer.answer('嗯');

  const malformed = await harness({
    script: [
      { content: CONFABULATION, toolCalls: [toolCall('a', WORK, `{"x":"${CONFABULATION}"}`)], truncated: false },
    ],
  }).answerer.answer('嗯');

  for (const reply of [unknown, malformed]) {
    assert.equal(reply.outcome, 'refused');
    assert.ok(!reply.lines.join('\n').includes(CONFABULATION), '模型自由文本不得出现在任何一行');
    assert.ok(!reply.lines.join('\n').includes(ESC), '回答里不得有 ESC');
  }
});

// ---------------------------------------------------------------------------------------------
// Dialogue: the referent is what was read, and only a grounded answer moves it.
// ---------------------------------------------------------------------------------------------

test('后续问题带上上一轮真正读到过的 capability', async () => {
  const h = harness({ script: [callsTo(toolCall('a', WORK)), DONE, DONE] });
  await h.answerer.answer('我现在关注什么？');
  await h.answerer.answer('那现在呢？');

  assert.ok(!h.requests[0].messages[0].content.includes('上一轮这个人问的问题'), '第一轮没有 referent');
  assert.ok(h.requests[2].messages[0].content.includes(WORK), '第二轮提示词应带上上一轮读到的能力');
});

test('chatted 不成为 referent，也不清除已有的 grounded referent', async () => {
  const h = harness({ script: [callsTo(toolCall('a', WORK)), DONE, says('哈哈'), DONE] });

  await h.answerer.answer('我现在关注什么？');
  const chat = await h.answerer.answer('ayobro');
  assert.equal(chat.outcome, 'chatted');

  await h.answerer.answer('那现在呢？');

  // `requests[3]` is the third turn's first request. The chat turn in between read nothing, so it lent
  // nothing and took nothing: the referent is still the focus read. A human who says "ayobro" between
  // two questions about their focus has not changed the subject, and a chat turn that erased the
  // referent would make the second question worse than it was before the greeting.
  assert.ok(h.requests[3].messages[0].content.includes(WORK), 'chatted 不得覆盖 grounded referent');
});

test('refused 不推进 referent，也不清除已有的那个', async () => {
  const h = harness({ script: [callsTo(toolCall('a', WORK)), DONE, says(''), DONE] });

  await h.answerer.answer('我现在关注什么？');
  const refused = await h.answerer.answer('嗯');
  assert.equal(refused.outcome, 'refused');

  await h.answerer.answer('那现在呢？');

  assert.ok(h.requests[2].messages[0].content.includes(WORK), 'refused 不得清除 grounded referent');
});

test('failed 不推进 referent，也不清除已有的那个', async () => {
  let step = 0;
  const requests = [];
  const answerer = createAnswerer({
    async step(request) {
      requests.push({ messages: request.messages.map((message) => ({ ...message })) });
      step += 1;
      if (step === 1) return callsTo(toolCall('a', WORK));
      if (step === 2) return DONE;
      if (step === 3) throw new Error('模型端点不可达');
      return DONE;
    },
    async read() {
      return renderFocus(['hikari-new']);
    },
    now: () => NOW,
  });

  await answerer.answer('我现在关注什么？');
  const failed = await answerer.answer('嗯');
  assert.equal(failed.outcome, 'failed');

  await answerer.answer('那现在呢？');

  assert.ok(requests[3].messages[0].content.includes(WORK), 'failed 不得清除 grounded referent');
});

test('新的激活不带上一轮的任何东西', async () => {
  const first = harness({ script: [callsTo(toolCall('a', WORK)), DONE] });
  await first.answerer.answer('我现在关注什么？');

  // A second answerer is what a resident restart produces: the turn is the activation's, so nothing
  // crosses between them. This is the "reactivation 清空" case, and it holds without any cleanup code
  // because there is nowhere for the turn to be stored except the closure that just died.
  const second = harness({ script: [DONE] });
  await second.answerer.answer('那现在呢？');

  assert.ok(!second.requests[0].messages[0].content.includes('上一轮这个人问的问题'));
});

test('referent 会过期，过期后不再被当成依据', async () => {
  // The model re-reads on the second question, because that is what an expired referent leaves it to
  // do: it is told nothing about the previous turn, so a `那现在呢` has to be resolved by reading again.
  const h = harness({
    script: [callsTo(toolCall('a', WORK)), DONE, callsTo(toolCall('b', WORK)), DONE],
  });
  await h.answerer.answer('我现在关注什么？');

  h.advance(5 * 60 * 1000 + 1000);
  const reply = await h.answerer.answer('那现在呢？');

  assert.equal(reply.outcome, 'answered');
  assert.ok(!h.requests[2].messages[0].content.includes('上一轮这个人问的问题'), '过期后不该再带上 referent');
  assert.ok(!reply.lines.join('\n').includes('按上一轮'), '过期后不该声称按上一轮回答');
});

test('一次提问里桌面只经 peek，绝不碰 current', async () => {
  const h = harness({ script: [callsTo(toolCall('a', DESKTOP)), DONE] });
  await h.answerer.answer('你现在看到什么？');

  // `current()` would make the question the next comparison partner of the timeline it is asking
  // about. The plugin is not given that contract at all — see the `requires` test below — and this is
  // the behavioural half of the same claim.
  assert.equal(h.serviceReads.peek, 1);
  assert.ok(!languagePlugin.requires.includes(desktopSessionAwarenessService));
});

// ---------------------------------------------------------------------------------------------
// Request bounds and the wire vocabulary.
// ---------------------------------------------------------------------------------------------

test('空问题和超长问题是 refused，而且不会去问模型', async () => {
  for (const text of ['', '   \n ']) {
    const h = harness({ script: [DONE] });
    assert.equal((await h.answerer.answer(text)).outcome, 'refused');
    assert.equal(h.requests.length, 0, '空问题不该产生一次模型调用');
  }

  const tooLong = harness({ script: [DONE] });
  const long = await tooLong.answerer.answer('x'.repeat(MAX_LANGUAGE_TEXT_LENGTH + 1));
  assert.equal(long.outcome, 'refused');
  assert.equal(tooLong.requests.length, 0, '超长问题不该产生一次模型调用');

  // Exactly at the bound is a question, not a refusal. A bound that rejected its own limit would make
  // the number in the message a lie.
  const atLimit = harness({ script: [says('嗯')] });
  const accepted = await atLimit.answerer.answer('x'.repeat(MAX_LANGUAGE_TEXT_LENGTH));
  assert.equal(accepted.outcome, 'chatted');
  assert.equal(atLimit.requests.length, 1);

  // The human's sentence travels verbatim, as the user message and nothing else.
  const h = harness({ script: [says('嗯')] });
  await h.answerer.answer('  光，你现在看到什么？  ');
  assert.equal(h.requests[0].messages[1].content, '  光，你现在看到什么？  ');
});

test('信封不是一个合法请求时，解码就拒绝；而空问题解码通过、由插件来拒绝', () => {
  const bad = [
    'not json',
    '[]',
    'null',
    JSON.stringify({ protocol: LANGUAGE_PROTOCOL_VERSION + 1, request: 'ask', text: 'hi' }),
    JSON.stringify({ protocol: LANGUAGE_PROTOCOL_VERSION, request: 'command', text: 'hi' }),
    JSON.stringify({ protocol: LANGUAGE_PROTOCOL_VERSION, request: 'ask', text: 'hi', extra: 1 }),
    JSON.stringify({ protocol: LANGUAGE_PROTOCOL_VERSION, request: 'ask' }),
    JSON.stringify({ protocol: LANGUAGE_PROTOCOL_VERSION, request: 'ask', text: 42 }),
  ];

  for (const line of bad) {
    assert.equal(decodeLanguageRequest(line).kind, 'refused', `应拒绝：${line}`);
  }

  const empty = decodeLanguageRequest(
    JSON.stringify({ protocol: LANGUAGE_PROTOCOL_VERSION, request: 'ask', text: '' }),
  );
  assert.equal(empty.kind, 'request');
  assert.equal(empty.request.text, '');
});

test('chatted 是协议里的第四个结果词，客户端读得懂', () => {
  const line = JSON.stringify({
    protocol: LANGUAGE_PROTOCOL_VERSION,
    outcome: 'chatted',
    lines: ['在的。'],
  });
  const decoded = decodeLanguageReply(line);
  assert.equal(decoded.kind, 'reply');
  assert.equal(decoded.reply.outcome, 'chatted');

  const unknown = JSON.stringify({
    protocol: LANGUAGE_PROTOCOL_VERSION,
    outcome: 'ok',
    lines: ['x'],
  });
  assert.equal(decodeLanguageReply(unknown).kind, 'unreadable');
});

test('CLI 的等待上界高于 loop 合法能花掉的时间', () => {
  // The bug this pins was real: the client waited 60s while the loop could legitimately spend 45s on
  // model calls alone plus a desktop read, so a question being answered could be reported as one that
  // was never answered. The number is derived rather than asserted, so adding a third capability that a
  // model reads on its own breaks this test instead of timing a human out.
  const maxModelCalls = LANGUAGE_EXPOSURES.length + 1;
  const modelTime = maxModelCalls * MODEL_TIMEOUT_MS;

  assert.ok(REPLY_TIMEOUT_MS > modelTime, `客户端上界 ${REPLY_TIMEOUT_MS} 必须高于模型时间的上界 ${modelTime}`);
  assert.ok(REPLY_TIMEOUT_MS > 60_000, '旧的 60s 上界不够，这里钉住它不会退回去');
});

// ---------------------------------------------------------------------------------------------
// The boundary, stated as a type and as a roster.
// ---------------------------------------------------------------------------------------------

test('Language 的 requires 恰好是冻结的那两个，provides 为空', () => {
  assert.equal(languagePlugin.id, 'language');
  assert.equal(languagePlugin.version, '1.0.0');

  // A structural fact, and the reason it is asserted by contract rather than described in prose: the
  // Runtime has no optional requirement, so a third entry here would be a contract nobody provides and
  // the plugin would stay `waiting` — which, as a member of the default composition, is a resident that
  // does not start. `peek` specifically, for the reason the observation plugin gives: a question a human
  // asks must not become the next comparison partner of the timeline they are asking about.
  assert.deepEqual(languagePlugin.requires, [
    workFocusCurrentService,
    desktopSessionAwarenessPeekService,
  ]);
  assert.deepEqual(languagePlugin.provides, []);

  const keys = languagePlugin.requires.map((contract) => `${contract.id}@${contract.version}`);
  assert.deepEqual(keys, ['work-focus.current@1', 'desktop-session-awareness.peek@1']);
});

test('Language 不依赖 Repository CI，因此 CI 缺席时它不会失败', () => {
  const keys = languagePlugin.requires.map((contract) => `${contract.id}@${contract.version}`);

  for (const key of keys) {
    assert.ok(!key.includes('repository-ci'), `${key} 不该来自 Repository CI`);
    assert.ok(!key.startsWith('git-'), `${key} 不该来自 Git`);
    assert.ok(!key.startsWith('github'), `${key} 不该来自 GitHub`);
  }
  assert.ok(!keys.includes('desktop-session-awareness.current@1'));
});

test('reasoningEffort 是一个闭集，插件在配置处拒绝别的值', () => {
  const base = {
    rootDir: `C:${'\\'}hikari-language-config`,
    endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
    model: 'test-model',
    credentialEnv: undefined,
  };

  // Omitted stays omitted. That is a value in its own right rather than a default being filled in: an
  // unconfigured connection sends no such field, which is what keeps every other OpenAI-compatible
  // endpoint on exactly the request it was already getting.
  assert.equal(languagePlugin.config.parse(base).reasoningEffort, undefined);

  // Both members travel untouched, and `high` is here for the same reason `none` is: it is a value the
  // product asks for, and the effort is the operator's sentence rather than anything this plugin derives
  // from the endpoint. Nothing about where the request is going changes which of them is accepted.
  for (const good of ['none', 'high']) {
    assert.equal(
      languagePlugin.config.parse({ ...base, reasoningEffort: good }).reasoningEffort,
      good,
      `${good} 应被接受并原样保留`,
    );
  }

  // Everything else is refused here rather than forwarded to the endpoint. Both ways of forwarding it
  // fail quietly: an endpoint that does not recognise the value may reject the whole request, and this
  // transport deliberately never reads an error body, so the operator would see a status code with no
  // reason; or it may ignore the value and answer normally, which is a request that did not say what
  // the operator believes it said. Neither is something they can act on from the far end.
  //
  // `low` and `max` are in this list on purpose: they are values the experiments ran through, and being
  // measured is not the same as being supported. A member arrives here when the product asks for it, not
  // because a harness once sent it.
  for (const bad of ['low', 'max', 'medium', 'None', 'HIGH', '', 0, null]) {
    assert.throws(
      () => languagePlugin.config.parse({ ...base, reasoningEffort: bad }),
      new RegExp(`reasoningEffort 只能是 ${Object.keys(REASONING_EFFORTS).join(' / ')}`),
      `${JSON.stringify(bad)} 不应被接受`,
    );
  }

  // The refusal names the members it got from the owner's table rather than from a sentence somebody
  // typed beside the check. Asserted through the table so the two cannot drift: the compile-time half of
  // this — a member added to the union does not build until it is added to the table — cannot be a test,
  // and this is the runtime half it leaves.
  for (const member of Object.keys(REASONING_EFFORTS)) {
    assert.throws(
      () => languagePlugin.config.parse({ ...base, reasoningEffort: 'definitely-not-a-member' }),
      new RegExp(member),
      `拒绝的话里应列出 ${member}`,
    );
  }
});

test('Language 允许的 exposure 就是两个 owner 自己的导出，不是复制来的字符串', () => {
  assert.equal(LANGUAGE_EXPOSURES.length, 2);
  assert.equal(LANGUAGE_EXPOSURES[0], workFocusReadExposure);
  assert.equal(LANGUAGE_EXPOSURES[1], desktopContextReadExposure);
  assert.deepEqual(
    LANGUAGE_EXPOSURES.map((exposure) => exposure.name),
    [WORK, DESKTOP],
  );
});

test('每个 exposure 都指向 Language 已经持有契约的既有 Service', () => {
  // There is no second table and no lookup by name, so the two cannot drift — the exposure carries the
  // contract object itself rather than its id, and `read.ts` dispatches on that object.
  const required = languagePlugin.requires ?? [];
  for (const exposure of LANGUAGE_EXPOSURES) {
    assert.ok(
      required.includes(exposure.service),
      `${exposure.name} 指向的 ${exposure.service.id} 必须在 Language 的 requires 里`,
    );
  }

  assert.equal(LANGUAGE_EXPOSURES[0].service, workFocusCurrentService);
  assert.equal(LANGUAGE_EXPOSURES[1].service, desktopSessionAwarenessPeekService);
  assert.notEqual(LANGUAGE_EXPOSURES[1].service, desktopSessionAwarenessService);
});

test('旧的固定 topic 词表已经退役，剩下的闭集只有 exposure 一个', () => {
  // The slice replaced fixed-topic routing rather than sitting beside it. What would be a double router
  // is a second closed set a model could be asked to choose from, so the check is that no such set
  // survives — not that a particular file is gone, which would be a check about tidiness rather than
  // about behaviour.
  const names = LANGUAGE_EXPOSURES.map((exposure) => exposure.name);
  for (const retired of ['work-focus', 'desktop-state', 'desktop-change', 'current-context']) {
    assert.ok(!names.includes(retired), `${retired} 不该作为模型可选的名字存在`);
  }
  // And nothing in the closed set is a topic this surface invented: every entry is an owner's export,
  // which the identity test above pins by reference.
  assert.equal(LANGUAGE_EXPOSURES.length, 2);
});

// ---------------------------------------------------------------------------------------------
// The wire. Windows only, and deliberately in the same file as everything above.
// ---------------------------------------------------------------------------------------------

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

/** A model whose steps are written down in advance, for the tests that go through a real pipe. */
function scriptedModel(script) {
  let index = 0;
  const requests = [];
  return {
    async step(request) {
      requests.push({ messages: request.messages.map((message) => ({ ...message })) });
      const next = script[index];
      index += 1;
      if (next === undefined) throw new Error('模型脚本用完了，loop 却还在请求下一步');
      return next;
    },
    dispose() {},
    // Recorded for the same reason the harness records them: "the follow-up carried the previous
    // turn's reads" is a claim about what left the process, and over a pipe that is the only place it
    // can be observed at all.
    requests,
  };
}

async function compose(t, { script = [says('在的。')], focus, assessment } = {}) {
  const root = createRoot(t);
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  const connections = [];
  const models = [];
  const plugin = createLanguagePlugin((connection) => {
    connections.push(connection);
    const model = scriptedModel(script);
    models.push(model);
    return model;
  });

  const designations = focus ?? Object.freeze(['hikari-new']);
  const readings = assessment ?? assessmentFixture();

  assert.equal(
    await runtime.loadPlugin(
      provider(
        'test.focus-provider',
        workFocusCurrentService,
        Object.freeze({ current: async () => designations }),
      ),
    ),
    'active',
  );
  assert.equal(
    await runtime.loadPlugin(
      provider(
        'test.awareness-provider',
        desktopSessionAwarenessPeekService,
        Object.freeze({ peek: async () => readings }),
      ),
    ),
    'active',
  );
  assert.equal(
    await runtime.loadPlugin(plugin, {
      rootDir: root,
      endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
      model: 'test-model',
      credentialEnv: undefined,
    }),
    'active',
    '完整组合应 active',
  );

  return { root, connections, models };
}

function connectRaw(path) {
  return new Promise((settle) => {
    const socket = connect(path, () => settle(socket));
  });
}

/**
 * One `hikari ask`, as a shell would run it: a real process against whatever pipe is listening.
 *
 * Asynchronous rather than `spawnSync`, and not as a style preference. The resident these tests talk to
 * is a Runtime inside this same test process, so a synchronous spawn would block the event loop that
 * accepts the connection — the CLI would wait out its whole reply timeout against a pipe nobody was
 * left to answer.
 */
function runCli(...args) {
  return new Promise((settle, fail) => {
    const child = spawn(process.execPath, [CLI, ...args]);
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
    child.on('error', fail);
    child.on('close', (code) => settle({ code, stdout, stderr }));
  });
}

function readOnce(socket) {
  return new Promise((settle) => {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      socket.destroy();
      settle(buffer.slice(0, newline));
    });
  });
}

test('一次提问经过真实管道得到 grounded 回答，且与 renderAssessment 一致', { skip: NO_PIPES }, async (t) => {
  const assessment = assessmentFixture();
  const { root } = await compose(t, {
    script: [callsTo(toolCall('a', DESKTOP)), DONE],
    assessment,
  });

  const answer = await requestLanguageAsk(root, '光，你现在看到什么？');

  assert.equal(answer.kind, 'replied');
  assert.equal(answer.reply.outcome, 'answered');
  assert.deepEqual(answer.reply.lines, renderAssessment(assessment));
});

test('一次闲聊经过真实管道回来的是 chatted', { skip: NO_PIPES }, async (t) => {
  const { root } = await compose(t, { script: [says('在的，有什么想问的？')] });

  const answer = await requestLanguageAsk(root, 'ayobro');

  assert.equal(answer.kind, 'replied');
  assert.equal(answer.reply.outcome, 'chatted');
  assert.deepEqual(answer.reply.lines, ['在的，有什么想问的？']);
});

test('同一个激活里的两次提问共享那一轮的 referent', { skip: NO_PIPES }, async (t) => {
  const { root, connections, models } = await compose(t, {
    script: [callsTo(toolCall('a', WORK)), DONE, callsTo(toolCall('b', WORK)), DONE],
  });

  const first = await requestLanguageAsk(root, '我现在关注什么？');
  assert.equal(first.reply.outcome, 'answered');

  // A second `hikari ask` is a second process and shares nothing with the first; the referent that
  // reaches this request is the resident activation's, which is the whole reason it exists.
  const second = await requestLanguageAsk(root, '那现在呢？');
  assert.equal(second.reply.outcome, 'answered');

  assert.equal(connections.length, 1, '同一个激活只有一个模型连接');
  // `WORK` reaches a system message by exactly one road — the referent paragraph — so finding it in the
  // second question's prompt is the shared turn, observed where it left the process.
  assert.ok(
    models[0].requests[2].messages[0].content.includes(WORK),
    '第二次提问的提示词应带上第一次读到的 capability',
  );
});

test('模型不可达时，管道里回来的是 failed 而不是 refused', { skip: NO_PIPES }, async (t) => {
  const { root } = await compose(t, { script: [] });

  const answer = await requestLanguageAsk(root, '你现在看到什么？');

  assert.equal(answer.kind, 'replied');
  assert.equal(answer.reply.outcome, 'failed');
});

test('说不通这个协议的一行，得到的是 failed', { skip: NO_PIPES }, async (t) => {
  const { root } = await compose(t);
  const path = languageEndpointPath(root);
  assert.notEqual(path, undefined);

  const socket = await connectRaw(path);
  socket.write('{这一行不是这个协议\n');

  const decoded = decodeLanguageReply(await readOnce(socket));
  assert.equal(decoded.kind, 'reply');
  assert.equal(decoded.reply.outcome, 'failed');
});

test('hikari ask 的退出码跟着 outcome 走：chatted 是 0，refused 是 1', { skip: NO_PIPES }, async (t) => {
  // The whole chain with only the model scripted: real runtime, real named pipe, and a real `hikari ask`
  // process whose exit code a shell would read. `ask-command.ts` is the one place in this slice where a
  // plugin's vocabulary becomes a process's exit status, and the mapping changed here — `chatted` used
  // to map the way `refused` does. Checking it where a shell sees it, rather than by reading the mapping
  // back out of the source, is what makes a silent return to the old behaviour fail something.
  const { root } = await compose(t, { script: [says('在的。')] });

  const chat = await runCli('ask', '--data-dir', root, 'ayobro');
  assert.equal(chat.code, 0, 'chatted 是一次成功的回答，不是一次失败');
  assert.equal(chat.stderr, '');
  assert.deepEqual(chat.stdout.split('\n').slice(0, -1), ['在的。']);

  const { root: refusingRoot } = await compose(t, { script: [says('')] });

  const refused = await runCli('ask', '--data-dir', refusingRoot, '嗯');
  assert.equal(refused.code, 1);
  assert.equal(refused.stdout, '', 'refused 的话不上 stdout，脚本不能把它当成一句回答');
  assert.ok(refused.stderr.length > 0, 'refused 的理由要有人看得到');
});

test('没有常驻时，提问得到的是 absent，而不是一个编出来的答案', { skip: NO_PIPES }, async (t) => {
  const root = createRoot(t);

  const answer = await requestLanguageAsk(root, '你现在看到什么？');

  assert.equal(answer.kind, 'absent');
  const lines = askFailureLines(answer).join('\n');
  assert.ok(lines.includes('没有正在提供语言入口'));
  assert.ok(lines.includes('--model-endpoint'), '应说明语言入口的加载条件');
});

test('凭据只以变量名的形式出现在状态里，值本身不出现', { skip: NO_PIPES }, async () => {
  const canary = 'hikari-language-canary-not-a-real-secret';
  const { residentCommand } = await import('../dist/cli/resident.js');
  const { USAGE } = await import('../dist/cli/options.js');

  process.env.HIKARI_LANGUAGE_TEST_SECRET = canary;
  try {
    let host;
    await residentCommand(
      {
        dataDir: join(tmpdir(), 'hikari-language-status'),
        desktopAwarenessDelayMs: 1000,
        model: {
          endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
          model: 'test-model',
          credentialEnv: 'HIKARI_LANGUAGE_TEST_SECRET',
        },
      },
      {
        runtime: {
          getPluginState: () => undefined,
          getPluginError: () => undefined,
          async shutdown() {},
        },
        composition: [],
        io: { out: () => {}, err: () => {} },
        createLease: () => ({ isHolding: () => true, release() {} }),
        listenControl: async (controlHost, path) => {
          host = controlHost;
          return { path, async close() {} };
        },
      },
    );

    const status = host.status().join('\n');
    assert.ok(status.includes('HIKARI_LANGUAGE_TEST_SECRET'));
    assert.ok(!status.includes(canary));
    assert.ok(!USAGE.includes(canary));
  } finally {
    delete process.env.HIKARI_LANGUAGE_TEST_SECRET;
  }
});

test('没有配置模型时，状态行说明语言插件未加载', { skip: NO_PIPES }, async () => {
  const { residentCommand } = await import('../dist/cli/resident.js');

  let host;
  await residentCommand(
    { dataDir: join(tmpdir(), 'hikari-language-unconfigured'), desktopAwarenessDelayMs: 1000 },
    {
      runtime: {
        getPluginState: () => undefined,
        getPluginError: () => undefined,
        async shutdown() {},
      },
      composition: [],
      io: { out: () => {}, err: () => {} },
      createLease: () => ({ isHolding: () => true, release() {} }),
      listenControl: async (controlHost, path) => {
        host = controlHost;
        return { path, async close() {} };
      },
    },
  );

  const status = host.status().join('\n');
  assert.ok(status.includes('语言插件未加载'), '应说明语言插件没有加载');
  assert.ok(status.includes('--model-endpoint') && status.includes('--model'));
  assert.ok(!status.includes('http'), '未配置时不得指向任何端点');
});

test('状态行里的端点、模型与变量名各占一行，值里的控制字符被转义', { skip: NO_PIPES }, async () => {
  const { residentCommand } = await import('../dist/cli/resident.js');
  const LF = String.fromCharCode(0x0a);
  const FORGERY = '判词：stable';

  let host;
  await residentCommand(
    {
      dataDir: join(tmpdir(), 'hikari-language-status-escaping'),
      desktopAwarenessDelayMs: 1000,
      model: {
        endpoint: `http://127.0.0.1:9/v1${LF}${FORGERY}`,
        model: `m${ESC}[2J${ESC}[H模型：pwned`,
        credentialEnv: `HIKARI${LF}语言插件凭据：来自环境变量 ATTACKER`,
        reasoningEffort: `none${LF}${FORGERY}`,
      },
    },
    {
      runtime: {
        getPluginState: () => undefined,
        getPluginError: () => undefined,
        async shutdown() {},
      },
      composition: [],
      io: { out: () => {}, err: () => {} },
      createLease: () => ({ isHolding: () => true, release() {} }),
      listenControl: async (controlHost, path) => {
        host = controlHost;
        return { path, async close() {} };
      },
    },
  );

  const lines = host.status();
  const status = lines.join('\n');

  assert.equal(lines.filter((line) => line.startsWith('语言插件')).length, 4);
  assert.ok(!lines.includes(FORGERY), '值里的换行不得另起一行');
  assert.ok(!lines.some((line) => line.includes(LF) || line.includes(ESC)), '一行里不得留裸控制字符');
  assert.ok(status.includes('\\n'), '换行应写成它的码点');
  assert.ok(status.includes('\\u001b'), 'ESC 应写成它的码点');
  assert.ok(status.includes(FORGERY) && status.includes('模型：pwned'), '文本本身不被删掉');
});
