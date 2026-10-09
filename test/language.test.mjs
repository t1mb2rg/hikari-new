import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';

import {
  chroniclePlugin,
  chronicleService,
  initializeChronicle,
  openChronicle,
  resolveChroniclePath,
} from '../dist/chronicle/index.js';
import { confirmCommand } from '../dist/cli/confirm-command.js';
import {
  READ_AND_FRAMING_BUDGET_MS,
  REPLY_TIMEOUT_MS,
  languageFailureLines,
  requestLanguage,
} from '../dist/cli/language.js';
// The terminal's own measure rather than a second counter, because the claim being asserted is about what
// a terminal shows: a counter that disagreed with `clip` would pass here while a human still lost the
// sentence. The TUI is not this module's dependency — this is a test reaching for the shipped ruler.
import { displayWidth } from '../dist/cli/tui-render.js';
import { continuityPlugin, initializeHikari } from '../dist/continuity/index.js';
import {
  desktopContextReadExposure,
  desktopSessionAwarenessPeekService,
  desktopSessionAwarenessService,
} from '../dist/desktop-session-awareness/index.js';
import { renderAssessment } from '../dist/desktop-session-observe/index.js';
import { Runtime } from '../dist/index.js';
import {
  confirmFailureLines,
  emptyStatementLines,
  longStatementLines,
  recordedLines,
  renderFocus,
  renderSpokenOccurrence,
  renderSynthesis,
} from '../dist/language/express.js';
import {
  LANGUAGE_EXPOSURES,
  LANGUAGE_REPOSITORY_EXPOSURES,
  MAX_LANGUAGE_TEXT_LENGTH,
  LANGUAGE_PROTOCOL_VERSION,
  confirmDecision,
  createAnswerer,
  createDecisionContinuity,
  createLanguagePlugin,
  createRepositoryLanguagePlugin,
  decodeLanguageReply,
  decodeLanguageRequest,
  decisionFactDraft,
  findExposure,
  languageDesktopReturnSpeakingService,
  languageEndpointPath,
  languagePlugin,
  languageRequestHandler,
  languageSpeakingService,
  readArguments,
  readConfirmedDecisions,
  repositoryLanguagePlugin,
  selectConfirmedDecisions,
  toModelTools,
} from '../dist/language/index.js';
import { MODEL_TIMEOUT_MS, REASONING_EFFORTS } from '../dist/language/model.js';
// Imported by path rather than through the barrel, like the two readers below: these are the objects the
// factories wire, not package surface. Their being reachable from here is the point — see `VARIANTS`.
import { baseLanguageVariant, repositoryLanguageVariant } from '../dist/language/plugin.js';
import { createExposureReader, createRepositoryExposureReader } from '../dist/language/read.js';
import { repositoryCiAwarenessService } from '../dist/repository-ci-awareness/index.js';
// The occurrence's own renderer, imported by its public entry point because that is where the module says
// its two pure functions belong — a rule pinned only where the pipes are is a rule CI does not check.
import { renderOccurrence } from '../dist/repository-ci-attention/index.js';
import {
  judgeRelevance,
  renderJudgement,
  repositoryCiRelevancePlugin,
  repositoryCiRelevanceReadExposure,
  repositoryCiRelevanceService,
} from '../dist/repository-ci-relevance/index.js';
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
const RELEVANCE = 'repository_ci_relevance_read';

/** Both exposure lists this build can offer, in one place, because several tests below are about the
 * relation between them rather than about either one. A test that named only one would pass while the
 * other drifted. */
const EVERY_EXPOSURE_LIST = [LANGUAGE_EXPOSURES, LANGUAGE_REPOSITORY_EXPOSURES];

/** The plugin's own source directory, scanned as text by the forbidden-mechanism test below. */
const LANGUAGE_SOURCE = join(import.meta.dirname, '..', 'src', 'language');

/**
 * The two variants, each as the pair that has to agree: what it requires and what it offers.
 *
 * `requires` and `exposures` are two statements that can drift apart — a variant offering a capability
 * whose Service it never declared is a plugin that stays `waiting` for a contract nobody named — and the
 * only way to check the relation rather than each half is to walk the pairs together.
 *
 * The objects the factories hand `buildLanguagePlugin`, rather than a pairing written down here. A pairing
 * written here would agree with itself: it would say the base plugin offers `LANGUAGE_EXPOSURES` because
 * that is what this file wrote, not because that is what the plugin does, and a factory wired to the other
 * list would pass every assertion below. These are reachable from `ubuntu-latest` — where the platform gate
 * inside `setup` refuses before the answerer is built — because they are the wiring rather than the
 * activation, which is the whole of the reason `plugin.ts` names them.
 */
const VARIANTS = [baseLanguageVariant, repositoryLanguageVariant];

/** The same two variants as the flag the test harness selects one with, for the tests that drive it. */
const VARIANT_FLAGS = [
  [false, LANGUAGE_EXPOSURES],
  [true, LANGUAGE_REPOSITORY_EXPOSURES],
];

/**
 * The longest exposure list this build can hand a model, which is what `cli/ask.ts` sizes its reply
 * bound against.
 *
 * Computed over the lists rather than named, because the claim "the client's wait clears what the loop
 * can spend" is about the *longest* variant: a test that hard-coded `LANGUAGE_REPOSITORY_EXPOSURES` would
 * keep passing the day a longer list joined it without the client being resized, which is precisely the
 * timeout-with-the-answer-in-flight bug the bound exists to prevent.
 *
 * The hole a computed maximum leaves — a third list joining the build and not this array — is closed
 * separately rather than by this comment: `exposure.ts 只导出这两个列表` walks the package's own exports
 * and asserts that the lists it finds are exactly these two, so a new one fails there.
 */
const LONGEST_EXPOSURES = EVERY_EXPOSURE_LIST.reduce((longest, list) =>
  list.length > longest.length ? list : longest,
);

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
          observedTick: 12345,
        },
      },
    },
  };
}

/**
 * A judgement in the `relevant` arm, which is the arm that carries a value.
 *
 * The `relevant` arm rather than the bare `unknown` one because it is the arm an `unknown` fixture could
 * not stand in for: the judgement is a union whose point is that `relevant` cannot be reported without the
 * designation that matched, so a fixture that skipped the designation would be testing a value this
 * contract cannot produce. Written to the type's own shape for the reason `assessmentFixture` gives.
 */
const RELEVANT = Object.freeze({ verdict: 'relevant', designation: 'hikari-new' });

/** The other arm of the same union: a finished judgement with no equality behind it. */
const UNKNOWN_JUDGEMENT = Object.freeze({ verdict: 'unknown' });

/**
 * A judgement whose designation carries a line break, which is the one input the reader has work to do
 * on. Named here rather than written twice, because two tests make claims about the same transformation
 * and a second copy of the string would let them drift apart while both stayed green.
 */
const HOSTILE_JUDGEMENT = Object.freeze({
  verdict: 'relevant',
  designation: 'hikari-new\nRepository CI relevance：unknown',
});

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
 * `read` is the *real* reader, wired to instrumented dependencies rather than replaced with a stub.
 * That matters: the claims about which Service a capability reaches, and about a model being shown the
 * same lines a human is, are claims about that code, and a harness that stubbed it out would be testing
 * this file's idea of the wiring instead of the wiring.
 *
 * `repository` selects the variant rather than adding a fixture to the base one. With it the harness
 * builds `createRepositoryExposureReader` and hands the answerer `LANGUAGE_REPOSITORY_EXPOSURES`, which
 * is exactly the pair `createRepositoryLanguagePlugin` wires at activation; without it both are the base
 * variant's, which is what `createLanguagePlugin` wires. There is no third combination, because there
 * is no third variant — the same reason the two factories are two and not a flag.
 */
function harness({
  script = [],
  throws,
  focus = ['hikari-new'],
  assessment = assessmentFixture(),
  at = NOW,
  readThrows,
  repository = false,
  judgement = RELEVANT,
  relevanceThrows,
  decisions = [],
} = {}) {
  const requests = [];
  const serviceReads = { focus: 0, peek: 0, relevance: 0 };
  const performed = [];
  let clock = at;
  let index = 0;

  const base = {
    async readFocus() {
      serviceReads.focus += 1;
      return Object.freeze([...focus]);
    },
    async peek() {
      serviceReads.peek += 1;
      if (readThrows !== undefined) throw readThrows;
      return assessment;
    },
  };

  const reader = repository
    ? createRepositoryExposureReader({
        ...base,
        async readRelevance() {
          serviceReads.relevance += 1;
          if (relevanceThrows !== undefined) throw relevanceThrows;
          return judgement;
        },
      })
    : createExposureReader(base);

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
    // Handed in rather than imported by `answer.ts`, so that "the variant decides what a model is
    // offered" is checkable by choosing a variant here. The two values are the two exported literals and
    // not copies of them: a test that wrote its own list would agree with itself and prove nothing.
    exposures: repository ? LANGUAGE_REPOSITORY_EXPOSURES : LANGUAGE_EXPOSURES,
    // The live list, not a copy of it. `answer.ts` reads this on every turn so that a confirmation
    // written mid-activation is visible to the next question without a restart, and a harness that
    // handed over a snapshot would make that behavior untestable — and would silently agree with the
    // wrong implementation. Pushing onto `decisions` after construction is how a test writes one down.
    decisions: () => decisions,
  });

  return {
    answerer,
    requests,
    serviceReads,
    performed,
    decisions,
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
  // Both lists, because "the wire list is the owner's list, mechanically" is a claim about the function
  // rather than about the base variant, and the repository list is the one whose third entry came from a
  // different package. A `toModelTools` that special-cased or re-derived anything would have to do it
  // twice to pass this, which is the point.
  for (const exposures of [LANGUAGE_EXPOSURES, LANGUAGE_REPOSITORY_EXPOSURES]) {
    const tools = toModelTools(exposures);

    assert.equal(tools.length, exposures.length);
    assert.deepEqual(
      tools.map((tool) => tool.function.name),
      exposures.map((exposure) => exposure.name),
    );
    // Identity rather than equality: a description that matched by coincidence would still be a second
    // copy of it, and would still be the copy that goes stale. The owner's words are passed through by
    // reference, so there is no place for Language to have written its own.
    for (const [index, tool] of tools.entries()) {
      assert.equal(tool.function.description, exposures[index].description);
    }
    assert.deepEqual(tools[0].function.parameters, {
      type: 'object',
      properties: {},
      additionalProperties: false,
    });
  }
});

test('每个 exposure 的名字都是 provider 接受的 function.name 形状', () => {
  // Not a style rule and not this repository's idea of tidy. OpenAI-compatible function calling accepts
  // `^[a-zA-Z0-9_-]+$` as `tools[*].function.name` and rejects the *entire request* with a 400
  // otherwise, so a dotted name does not read as "no model picked this capability" — it reads as a
  // request that never reached a model, and the caller waits out the client's whole reply timeout for an
  // answer nobody was asked to give. The names belong to the owners, so the constraint is asserted against the
  // list they actually exported; the next owner to reach for a dot learns it here rather than from a
  // provider error at the far end of the wire.
  const functionName = /^[a-zA-Z0-9_-]+$/;

  for (const exposures of [LANGUAGE_EXPOSURES, LANGUAGE_REPOSITORY_EXPOSURES]) {
    for (const exposure of exposures) {
      assert.match(exposure.name, functionName, `${exposure.name} 不是一个合法的 function.name`);
    }
  }
});

test('findExposure 只在当前字面 exposure 集合里查，模型字符串永远不是 Service key', () => {
  assert.equal(findExposure(WORK, LANGUAGE_EXPOSURES), workFocusReadExposure);
  assert.equal(findExposure(DESKTOP, LANGUAGE_EXPOSURES), desktopContextReadExposure);
  assert.equal(findExposure(RELEVANCE, LANGUAGE_REPOSITORY_EXPOSURES), repositoryCiRelevanceReadExposure);
  // The repository capability is not reachable from the base list, and that is a fact about the lists
  // rather than about the lookup: a base variant handed the string still resolves to nothing, because
  // the set it searches is the one its own variant was built with.
  assert.equal(findExposure(RELEVANCE, LANGUAGE_EXPOSURES), undefined);

  for (const name of ['work-focus', 'desktop-state', 'desktop-session-awareness.peek', 'read', '__proto__', 'toString']) {
    for (const exposures of [LANGUAGE_EXPOSURES, LANGUAGE_REPOSITORY_EXPOSURES]) {
      assert.equal(findExposure(name, exposures), undefined, `${name} 不该被解析成任何 exposure`);
    }
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

test('拒绝语告诉人类它能读哪些能力，而那份清单同样是 variant 的事实', async () => {
  // `unclassifiedLines` has two call sites and they are the same threading, so a test that pinned one
  // would leave the other free to be handed the wrong list while everything stayed green. Both ways in
  // are checked here: a batch naming a capability this build does not perform, and a first turn with
  // nothing in it at all.
  const triggers = {
    未知能力: () => callsTo(toolCall('c1', 'chronicle.write')),
    第一轮什么都没有: () => says(''),
  };

  for (const [label, trigger] of Object.entries(triggers)) {
    for (const exposures of [LANGUAGE_EXPOSURES, LANGUAGE_REPOSITORY_EXPOSURES]) {
      const repository = exposures === LANGUAGE_REPOSITORY_EXPOSURES;
      const variant = repository ? 'repository' : 'base';
      const h = harness({ repository, script: [trigger()] });

      const reply = await h.answerer.answer('帮我把这个记下来');
      assert.equal(reply.outcome, 'refused', `${label} / ${variant} 应得到 refused`);

      // Read against the variant's own exported list, never a copy written here: a test that spelled the
      // descriptions out again would agree with itself and prove nothing about which list was passed.
      assert.deepEqual(
        reply.lines.slice(-exposures.length),
        exposures.map((exposure) => `  ${exposure.description}`),
        `${label} / ${variant}：拒绝语列出的应当就是这一 variant 的那一份清单`,
      );

      // The direction that can actually differ: a resident without a repository scope must not be told
      // about a capability it does not have, because that is the same untruth as listing nothing.
      const absent = repository
        ? LANGUAGE_EXPOSURES.filter((exposure) => !LANGUAGE_REPOSITORY_EXPOSURES.includes(exposure))
        : LANGUAGE_REPOSITORY_EXPOSURES.filter((exposure) => !LANGUAGE_EXPOSURES.includes(exposure));
      const body = reply.lines.join('\n');
      for (const exposure of absent) {
        assert.ok(
          !body.includes(exposure.description),
          `${label} / ${variant}：拒绝语不得提到这一 variant 没有的 ${exposure.name}`,
        );
      }
    }
  }
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

test('模型调用的上界是 exposure 集合的大小推出来的，不是魔数', async () => {
  // A model that never stops asking for one more step, holding a step the loop must not reach. Every
  // capability is read by the end of the first pass, so the call after that has nothing left to consume
  // and is the last — and the script entry following it is what tells a loop that counted steps instead
  // of applying that invariant apart from this one. Such a loop would take that step, the harness would
  // throw on the next, and the request count asserted below would be wrong.
  //
  // Run over both variants because the ceiling is "this variant's list, plus one" rather than a number.
  // A loop whose bound was written for the base list would be right for one resident and wrong for the
  // other, and the repository variant — the longer list — is the one a fixed bound gets wrong.
  for (const [repository, exposures] of VARIANT_FLAGS) {
    const h = harness({
      repository,
      script: [
        ...exposures.map((exposure, index) => callsTo(toolCall(`read-${index}`, exposure.name))),
        // A duplicate: it consumes nothing new, which is why the loop ends here rather than continuing.
        callsTo(toolCall('again', exposures[0].name)),
        DONE,
      ],
    });

    const reply = await h.answerer.answer('我现在在干嘛？');

    assert.equal(reply.outcome, 'answered');
    assert.deepEqual(
      h.performed,
      exposures.map((exposure) => exposure.name),
      '每个 capability 各读一次',
    );
    assert.equal(h.requests.length, exposures.length + 1);
    assert.equal(h.serviceReads.focus + h.serviceReads.peek + h.serviceReads.relevance, exposures.length);
  }
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
    // The base variant's list, which is what is on offer here: this test is about the transport dying
    // mid-loop rather than about which capabilities exist, so the shorter list keeps the failing step the
    // only thing it depends on.
    exposures: LANGUAGE_EXPOSURES,
    // Empty, because this test is about the transport dying and not about what the person said
    // beforehand. The record is a dependency for the same reason the exposure list is: the loop is one
    // loop with one signature, and a variant of it that took no record would be a second loop.
    decisions: () => [],
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
    exposures: LANGUAGE_EXPOSURES,
    decisions: () => [],
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
  // was never answered. The number is derived rather than asserted, so adding a capability that a model
  // reads on its own breaks this test instead of timing a human out.
  //
  // Derived from the *longest* list this build can offer, which is the change this slice made. The client
  // cannot see which variant is on the other end of the pipe — nothing on the wire says — so it has to be
  // sized for the worst composition it could be talking to, and the repository-aware variant is now that
  // composition. Sizing for the base list would be correct for exactly the residents that need it least.
  const maxModelCalls = LONGEST_EXPOSURES.length + 1;
  const modelTime = maxModelCalls * MODEL_TIMEOUT_MS;

  assert.ok(REPLY_TIMEOUT_MS > modelTime, `客户端上界 ${REPLY_TIMEOUT_MS} 必须高于模型时间的上界 ${modelTime}`);
  assert.ok(REPLY_TIMEOUT_MS > 60_000, '旧的 60s 上界不够，这里钉住它不会退回去');

  // And the model calls are not the whole of it. An interaction may read twice — the desktop and the
  // relevance judgement — and each acquisition reaches two sources that are each bounded at 10s. Those
  // two sources run in parallel, so summing them over-states the read; this asserts the bound clears the
  // over-statement rather than the optimistic figure, because a client that is just barely patient enough
  // is one that reports an answer still in flight as an answer that never came.
  //
  const pessimisticReadTime = 2 * 2 * 10_000;
  assert.ok(
    REPLY_TIMEOUT_MS > modelTime + pessimisticReadTime,
    `客户端上界 ${REPLY_TIMEOUT_MS} 必须高于模型 ${modelTime} 加上两次读取的悲观值 ${pessimisticReadTime}`,
  );

  // Both assertions above are floors, and a floor is not what this test is for. A bound sized for the
  // *base* variant's two capabilities clears both of them — `(2 + 1) * 15s + 90s = 135s` is above the
  // `100s` floor — while the repository-aware resident it would then be talking to can legitimately spend
  // longer, which is the timeout-with-the-answer-in-flight bug this bound exists to prevent, arriving one
  // variant later. So the derivation itself is pinned, evaluated against the longest list this build can
  // offer: the list is read from `exposure.ts` and the budget from `ask.ts`, so what is compared is the
  // client's number against two facts it does not own. A derivation replaced by a literal fails here the
  // day a longer list joins the build; a derivation shrunk to the base list fails here today.
  assert.equal(
    REPLY_TIMEOUT_MS,
    (LONGEST_EXPOSURES.length + 1) * MODEL_TIMEOUT_MS + READ_AND_FRAMING_BUDGET_MS,
    `客户端上界 ${REPLY_TIMEOUT_MS} 必须等于按最长 exposure 清单推导的值`,
  );
});

// ---------------------------------------------------------------------------------------------
// The boundary, stated as a type and as a roster.
// ---------------------------------------------------------------------------------------------

test('Language 的 requires 是冻结的那两个读加上 Chronicle，provides 恰好是两个发言入口', () => {
  assert.equal(languagePlugin.id, 'language');
  assert.equal(languagePlugin.version, '1.0.0');

  // A structural fact, and the reason it is asserted by contract rather than described in prose: the
  // Runtime has no optional requirement, so an entry here that nobody provides is a contract that holds
  // the plugin at `waiting` — which, as a member of the default composition, is a resident that does not
  // start. `peek` specifically, for the reason the observation plugin gives: a question a human asks
  // must not become the next comparison partner of the timeline they are asking about.
  //
  // The third entry is not a reading, and it is the reason this list is no longer the variant's list.
  // It is where the statements a person confirmed are kept, and it is required — not optional, and not
  // absent when the deployment has no store — because the mandate's first verification item is that an
  // explicit confirmation is what produces a record, and a Language that could come up without a store
  // would answer that by silently keeping nothing. The Runtime has no third option: a requirement either
  // holds or the plugin waits. It is outside the variant because a variant's difference is what the model
  // may *read*, and this is not something the model reads — `plugin.ts` appends it to the variant's own
  // literal, and the test below asserts that both variants got the same one.
  assert.deepEqual(languagePlugin.requires, [
    workFocusCurrentService,
    desktopSessionAwarenessPeekService,
    chronicleService,
  ]);

  // `provides` was empty until a composition member needed to speak unprompted, and it now holds two.
  // Both are asserted as an exact list rather than a `some(...)`, and the claim the exactness makes has
  // grown rather than loosened: not "it offers speaking", but "it offers exactly the two speaking
  // capabilities two named owners asked for, and nothing else". The Contract Creation Gate admits a
  // capability for an interaction that is already happening, so each entry is one that is; a third would
  // have to be one that is not. Why there are two rather than one — and what was refused instead — is
  // argued in `contracts.ts`. What this test asserts is that the argument did not leak into Language
  // gaining anything else along the way.
  assert.deepEqual(languagePlugin.provides, [
    languageSpeakingService,
    languageDesktopReturnSpeakingService,
  ]);

  const keys = languagePlugin.requires.map((contract) => `${contract.id}@${contract.version}`);
  assert.deepEqual(keys, [
    'work-focus.current@1',
    'desktop-session-awareness.peek@1',
    'chronicle@1',
  ]);

  const provided = languagePlugin.provides.map((c) => `${c.id}@${c.version}`);
  assert.deepEqual(provided, ['language.speaking@1', 'language.desktop-return-speaking@1']);
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

test('每个 exposure 都指向该 variant 自己已经持有契约的既有 Service', () => {
  // There is no second table and no lookup by name, so the two cannot drift — the exposure carries the
  // contract object itself rather than its id, and `read.ts` dispatches on that object.
  //
  // Read as a property of the *pair*, because the repository list's third entry is the one that could
  // point at a Service its own plugin never declared — a capability the model is offered and the Runtime
  // was never asked for, which would fail the first time a model picked it.
  for (const variant of VARIANTS) {
    for (const exposure of variant.exposures) {
      assert.ok(
        variant.requires.includes(exposure.service),
        `${exposure.name} 指向的 ${exposure.service.id} 必须在同一个 variant 的 requires 里`,
      );
    }
  }

  assert.equal(LANGUAGE_EXPOSURES[0].service, workFocusCurrentService);
  assert.equal(LANGUAGE_EXPOSURES[1].service, desktopSessionAwarenessPeekService);
  assert.notEqual(LANGUAGE_EXPOSURES[1].service, desktopSessionAwarenessService);
  assert.equal(LANGUAGE_REPOSITORY_EXPOSURES[2].service, repositoryCiRelevanceService);
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
// Two variants, differing by one independently optional capability.
//
// The whole of the difference is one Service, and every test below is about the fact that it stays one.
// What would make this section unnecessary is a composition-time capability reachability mechanism; what
// would make it a failure is a variant that quietly grew a second difference.
// ---------------------------------------------------------------------------------------------

test('provider 的存在不会让 base Language 自动多出第三个能力', () => {
  // The claim this slice could most easily have broken, and the one a future reader is most likely to
  // assume is broken. `repository-ci-relevance` now provides a Service and exports an exposure, and
  // neither fact is reachable from the base variant: the base plugin is built from a literal that names
  // two exposures, and no code path in `src` appends to it.
  assert.equal(LANGUAGE_EXPOSURES.length, 2);
  // Written as an exclusion rather than as a count, which is what this test is named for and what a count
  // could only ever approximate now that the roster also carries Chronicle. A count would have to be kept
  // in step with a list this test is not about; this says the thing itself — the Service the provider
  // offers is not one the base variant declares, so the base roster did not grow when the provider arrived.
  assert.ok(!languagePlugin.requires.includes(repositoryCiRelevanceService));
  assert.equal(findExposure(RELEVANCE, LANGUAGE_EXPOSURES), undefined);
  for (const exposure of LANGUAGE_EXPOSURES) {
    assert.notEqual(exposure.service, repositoryCiRelevanceService);
  }
  // And the repository capability is a real one, so the assertions above are about a capability that
  // exists rather than about a name nothing defines.
  assert.equal(repositoryCiRelevanceReadExposure.name, RELEVANCE);
});

test('variant 递给答案器的，就是它自己那一份字面清单', () => {
  // The assertion above reads `LANGUAGE_EXPOSURES`; this one reads the plugin, and they are different
  // claims. A base factory wired to the repository list would leave every assertion above green while
  // offering a resident with no repository scope a capability whose Service it never declared — the
  // mismatch `tools.ts` and `read.ts` each have a half of, arriving as a tool the model can pick and a
  // read that then refuses it. This is the half that no list assertion can reach, and it runs on
  // `ubuntu-latest`: it needs the wiring, not the activation.
  assert.equal(baseLanguageVariant.exposures, LANGUAGE_EXPOSURES);
  assert.equal(repositoryLanguageVariant.exposures, LANGUAGE_REPOSITORY_EXPOSURES);

  // Stated as an identity against two lists that are not the same object, so it is a decision this build
  // made rather than the only value it could have had.
  assert.notEqual(LANGUAGE_EXPOSURES, LANGUAGE_REPOSITORY_EXPOSURES);
  assert.equal(repositoryLanguageVariant.exposures.length, LANGUAGE_EXPOSURES.length + 1);
});

test('第三个能力只有 repository variant 读得了，base variant 读不了', async () => {
  // The reader half of the same wiring claim, reached without a pipe for the reason `plugin.ts` gives:
  // `makeReader` is handed the context at activation and everything below the platform gate in `setup` is
  // invisible to CI, so a variant wired to the base reader would be a variant whose third capability is
  // offered and then refused — and the only test that would have noticed was the named-pipe one below.
  const context = {
    services: {
      get(contract) {
        if (contract === workFocusCurrentService) return { current: async () => ['hikari-new'] };
        if (contract === desktopSessionAwarenessPeekService) {
          return { peek: async () => assessmentFixture() };
        }
        if (contract === repositoryCiRelevanceService) return { current: async () => RELEVANT };
        throw new Error(`组合不该被问到 ${contract.id}`);
      },
    },
  };

  const baseRead = baseLanguageVariant.makeReader(context);
  const repositoryRead = repositoryLanguageVariant.makeReader(context);

  // Read first, so that the refusal below is about the third capability rather than about a reader that
  // throws at everything. Both variants read the shared capability and agree about what it says.
  const expectedFocus = renderFocus(['hikari-new']).map(oneLine);
  assert.deepEqual(await baseRead(workFocusReadExposure), expectedFocus);
  assert.deepEqual(await repositoryRead(workFocusReadExposure), expectedFocus);

  // The third capability through the reader the repository variant actually wires: the owner's own
  // rendering, which is the same claim as the byte-for-byte test below, made about the shipped wiring
  // rather than about a reader this file built.
  assert.deepEqual(await repositoryRead(repositoryCiRelevanceReadExposure), renderJudgement(RELEVANT));

  await assert.rejects(
    () => baseRead(repositoryCiRelevanceReadExposure),
    /不是这个构建能读取的服务/,
  );
});

test('repository-aware Language 的 requires 是 base 那两个加上 relevance Service', () => {
  assert.equal(repositoryLanguagePlugin.id, 'language');
  assert.equal(repositoryLanguagePlugin.version, '1.0.0');

  // A structural fact rather than a described one, for the reason the base version of this test gives:
  // the Runtime has no optional requirement, so a variant that named this contract and got a composition
  // without it is a variant that stays `waiting` — fail-closed, and the reason a resident that chose it
  // has to have loaded the provider first.
  assert.deepEqual(repositoryLanguagePlugin.requires, [
    workFocusCurrentService,
    desktopSessionAwarenessPeekService,
    repositoryCiRelevanceService,
    chronicleService,
  ]);
  // The same two, and not variant-specific additions: speaking is not a way of *reading*, so neither
  // belongs on the axis the two variants differ along. A variant that offered one while the other did not
  // would be a cross product between "what this deployment can read" and "whether it can talk", which is
  // the shape `exposure.ts` exists to refuse. The second line is the whole claim in one step — a variant's
  // `provides` is not derived from the base's, and the equality is checked rather than assumed.
  assert.deepEqual(repositoryLanguagePlugin.provides, [
    languageSpeakingService,
    languageDesktopReturnSpeakingService,
  ]);
  assert.deepEqual(repositoryLanguagePlugin.provides, [...languagePlugin.provides]);

  const keys = repositoryLanguagePlugin.requires.map(
    (contract) => `${contract.id}@${contract.version}`,
  );
  assert.deepEqual(keys, [
    'work-focus.current@1',
    'desktop-session-awareness.peek@1',
    'repository-ci-relevance.current@1',
    'chronicle@1',
  ]);

  // The base two come first and in the same order, so "repository-aware is base plus one" is true of the
  // sequence and not merely of the set. This is also the sentence that says `peek` rather than `current`
  // is still what is required — a variant that reached for the advancing contract would be a second,
  // quieter change riding along with the one this slice is about.
  //
  // Read against the variants rather than against the two plugins, because the plugins each carry the
  // shared third requirement at the end and comparing their whole lists would fold two claims into one.
  // What is asserted here is the axis: this variant's own list is the other one's plus exactly one entry.
  assert.deepEqual(repositoryLanguageVariant.requires, [
    ...baseLanguageVariant.requires,
    repositoryCiRelevanceService,
  ]);
  // And the requirement that is not on that axis is the same contract in both plugins. Chronicle is in
  // the roster because it has to be provided, not because either variant differs by it, and this is the
  // one way to say that as a fact about the two objects rather than as a sentence about the code.
  assert.deepEqual(languagePlugin.requires.slice(-1), [chronicleService]);
  assert.deepEqual(repositoryLanguagePlugin.requires.slice(-1), [chronicleService]);
});

test('repository-aware Language 允许的 exposure 是 base 那两个加上 owner 自己的第三个', () => {
  assert.equal(LANGUAGE_REPOSITORY_EXPOSURES.length, 3);
  assert.equal(LANGUAGE_REPOSITORY_EXPOSURES[0], workFocusReadExposure);
  assert.equal(LANGUAGE_REPOSITORY_EXPOSURES[1], desktopContextReadExposure);
  assert.equal(LANGUAGE_REPOSITORY_EXPOSURES[2], repositoryCiRelevanceReadExposure);
  assert.deepEqual(
    LANGUAGE_REPOSITORY_EXPOSURES.map((exposure) => exposure.name),
    [WORK, DESKTOP, RELEVANCE],
  );
  // The first two are the *same objects*, not two entries that read alike, so the reads a model is
  // offered for the focus and the desktop are literally the same values in both variants. Two literals
  // is the approved amount of duplication; two descriptions of the same capability would not be.
  assert.deepEqual(LANGUAGE_REPOSITORY_EXPOSURES.slice(0, 2), [...LANGUAGE_EXPOSURES]);
});

test('两个 exposure 列表都是显式冻结的字面量，不是注册表或发现来的', () => {
  for (const exposures of EVERY_EXPOSURE_LIST) {
    assert.ok(Object.isFrozen(exposures), '列表本身必须是冻结的');
    for (const exposure of exposures) {
      assert.ok(Object.isFrozen(exposure), `${exposure.name} 必须是冻结的`);
      assert.equal(typeof exposure.name, 'string');
      assert.equal(typeof exposure.description, 'string');
      // The description is the owner's statement of what its own capability covers, and it travels to a
      // model untouched. An entry without one would be a capability the model is offered with nothing
      // said about it, which is the one thing the exposure mechanism exists to prevent.
      assert.ok(exposure.description.length > 0, `${exposure.name} 必须带着 owner 自己写的说明`);
    }
  }
  // Fixed means finite and enumerable here: three distinct capabilities across both lists, no fourth, and
  // the base list a strict prefix of the repository one rather than a set that overlaps it partly.
  assert.equal(new Set(EVERY_EXPOSURE_LIST.flat().map((exposure) => exposure.name)).size, 3);
});

test('语言包只导出这两个 exposure 列表', async () => {
  // The hole a computed "longest list" leaves: a third list could join the package and nothing above
  // would notice, because everything above is a statement about the lists that are here. Walked over the
  // module's own exports rather than over a list written here, so the check reads "this is all of them"
  // rather than "these two agree with each other".
  const language = await import('../dist/language/index.js');
  const lists = Object.entries(language)
    .filter(
      ([, value]) =>
        Array.isArray(value) &&
        value.every((entry) => entry !== null && typeof entry === 'object' && 'service' in entry),
    )
    .map(([name]) => name)
    .sort();

  assert.deepEqual(lists, ['LANGUAGE_EXPOSURES', 'LANGUAGE_REPOSITORY_EXPOSURES']);
});

test('语言包没有把不存在的通用机制引进来', () => {
  // The claim `plugin.ts` makes in prose — "not a brain, a planner, an action orchestrator, a tool
  // registry, a capability registry, a global context, memory, a model router or a reasoning service" —
  // checked as a property of the source rather than left as a sentence that could quietly stop being
  // true. The list has to be reachable a second way and it is: a plugin that grew a tool registry would
  // have had to name one.
  //
  // Every entry is a compound identifier, never the bare noun it is built from. That is not style: this
  // module's own comments negate these words in the plain — "no Memory, no Chronicle", "Why this is not
  // Memory" — so a pattern naming the nouns would red on the sentences that deny the thing. What is
  // checked is the identifiers that would have to be introduced, which is the same reason
  // `resident-cli.test.mjs`'s wider scan names `CapabilityRegistry` rather than `Registry`.
  const forbidden =
    /\b(?:ServiceLocator|ServiceRegistry|ToolRegistry|CapabilityRegistry|ExposureRegistry|PluginRegistry|PluginLoader|PluginDiscovery|DynamicPlugin|DynamicDiscovery|OptionalPlugin|CentralJudgement|GlobalBrain|GlobalWorldState|ModelRouter|ReasoningService|MemoryStore|MemoryService|ChronicleWriter|ProfileRegistry|FeatureFlag)\b/;
  const offenders = sourceFiles(LANGUAGE_SOURCE).filter((file) => forbidden.test(readFileSync(file, 'utf8')));

  assert.deepEqual(
    offenders.map((file) => relative(LANGUAGE_SOURCE, file).replaceAll('\\', '/')),
    [],
  );
});

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sourceFiles(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

test('relevance Service 缺席时，repository-aware Language 停在 waiting，不降级启动', async (t) => {
  const root = createRoot(t);
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  const base = {
    rootDir: root,
    endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
    model: 'test-model',
    credentialEnv: undefined,
    reasoningEffort: undefined,
  };

  // Everything the base variant needs arrives, and so does the shared Chronicle, so the only thing
  // unsatisfied is the third. Loading the Chronicle provider is not decoration: without it this plugin
  // would be `waiting` on a requirement that has nothing to do with the claim, and the test would pass
  // for the wrong reason. A plugin that fell back to the base behaviour here would come up `active` and
  // answer the first question about CI by telling the model it has no such capability — a resident that
  // started and then could not do what its composition said it would.
  assert.equal(
    await runtime.loadPlugin(
      provider('test.focus-provider', workFocusCurrentService, Object.freeze({ current: async () => [] })),
    ),
    'active',
  );
  assert.equal(
    await runtime.loadPlugin(
      provider(
        'test.awareness-provider',
        desktopSessionAwarenessPeekService,
        Object.freeze({ peek: async () => assessmentFixture() }),
      ),
    ),
    'active',
  );
  assert.equal(await runtime.loadPlugin(chronicleProvider()), 'active');
  assert.equal(
    await runtime.loadPlugin(
      createRepositoryLanguagePlugin(() => {
        throw new Error('模型工厂不该在 waiting 的插件上被调用');
      }),
      base,
    ),
    'waiting',
  );

  // Everything this test needs runs on a host with no named pipes: a plugin held at `waiting` never
  // reaches `setup`, so the endpoint it would have opened is never asked for. That is why this half is
  // not skipped on CI, and it is the half worth having there — the contrast that proves `waiting` is
  // about the third requirement is the test after this one.
});

test('同一组合里换回 base variant，Language 就 active', { skip: NO_PIPES }, async (t) => {
  // The contrast that makes the `waiting` above a fact about the composition rather than about the
  // plugin being unable to start at all: the base variant, loaded into the very same set of providers,
  // is `active`. Without it the assertion above would also pass if `requires` had grown a contract
  // nothing in this build provides, which is a different bug with the same symptom.
  //
  // Windows-only because activating either variant opens the plugin's endpoint, and `setup` throws on a
  // host without pipes. The `waiting` half needs no pipe for exactly the reason this one does.
  //
  // A second Runtime rather than a second `loadPlugin` on the first: both variants carry the id
  // `language`, because only one of them is ever loaded and a resident's status line should not change
  // with which one it is. The Runtime enforces that by refusing the second load, which is the right
  // refusal and the reason this is two runtimes rather than one.
  const root = createRoot(t);
  const config = {
    rootDir: root,
    endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
    model: 'test-model',
    credentialEnv: undefined,
    reasoningEffort: undefined,
  };

  const alsoBase = new Runtime();
  t.after(() => alsoBase.shutdown());
  assert.equal(
    await alsoBase.loadPlugin(
      provider('test.focus-provider', workFocusCurrentService, Object.freeze({ current: async () => [] })),
    ),
    'active',
  );
  assert.equal(
    await alsoBase.loadPlugin(
      provider(
        'test.awareness-provider',
        desktopSessionAwarenessPeekService,
        Object.freeze({ peek: async () => assessmentFixture() }),
      ),
    ),
    'active',
  );
  assert.equal(await alsoBase.loadPlugin(chronicleProvider()), 'active');
  assert.equal(await alsoBase.loadPlugin(createLanguagePlugin(() => scriptedModel([says('在的。')])), config), 'active');
});

test('relevance Service 只被读一次，Language 不重新算一遍判定', async () => {
  // Two judgements a recomputation would have to reach differently from what it was handed: the focus
  // names a repository the judgement does not, and the assessment reports no repository at all. A reader
  // that judged for itself would answer `unknown` in both cases and would be answering a question that
  // already has an owner — so what comes back has to be the judgement it was given, not a second opinion
  // about the same two sources.
  for (const judgement of [RELEVANT, UNKNOWN_JUDGEMENT]) {
    const h = harness({
      repository: true,
      judgement,
      focus: ['t1mb2rg/hikari-new'],
      script: [callsTo(toolCall('a', RELEVANCE)), DONE],
    });

    const reply = await h.answerer.answer('CI 那边怎么样？');

    assert.equal(reply.outcome, 'answered');
    assert.deepEqual(h.performed, [RELEVANCE]);
    assert.equal(h.serviceReads.relevance, 1, '判定只应被读一次');
    assert.equal(h.serviceReads.focus, 0, '读 relevance 不该顺手读 focus');
    assert.equal(h.serviceReads.peek, 0, '读 relevance 不该顺手读 desktop');
    assert.deepEqual(reply.lines, renderJudgement(judgement));
  }
});

test('repository exposure 的读取结果与 owner 的 renderJudgement 逐字相同', async () => {
  // Byte for byte, and the fixtures are the reason it is checkable: two judgements, one per arm of the
  // union, so the claim covers the arm that carries a designation and the arm that carries nothing. The
  // comparison is against the owner's own function rather than against the strings it happens to return,
  // so a change to what this domain's verdict reads like moves both sides at once and cannot pass by
  // being copied here.
  //
  // Neither fixture needs escaping, and that is what makes "byte for byte" the right description rather
  // than an overstatement: the reader does not reformat a judgement, it hands the owner's lines on. The
  // one transformation it applies is `oneLine`, to a designation a human typed — asserted below rather
  // than left implied, because an identity that held only for well-behaved fixtures would be a claim
  // about the fixtures.
  for (const judgement of [RELEVANT, UNKNOWN_JUDGEMENT]) {
    const read = createRepositoryExposureReader({
      readFocus: async () => {
        throw new Error('读 relevance 不该碰 focus');
      },
      peek: async () => {
        throw new Error('读 relevance 不该碰 desktop');
      },
      readRelevance: async () => judgement,
    });

    assert.deepEqual(await read(repositoryCiRelevanceReadExposure), renderJudgement(judgement));
  }

  // And the transformation itself, stated as what it is: the owner's rendering, made line-safe. The
  // end-to-end test below asserts the same relation through the loop; this one asserts it against the
  // renderer, so a reader that stopped escaping fails in both places rather than only in the one that
  // also has to get a question through a model first.
  const hostileRead = createRepositoryExposureReader({
    readFocus: async () => {
      throw new Error('读 relevance 不该碰 focus');
    },
    peek: async () => {
      throw new Error('读 relevance 不该碰 desktop');
    },
    readRelevance: async () => HOSTILE_JUDGEMENT,
  });

  assert.deepEqual(
    await hostileRead(repositoryCiRelevanceReadExposure),
    renderJudgement(HOSTILE_JUDGEMENT).map(oneLine),
  );
});

test('model 看到的那几行同时就是人类看到的那几行，两者都还是 line-safe 的', async () => {
  // The "one array, two readers" claim, checked on the one branch whose text can contain characters
  // nobody in this repository wrote. A designation is free text a human typed, so a line break in one
  // would otherwise reach the model as two lines — the second shaped exactly like a line Hikari wrote.
  const h = harness({
    repository: true,
    judgement: HOSTILE_JUDGEMENT,
    script: [callsTo(toolCall('a', RELEVANCE)), DONE],
  });

  const reply = await h.answerer.answer('CI 那边怎么样？');

  assert.deepEqual(reply.lines, renderJudgement(HOSTILE_JUDGEMENT).map(oneLine));
  assert.equal(reply.lines.filter((line) => line.startsWith('Repository CI relevance：')).length, 1);
  assert.ok(reply.lines.some((line) => line.includes('\\n')), '换行必须被转义而不是被丢掉');
});

test('主动说出去的那几行，逐字就是被说者的 owner 渲染出来的那几行', () => {
  // This function exists for one reason and it is stated in its own file: the plugin that hands it to
  // the speaking contract can only be activated on Windows, so a rule reachable only through activation
  // is a rule `ubuntu-latest` never checks. That is why `express.ts` exports it and why this test calls
  // it directly rather than going through a resident — without this, changing its body to `return ['ok']`
  // would leave both platforms green while the human's one proactive message became the word "ok".
  //
  // The values are shaped to be text nobody in this repository wrote, which is the only part of an
  // occurrence that can differ between what the owner rendered and what a second renderer would produce.
  // A workflow name and a branch name are GitHub's, and a branch name is whoever pushed the branch's:
  // both can contain a line break, and a line break is the whole attack — the second line would be shaped
  // exactly like one Hikari authored itself. A well-behaved fixture would let this test pass while the
  // escaping it is here to pin was gone.
  const occurrence = {
    repository: 't1mb2rg/hikari-new',
    runId: 412,
    workflow: 'ci\n判词：stable',
    headBranch: `release/${ESC}[31m红色的分支`,
    headSha: 'c0ffee1234567890abcdef1234567890abcdef12',
    conclusion: 'failure',
    observedAt: '2026-03-01T09:00:00.000Z',
  };

  const spoken = renderSpokenOccurrence(occurrence);

  // Against the owner's own function rather than against the strings it happens to return, so that a
  // change to what this domain's occurrence reads like moves both sides at once and cannot pass by having
  // been copied here. `renderAnswer` applies `oneLine` a second time on the way out, which is a no-op on
  // lines that already went through it — hence the second `.map` on the expected side rather than a
  // claim that the two calls are literally the same.
  assert.deepEqual(spoken, renderOccurrence(occurrence).map(oneLine));

  // Stated once as the thing itself rather than as the equality above, because the equality holds for a
  // rendering that dropped the escaping: `renderOccurrence` escapes on its side and `renderAnswer` escapes
  // on its side, so a change that removed one of them would move both arrays together and be invisible.
  // The forged designation is the reason to spell it out — it must survive as text on the branch line,
  // not become a line.
  assert.ok(
    spoken.some((line) => line.includes('\\n')),
    '换行必须被转义而不是被丢掉',
  );
  assert.ok(
    !spoken.some((line) => line === '判词：stable'),
    'occurrence 里的值不得自己成为一行',
  );
  for (const line of spoken) {
    assert.ok(!hasTerminalControl(line), '主动说出去的每一行都不得含控制字符');
  }

  // What this test does not settle, and cannot from here: that `repository-ci-attention` hands *this*
  // function to the speaking contract. That wiring lives behind the Windows platform gate, so it is
  // covered by the Windows-only delivery tests and reported separately from a green CI run.
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

/**
 * A Chronicle that satisfies the contract, holds nothing, and refuses to be written to.
 *
 * Every composition in this file that expects Language to reach `active` needs one, because Language
 * requires `chronicle` and the Runtime has no optional requirement — an absent provider is a Language held
 * at `waiting`, which is the same symptom as a bug and would be indistinguishable from one in the tests
 * above. `read()` returning nothing is both what a fresh store gives and what a failed read degrades to,
 * so a composition built on this stub is also the empty-history case.
 *
 * `append` throws rather than succeeding quietly, and that is the load-bearing half: over a real pipe this
 * stub is the only Chronicle in the process, so a `Language` that wrote on `ask` would fail loudly here
 * instead of passing. The claim "you call tool to read, never to write" is otherwise only a sentence in
 * `plugin.ts`. The confirm tests below need the opposite and build their own recorder.
 */
function emptyChronicle() {
  return Object.freeze({
    async append() {
      throw new Error('这个组合不该被写入 Chronicle');
    },
    async get() {
      return undefined;
    },
    async read() {
      return [];
    },
  });
}

/** The same stub, wired as a provider, which is how every composition below receives it. */
function chronicleProvider() {
  return provider('test.chronicle-provider', chronicleService, emptyChronicle());
}

/** A model whose steps are written down in advance, for the tests that go through a real pipe. */
function scriptedModel(script) {
  let index = 0;
  const requests = [];
  return {
    async step(request) {
      requests.push({
        messages: request.messages.map((message) => ({ ...message })),
        // Recorded for the same reason the offline harness records it, and this is the only place the
        // question can be asked of the real wiring: which capabilities a model is offered is decided by
        // the variant's factory at activation, and `tools` is the whole of what that decision emits.
        tools: request.tools,
      });
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

/**
 * A resident, assembled far enough to answer one question over a real pipe.
 *
 * `repository` chooses the variant the way `cli/resident.ts` does — by loading one factory rather than
 * the other, after the Service its requirements name is already in the composition. The relevance
 * provider here is a test stand-in rather than the real plugin, because what this helper is for is the
 * Language side: whether the real provider activates is that package's own question, and it is asked
 * once below in `relevance provider 可以没有 consumer 而 active`.
 */
async function compose(t, { script = [says('在的。')], focus, assessment, repository = false, judgement = RELEVANT } = {}) {
  const root = createRoot(t);
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  const connections = [];
  const models = [];
  const plugin = (repository ? createRepositoryLanguagePlugin : createLanguagePlugin)((connection) => {
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
  // Loaded before Language in every composition, the way `cli/resident.ts` loads the real one, and for the
  // reason stated there: the Runtime re-checks waiting plugins when a Service appears, so order is not
  // load-bearing for the outcome — this composition just happens to give the plugin what it needs rather
  // than relying on the re-check to reach `active` eventually. `emptyChronicle`'s refusing `append` is what
  // makes these pipe tests double as the "ask writes nothing" check.
  assert.equal(await runtime.loadPlugin(chronicleProvider()), 'active');

  if (repository) {
    assert.equal(
      await runtime.loadPlugin(
        provider(
          'test.relevance-provider',
          repositoryCiRelevanceService,
          Object.freeze({ current: async () => judgement }),
        ),
      ),
      'active',
    );
  }

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

  return { root, connections, models, runtime };
}

/**
 * A plugin that requires one contract and does nothing with it but hand the Service to the test.
 *
 * Stands in for the real consumer, and stands in for it on purpose: what the two tests below are about
 * is the Runtime's treatment of a provider whose consumer may or may not be there, and a probe that only
 * ever asks for the Service is the smallest thing that can be present or absent.
 */
function consumer(pluginId, contract, capture) {
  return {
    id: pluginId,
    version: '1.0.0',
    requires: [contract],
    provides: [],
    setup(context) {
      capture(context.services.get(contract));
    },
  };
}

/** A snapshot in which neither source could be observed: a question that was put and not answerable. */
function unobservableSnapshot() {
  return Object.freeze({
    snapshotAt: SNAPSHOT_AT,
    gitRepository: Object.freeze({ kind: 'unavailable' }),
    githubCi: Object.freeze({ kind: 'unavailable' }),
  });
}

test('relevance provider 可以没有 consumer 而 active，Service 也真的可被调用', { skip: NO_PIPES }, async (t) => {
  // `plugin-design-spec.md` §16.2 asks for a real callable need before a Service exists, and the need is
  // a *variant* rather than a fixture — so the provider must not depend on the consumer being present.
  // A provider that only worked once something consumed it would be a provider deciding its own
  // consumer, which is the direction this architecture refuses.
  const root = createRoot(t);
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  const designations = Object.freeze(['hikari-new']);
  const snapshot = unobservableSnapshot();

  assert.equal(
    await runtime.loadPlugin(
      provider('test.focus-provider', workFocusCurrentService, Object.freeze({ current: async () => designations })),
    ),
    'active',
  );
  assert.equal(
    await runtime.loadPlugin(
      provider(
        'test.awareness-provider',
        repositoryCiAwarenessService,
        Object.freeze({ current: async () => Object.freeze({ snapshot, commitComparison: 'indeterminate' }) }),
      ),
    ),
    'active',
  );

  // No consumer anywhere in this composition, and the provider is fully up.
  assert.equal(await runtime.loadPlugin(repositoryCiRelevancePlugin, { rootDir: root }), 'active');

  // And the Service is not merely declared: a consumer that arrives afterwards gets the same judgement
  // the owner's own function makes of the same two values. `provider` and `exposure` landed together, and
  // this is the half that says the Service is backed by the judgement rather than by a second copy of it.
  let received;
  assert.equal(
    await runtime.loadPlugin(consumer('test.relevance-consumer', repositoryCiRelevanceService, (service) => {
      received = service;
    })),
    'active',
  );

  assert.deepEqual(await received.current(), judgeRelevance(designations, snapshot));
});

test('relevance Service 到达后，repository-aware Language 才 active', { skip: NO_PIPES }, async (t) => {
  // The other half of the fail-closed pair. The test above showed that a missing Service leaves the
  // variant `waiting`; this shows that the same plugin, in the same composition, comes up once the
  // Service is there — so `waiting` was a fact about the composition and not about the plugin being
  // unable to start at all.
  const root = createRoot(t);
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  const config = {
    rootDir: root,
    endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
    model: 'test-model',
    credentialEnv: undefined,
  };

  assert.equal(
    await runtime.loadPlugin(
      provider('test.focus-provider', workFocusCurrentService, Object.freeze({ current: async () => [] })),
    ),
    'active',
  );
  assert.equal(
    await runtime.loadPlugin(
      provider(
        'test.awareness-provider',
        desktopSessionAwarenessPeekService,
        Object.freeze({ peek: async () => assessmentFixture() }),
      ),
    ),
    'active',
  );

  // The shared requirement, so that the `waiting` below is a statement about the relevance Service and
  // about nothing else. Without it this composition would be one requirement short in two places and the
  // contrast with the test above would stop being evidence.
  assert.equal(await runtime.loadPlugin(chronicleProvider()), 'active');

  const plugin = createRepositoryLanguagePlugin(() => scriptedModel([DONE]));
  assert.equal(await runtime.loadPlugin(plugin, config), 'waiting');

  assert.equal(
    await runtime.loadPlugin(
      provider(
        'test.relevance-provider',
        repositoryCiRelevanceService,
        Object.freeze({ current: async () => RELEVANT }),
      ),
    ),
    'active',
  );
  // The Runtime reconciles on every load, so the plugin recorded as `waiting` is activated by the arrival
  // rather than needing to be loaded again. Asserted through the state the Runtime reports rather than
  // through a second `loadPlugin` call, because the second call is the thing that is not allowed to be
  // how this works: a resident that had to reload a member would be one whose roster depends on order.
  assert.equal(runtime.getPluginState('language'), 'active');
});

test('repository-aware 组合里，模型被给出的能力是三个，且 base 组合仍然是两个', { skip: NO_PIPES }, async (t) => {
  // Over a real pipe and through the real factories, which is what makes this different from the tests
  // above: those check the lists, and this checks that `createRepositoryLanguagePlugin` is what hands the
  // longer one to the answerer at activation. A wiring that always passed `LANGUAGE_EXPOSURES` would pass
  // every list assertion and fail here.
  const repository = await compose(t, {
    repository: true,
    script: [callsTo(toolCall('a', RELEVANCE)), DONE],
  });
  const base = await compose(t, { script: [callsTo(toolCall('a', WORK)), DONE] });

  // Asserted rather than discarded: an ask that never reached the answerer would leave both `tools`
  // assertions below reading an empty request list, and the failure would point at the assertion rather
  // than at the question that did not arrive.
  const asked = await requestLanguage(repository.root, { word: 'ask', text: 'CI 那边怎么样？' });
  assert.equal(asked.kind, 'replied');
  const askedBase = await requestLanguage(base.root, { word: 'ask', text: '我现在关注什么？' });
  assert.equal(askedBase.kind, 'replied');

  // And the third capability is *read*, not merely offered. `requestLanguageAsk` answers `replied` for
  // both `answered` and `failed`, so asking only for `kind` would accept an interaction in which the
  // model's one read came back as "the service this capability names is not one this build can read" —
  // which is exactly what a variant wired to the base reader produces while every list assertion above
  // still passes. This is the assertion that separates "the model was shown three tools" from "the third
  // one works".
  assert.equal(asked.reply.outcome, 'answered');
  assert.equal(askedBase.reply.outcome, 'answered');

  const offeredBy = (composed) => composed.models[0].requests[0].tools.map((tool) => tool.function.name);

  assert.deepEqual(offeredBy(repository), [WORK, DESKTOP, RELEVANCE]);
  assert.deepEqual(offeredBy(base), [WORK, DESKTOP]);
  // And the same fact as a count, on a resident that really activated: two tools offered rather than
  // three. The refusal body is a different surface and is checked offline by 「拒绝语告诉人类它能读哪些
  // 能力…」, which does not need a pipe — this assertion is about what the model was offered and says
  // only that.
  assert.equal(base.models[0].requests[0].tools.length, LANGUAGE_EXPOSURES.length);
});

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

  const answer = await requestLanguage(root, { word: 'ask', text: '光，你现在看到什么？' });

  assert.equal(answer.kind, 'replied');
  assert.equal(answer.reply.outcome, 'answered');
  assert.deepEqual(answer.reply.lines, renderAssessment(assessment));
});

test('一次闲聊经过真实管道回来的是 chatted', { skip: NO_PIPES }, async (t) => {
  const { root } = await compose(t, { script: [says('在的，有什么想问的？')] });

  const answer = await requestLanguage(root, { word: 'ask', text: 'ayobro' });

  assert.equal(answer.kind, 'replied');
  assert.equal(answer.reply.outcome, 'chatted');
  assert.deepEqual(answer.reply.lines, ['在的，有什么想问的？']);
});

test('同一个激活里的两次提问共享那一轮的 referent', { skip: NO_PIPES }, async (t) => {
  const { root, connections, models } = await compose(t, {
    script: [callsTo(toolCall('a', WORK)), DONE, callsTo(toolCall('b', WORK)), DONE],
  });

  const first = await requestLanguage(root, { word: 'ask', text: '我现在关注什么？' });
  assert.equal(first.reply.outcome, 'answered');

  // A second `hikari ask` is a second process and shares nothing with the first; the referent that
  // reaches this request is the resident activation's, which is the whole reason it exists.
  const second = await requestLanguage(root, { word: 'ask', text: '那现在呢？' });
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

  const answer = await requestLanguage(root, { word: 'ask', text: '你现在看到什么？' });

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

// Ungated, and for the reason `work-focus.test.mjs` states for its own copy of this test: every case
// here is refused while argv is being read, so no pipe and no endpoint is involved. That file also
// records what it cost to learn this — deleting its grammar rule left 72 tests green — which is why
// the two operand commands added here get the same treatment rather than riding on the exit-code tests
// above. Those tests pass whole sentences and would stay green if a second operand were quietly
// accepted; these are the only ones that would notice.
//
// The cross-checks are the point of the second assertion in each pair. `confirm` has its own reader and
// its own two sentences rather than sharing `ask`'s, because a person told "ask 需要一个问题" after
// typing `confirm` would be asked to reconsider a command they did not run — so a later refactor that
// folds the two readers together has to fail something, and "the message names the word you typed" is
// the behaviour that refactor would break.
test('两个带操作数的命令都在 argv 上被拒绝，而且拒绝语说的是你打的那个词', async (t) => {
  const root = createRoot(t);
  const cases = [
    [['ask', '--data-dir', root], /ask 需要一个问题/, /confirm 需要一句话/],
    [['ask', '--data-dir', root, 'a', 'b'], /ask 只接受一个问题，收到 2 个/, /confirm 只接受一句话/],
    [['confirm', '--data-dir', root], /confirm 需要一句话/, /ask 需要一个问题/],
    [['confirm', '--data-dir', root, 'a', 'b'], /confirm 只接受一句话，收到 2 个/, /ask 只接受一个问题/],
  ];

  for (const [args, expected, wrongWord] of cases) {
    const result = await runCli(...args);
    assert.equal(result.code, 2, `不是用法错误：${args.join(' ')} → ${result.stderr}`);
    assert.equal(result.stdout, '', '用法错误不上 stdout');
    assert.match(result.stderr, expected);
    assert.doesNotMatch(result.stderr, wrongWord, '拒绝语必须是这个词自己的，不能是另一个词的');
    assert.match(result.stderr, /用法/, '用法错误要带上用法');
  }

  // And the whole point of refusing during argv: nothing was looked at, so nothing was made. A
  // `--data-dir` that does not exist and is not created is the observable form of "this never got as
  // far as opening a store".
  assert.deepEqual(readdirSync(root), []);
});

test('hikari confirm 的退出码跟着 outcome 走：只有 recorded 是 0', { skip: NO_PIPES }, async (t) => {
  // The same chain as the `ask` test above and for the same reason, with the difference that matters
  // here: `confirm` has five possible outcomes and exactly one of them means the person's words are now
  // in the store. `failed` and `refused` are not successes, and neither is `chatted` — which this word
  // cannot produce, and which the command must therefore not treat as one either.
  const { root } = storeRoot(t);
  await resident(t, root, { script: [says('好。')] });

  const kept = await runCli('confirm', '--data-dir', root, CONFIRMED);
  assert.equal(kept.code, 0, 'recorded 是唯一算成功的结局');
  assert.equal(kept.stderr, '');
  assert.deepEqual(kept.stdout.split('\n').slice(0, -1), [...recordedLines()]);

  // The refusal a person gets for an empty line names what actually happened to it, and the exit code
  // says it was not kept. Run as a real process, so this is the argument path and not a direct call.
  const blank = await runCli('confirm', '--data-dir', root, '   ');
  assert.equal(blank.code, 1);
  assert.equal(blank.stdout, '', '没记下来的话不上 stdout');
  assert.ok(blank.stderr.includes('空的'), '拒绝的理由要说到这句话本身');
});

test('没有常驻时，提问与确认得到的都是 absent，而不是一个编出来的结果', { skip: NO_PIPES }, async (t) => {
  const root = createRoot(t);

  const answer = await requestLanguage(root, { word: 'ask', text: '你现在看到什么？' });
  assert.equal(answer.kind, 'absent');
  const lines = languageFailureLines(answer).join('\n');
  assert.ok(lines.includes('没有正在提供语言入口'));
  assert.ok(lines.includes('--model-endpoint'), '应说明语言入口的加载条件');

  // And the same for `confirm`, which must not report a write it could not have made. There is no
  // resident, so there is no store, so nothing was kept — and the failure text says that rather than
  // leaving a person to wonder whether it half-worked.
  const confirmed = await confirmCommand({ dataDir: root, text: CONFIRMED });
  assert.equal(confirmed.exitCode, 1);
  assert.equal(confirmed.stdout, '');
  assert.ok(!confirmed.stderr.includes('记下了'), '没有任何常驻时不得说记下了');
  assert.ok(confirmed.stderr.includes('没有正在提供语言入口'));
});

test('confirm 是协议里的第二个词，recorded 是第五个结果词', () => {
  // The envelope, checked on its own because it is the runtime boundary: a word this build does not know
  // is refused before anything writes, so a typo can never reach the store as one of the two words. The
  // positive half is here as well — the test above this one only shows that `command` is refused, which
  // would also pass if `confirm` were.
  const confirm = decodeLanguageRequest(
    JSON.stringify({ protocol: LANGUAGE_PROTOCOL_VERSION, request: 'confirm', text: CONFIRMED }),
  );
  assert.equal(confirm.kind, 'request');
  assert.equal(confirm.request.word, 'confirm');
  assert.equal(confirm.request.text, CONFIRMED);

  for (const outcome of ['chatted', 'answered', 'recorded', 'refused', 'failed']) {
    const decoded = decodeLanguageReply(
      JSON.stringify({ protocol: LANGUAGE_PROTOCOL_VERSION, outcome, lines: ['x'] }),
    );
    assert.equal(decoded.kind, 'reply', `${outcome} 应当被读懂`);
    assert.equal(decoded.reply.outcome, outcome);
  }
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

// ---------------------------------------------------------------------------------------------
// The record: the ten things the mandate asks of a bounded conversational continuity.
//
// The section above tests the plugin against stub stores, because everything it is about is the
// Language side. This one is about the store — whether a confirmation is the only thing that produces a
// record, whether that record survives a resident being restarted, whether it can be believed to be
// more than it is — so the compositions here load the *real* `continuity` and `chronicle` plugins over a
// real directory. Nothing below is reachable on `ubuntu-latest`: activation opens a named pipe. What
// that costs is stated with each test rather than in one place, because the halves differ.
//
// The one claim this section cannot make, and says so where it comes up: a scripted model proves the
// record *reached* the model, not that the model was influenced by it. `language-semantic.live.test.mjs`
// is the harness for the second, and nothing here is evidence for it.
// ---------------------------------------------------------------------------------------------

/** A directory with an identity and a Chronicle store, which is what a resident is given. */
function storeRoot(t) {
  const root = createRoot(t);
  const identity = initializeHikari({ rootDir: root });
  initializeChronicle({ rootDir: root, identity });
  return { root, identity };
}

/**
 * Everything in the store, read back through the owner's own reader.
 *
 * Deliberately not a reimplementation of the file format: a test that parsed `chronicle.jsonl` itself
 * would go on passing while the store's encoding changed underneath it, and it would be asserting
 * against this file's idea of the format rather than against what Hikari can actually read. It also
 * means the assertions below are about facts that *survive a reader*, which is the only form of
 * "it was recorded" that means anything to the next resident.
 */
async function storedFacts(root, identity) {
  return openChronicle({ rootDir: root, identity }).read();
}

/**
 * A resident assembled the way `cli/resident.ts` assembles one, over the store at `root`.
 *
 * The real `continuity` and `chronicle` plugins rather than the stub the section above uses, and the
 * three providers the same way. `stop()` is returned rather than only registered with `t.after`,
 * because the restart tests have to end this runtime *before* the next one opens the same pipe — a
 * `t.after` cleanup runs at the end of the test, which is the wrong end.
 *
 * `focusReads()` counts calls to the focus provider, which is how "restarting did not restore the work
 * focus" is checked as something that did not happen rather than as something nobody looked for.
 */
async function resident(t, root, { script = [says('好。')], repository = false, judgement = RELEVANT } = {}) {
  const runtime = new Runtime();
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await runtime.shutdown();
  };
  t.after(stop);

  const models = [];
  let focusReads = 0;
  const plugin = (repository ? createRepositoryLanguagePlugin : createLanguagePlugin)(() => {
    const model = scriptedModel(script);
    models.push(model);
    return model;
  });

  const config = {
    rootDir: root,
    endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
    model: 'test-model',
    credentialEnv: undefined,
  };

  // The two storage plugins first, which is also the order `cli/resident.ts` uses. Unlike Language's
  // third requirement they are not *order*-sensitive — the Runtime re-checks its waiting list — but a
  // composition that had to rely on that re-check would be testing the Runtime rather than this slice.
  assert.equal(await runtime.loadPlugin(continuityPlugin, { rootDir: root }), 'active');
  assert.equal(await runtime.loadPlugin(chroniclePlugin, { rootDir: root }), 'active');
  assert.equal(
    await runtime.loadPlugin(
      provider(
        'test.focus-provider',
        workFocusCurrentService,
        Object.freeze({
          current: async () => {
            focusReads += 1;
            return ['hikari-new'];
          },
        }),
      ),
    ),
    'active',
  );
  assert.equal(
    await runtime.loadPlugin(
      provider(
        'test.awareness-provider',
        desktopSessionAwarenessPeekService,
        Object.freeze({ peek: async () => assessmentFixture() }),
      ),
    ),
    'active',
  );
  if (repository) {
    assert.equal(
      await runtime.loadPlugin(
        provider(
          'test.relevance-provider',
          repositoryCiRelevanceService,
          Object.freeze({ current: async () => judgement }),
        ),
      ),
      'active',
    );
  }

  assert.equal(await runtime.loadPlugin(plugin, config), 'active', '真实组合应 active');

  return { runtime, models, stop, focusReads: () => focusReads };
}

/** The system message of one step, which is where a record can be observed to have reached a model. */
function systemPromptOf(model, step = 0) {
  return model.requests[step].messages[0].content;
}

const CONFIRMED = '我更喜欢在夜里写代码';

test('ask 一次都不写 Chronicle，只有 confirm 写，而且只写这一族', async () => {
  // No pipe, so this half runs on CI — and it is the half worth having there, because "the word that only
  // asks produces no fact at all" is the sentence the whole slice rests on. The answerer is called and
  // observed to have been called, so a zero here is "ask was answered and wrote nothing" rather than
  // "ask never arrived".
  const appended = [];
  const answered = [];
  const continuity = createDecisionContinuity({
    append: async (draft) => {
      appended.push(draft);
      return { factId: `f${appended.length}`, ...draft };
    },
    now: () => NOW,
    initial: [],
  });
  const handler = languageRequestHandler(
    {
      async answer(text) {
        answered.push(text);
        return { outcome: 'chatted', lines: ['好。'] };
      },
    },
    continuity,
  );

  const asked = await handler({ word: 'ask', text: `记一下：${CONFIRMED}` });
  assert.deepEqual(answered, [`记一下：${CONFIRMED}`], 'ask 必须到达答案器');
  assert.equal(asked.outcome, 'chatted');
  assert.deepEqual(appended, [], 'ask 不得产生任何事实');
  assert.deepEqual(continuity.current(), [], '一次 ask 之后，已确认的清单仍然是空的');

  const confirmed = await handler({ word: 'confirm', text: CONFIRMED });
  assert.equal(confirmed.outcome, 'recorded');
  assert.deepEqual(confirmed.lines, recordedLines());
  assert.equal(appended.length, 1, 'confirm 恰好写一次');
  // The draft is asserted field by field rather than by shape, because every field here is a claim the
  // mandate makes: the type names the *act*, the payload carries the person's own bytes, and the source
  // says only what an unauthenticated local ingress can say.
  assert.equal(appended[0].type, 'language.decision-confirmed');
  assert.equal(appended[0].version, 1);
  assert.equal(appended[0].occurredAt, NOW);
  assert.deepEqual(appended[0].source, { kind: 'language.endpoint' });
  assert.deepEqual(appended[0].payload, { statement: CONFIRMED });
  assert.deepEqual(continuity.current(), [{ statement: CONFIRMED, at: NOW }]);
});

test('空话与超长的话都不写，回话也不说「记下了」', async () => {
  // The two refusals, asserted together because they are the same rule twice: nothing is written unless
  // something was actually said, and the sentence a person gets must name the act they performed —
  // `longQuestionLines` would tell them their statement was not a question, which is true and about a
  // question they never asked.
  const appended = [];
  const continuity = createDecisionContinuity({
    append: async (draft) => {
      appended.push(draft);
      return { factId: 'f', ...draft };
    },
    now: () => NOW,
    initial: [],
  });

  const blank = await confirmDecision(continuity, '   ');
  assert.equal(blank.outcome, 'refused');
  assert.deepEqual(blank.lines, emptyStatementLines());

  const long = await confirmDecision(continuity, 'a'.repeat(MAX_LANGUAGE_TEXT_LENGTH + 1));
  assert.equal(long.outcome, 'refused');
  assert.deepEqual(long.lines, longStatementLines(MAX_LANGUAGE_TEXT_LENGTH));

  assert.deepEqual(appended, [], '被拒绝的话不得触及存储');
  assert.deepEqual(continuity.current(), []);
});

test('写入失败时说的是「没有记下来」，这一轮也不再持有它', async () => {
  // The failure semantics, and the reason they are not copied from `work-focus/session.ts`: there the
  // state change is real and independent of the write, so a failed append can be reported as a change
  // with an unconfirmed record. Here the append *is* the act, so a write that did not happen is a
  // confirmation that did not happen — `failed`, and the activation's own list must not have it either.
  const continuity = createDecisionContinuity({
    append: async () => {
      throw new Error('store is gone');
    },
    now: () => NOW,
    initial: [],
  });

  const reply = await confirmDecision(continuity, CONFIRMED);

  assert.equal(reply.outcome, 'failed');
  assert.deepEqual(reply.lines, confirmFailureLines('store is gone'));
  assert.deepEqual(continuity.current(), [], '写失败的话不得留在这一轮的清单里');
});

test('读回是有界的：取最新的那一段，并说出漏掉了几条', () => {
  // §8's last item, and the rule it is about is a rule about a prompt budget rather than about history —
  // which is why the function takes a budget and why nothing in it ranks, filters by subject or scores.
  // The failure this prevents is a record section that grows without limit and pushes the question a
  // person is actually asking out of the window they are talking through.
  const decisions = [
    { statement: 'a'.repeat(10), at: '2026-01-01T00:00:00.000Z' },
    { statement: 'b'.repeat(10), at: '2026-01-02T00:00:00.000Z' },
    { statement: 'c'.repeat(10), at: '2026-01-03T00:00:00.000Z' },
  ];

  assert.deepEqual(selectConfirmedDecisions(decisions, 1000), { decisions, dropped: 0 });

  // Two fit. What comes back is the newest two — not the oldest two, and not a set chosen to fit more.
  assert.deepEqual(selectConfirmedDecisions(decisions, 25), {
    decisions: decisions.slice(1),
    dropped: 1,
  });

  // And the contiguity, which is the part a "fit as many as possible" rule would get wrong: a newest
  // record that does not fit stops the walk rather than being skipped over, so a shorter older record is
  // never shown ahead of the sentence it came after. Empty with a count is the honest report of that.
  assert.deepEqual(selectConfirmedDecisions(decisions, 5), { decisions: [], dropped: 3 });
});

test('认不出来的事实一律跳过，一条都不编', () => {
  // The read-back's failure policy, and the one that matters most: this material ends up in a prompt, so
  // inventing a statement out of a payload that is not this family's would be the worst available
  // outcome. The store is shared — a sibling's fact is not an error — and it is a file, so it can be
  // edited. Every entry below is one a real store could contain; none of them may become a decision.
  const facts = [
    { type: 'work-focus.declared', version: 1, occurredAt: NOW, source: { kind: 'work-focus.endpoint' }, payload: { designation: 'hikari-new' } },
    { type: 'language.decision-confirmed', version: 2, occurredAt: NOW, source: { kind: 'language.endpoint' }, payload: { statement: '未来的版本' } },
    { type: 'language.decision-confirmed', version: 1, occurredAt: NOW, source: { kind: 'language.endpoint' }, payload: { statement: 42 } },
    { type: 'language.decision-confirmed', version: 1, occurredAt: NOW, source: { kind: 'language.endpoint' }, payload: null },
    { type: 'language.decision-confirmed', version: 1, occurredAt: NOW, source: { kind: 'language.endpoint' } },
  ];

  assert.deepEqual(readConfirmedDecisions(facts), []);

  // And the one that is this family's, in the shape this build writes, is read — otherwise the empty
  // result above would be evidence about the reader being broken rather than about it being careful.
  const good = { type: 'language.decision-confirmed', version: 1, occurredAt: NOW, source: { kind: 'language.endpoint' }, payload: { statement: CONFIRMED } };
  assert.deepEqual(readConfirmedDecisions([...facts, good]), [{ statement: CONFIRMED, at: NOW }]);
});

test('本地入口收到过，不等于一个已认证的人说过', { skip: NO_PIPES }, async (t) => {
  // §8's third item, checked on what is actually written rather than on what a comment promises. The
  // type is a free string at the type level and at runtime — `FactSource.kind` is `string` — so the only
  // thing standing between this record and a claim nothing here established is which literal was
  // written, and that is exactly what a test can pin.
  const { root, identity } = storeRoot(t);
  await resident(t, root, { script: [says('好。')] });

  const confirmed = await requestLanguage(root, { word: 'confirm', text: CONFIRMED });
  assert.equal(confirmed.kind, 'replied');
  assert.equal(confirmed.reply.outcome, 'recorded');

  const facts = await storedFacts(root, identity);
  assert.equal(facts.length, 1);
  assert.equal(facts[0].source.kind, 'language.endpoint');
  assert.notEqual(facts[0].source.kind, 'human');
  assert.ok(!JSON.stringify(facts[0]).includes('human'), '记录里不得出现身份认证的字样');

  // And the person is told the same thing the record says — a human and a model are given the same
  // sentence about what a record is, so neither can read it more strongly than the other.
  const spoken = confirmed.reply.lines.join('\n');
  assert.ok(spoken.includes('不是 Hikari 核实过的事实'));
  assert.ok(spoken.includes('不是任何形式的授权'));
});

test('这一族事实只有语言包自己读写，别处连它的名字都不出现', () => {
  // §9's structural half — no side-effect authorization — as a property of the source rather than as a
  // sentence in a comment. A gate, a router or a piece of restored state would each have to *name* this
  // family to read it, and the name appears in exactly one file. What follows is that the only consumer
  // is the prompt builder and a prompt is not an authority; and that nothing can be added to the other
  // side of it without this test going red, which is the point of checking it here rather than
  // describing it.
  //
  // The family is also not reachable through either variant's `provides`, which the roster test above
  // pins as an exact list — so there is no Service through which a second module could ask for it.
  const sourceRoot = join(import.meta.dirname, '..', 'src');
  const holders = sourceFiles(sourceRoot)
    .filter((file) => readFileSync(file, 'utf8').includes('language.decision-confirmed'))
    .map((file) => relative(sourceRoot, file).replaceAll('\\', '/'));

  assert.deepEqual(holders, ['language/continuity.ts']);
});

test('一次完整的提问什么也不留：未确认的话不会变成已确认的决定', { skip: NO_PIPES }, async (t) => {
  // §8's second item over the real store, which is the form of it that can be wrong in a way the pure
  // test above cannot see: a conversation that was answered and grounded still leaves the family empty,
  // because `ask` is the only path it took. Read back through the owner's reader rather than off the
  // plugin's list, so what is asserted is that nothing was *written*, not that nothing was kept.
  const { root, identity } = storeRoot(t);
  await resident(t, root, { script: [callsTo(toolCall('a', WORK)), DONE] });

  const answer = await requestLanguage(root, { word: 'ask', text: '我现在关注什么？' });
  assert.equal(answer.kind, 'replied');
  assert.equal(answer.reply.outcome, 'answered', '这次对话本身要成功，否则空记录证明不了什么');

  assert.deepEqual(await storedFacts(root, identity), []);
});

test('确认过的决定经得起重启，并且以低信任材料进入下一次对话', { skip: NO_PIPES }, async (t) => {
  // §8's first, fourth and fifth items in one composition, because they are one behaviour: what was
  // confirmed is on disk, the next resident reads it back at activation, and the model is told it.
  //
  // The question in the second activation is asked in a fresh process state — the first runtime is shut
  // down before the second opens the same pipe — so the sentence below cannot have come from the first
  // activation's in-memory list. That is the whole of what makes this a restart rather than a long
  // conversation, and it is why `stop()` is called here instead of left to `t.after`.
  const { root } = storeRoot(t);

  const first = await resident(t, root, { script: [says('好。')] });
  const confirmed = await requestLanguage(root, { word: 'confirm', text: CONFIRMED });
  assert.equal(confirmed.kind, 'replied');
  assert.equal(confirmed.reply.outcome, 'recorded');
  await first.stop();

  const second = await resident(t, root, { script: [says('是的。')] });
  const asked = await requestLanguage(root, { word: 'ask', text: '我刚才让你记了什么？' });
  assert.equal(asked.kind, 'replied');
  assert.equal(asked.reply.outcome, 'chatted');

  const prompt = systemPromptOf(second.models[0]);
  assert.ok(prompt.includes(CONFIRMED), '重启之后，这条记录应当回到对话里');
  // And it arrives labelled. A model handed a bare list of sentences would have no way to know they are
  // one person's unverified words rather than something Hikari established — which is the reading §8's
  // third item forbids, arriving through the prompt instead of through the record.
  assert.ok(prompt.includes('不是 Hikari 观察到的事实'), '低信任必须随材料一起交给模型');
  assert.ok(prompt.includes('不构成许可'));
  assert.ok(prompt.includes('以你读到的为准'), '工具读到的事实优先于这一段');

  // What this cannot show, and does not claim: that the model was *influenced*. A scripted model agrees
  // with whatever it was handed. The prompt is the furthest this file can see.
});

test('记录这一段说了它是干什么用的：问起以前确认过的话，就是直接说，不是去读', async () => {
  // The shape a real conversation produced, reproduced structurally. A question about a decision the
  // person had confirmed came back as `你当前还没有明确声明任何关注对象。` — the rendering of an empty work
  // focus, which is a reading of *now* and says nothing about what was said before. That is the shape
  // below: the model reads the focus, and the answer is the owner's rendering of the reading.
  //
  // The script decides the read, and that is the limit of it. "A real model reads on such a question" is a
  // claim about semantic selection, and this file cannot make it — `language-semantic.live.test.mjs` is
  // where that evidence is collected and it is skipped without an endpoint. What is asserted here is the
  // half that is this build's own text: the record's section says what the record is *for*, and says it
  // only when there is a record to have a route to.
  //
  // The two sentences this test pins were absent, and their absence is the thing to see: the section was a
  // list of what the material is *not* — not verified, not an instruction, not a fact, not the winner of a
  // conflict — and a list of negatives is material a model has to place for itself. `prompt.ts` says why
  // that matters in its own header: a model that does not know it may simply answer will reach for a tool
  // instead. It says the same thing about small talk, and the record had no such sentence.
  const decision = {
    statement: '快速认知部署原则是：先在一台机器上跑通，再考虑第二台。',
    at: '2026-10-01T00:00:00.000Z',
  };
  const h = harness({ script: [callsTo(toolCall('c1', WORK)), DONE], focus: [], decisions: [decision] });

  const reply = await h.answerer.answer('我们之前确认的快速认知部署原则是什么？');

  // The consequence, asserted here so that the prompt's sentence about it is not the only place it is
  // written: this step is `DONE`, which says nothing, so the answer is the reading. A deep comparison
  // rather than a substring search, because what is being checked is that nothing else was appended —
  // which is the same reason the one-way door test above uses one.
  //
  // The empty content is what makes this the record-present-but-silent case rather than the ordinary one,
  // and naming it is the point: the record *is* in this interaction's context, so a paragraph would have
  // been composed had the model said anything. That the answer is still exactly the owner's lines is the
  // half of the rule that says silence costs nothing.
  assert.equal(reply.outcome, 'answered');
  assert.deepEqual(reply.lines, renderFocus([]), '读过之后回答就是读回来的那样，记录不在里面');

  // The record was in the context for that same interaction. The material being there is §8's fifth item;
  // the route being there is what the failure turned on.
  const { messages } = h.requests[0];
  assert.equal(messages[0].role, 'system');
  const prompt = messages[0].content;
  assert.ok(prompt.includes(decision.statement), '记录在上下文里');
  assert.ok(prompt.includes('回答就是这些话本身'), '要说出这一段的用处：问起这些话，就是直接说');
  // Both halves of what the section says about a reading, and the order they are asserted in is the order
  // the failure arrived in. The negative one is first because it is the one that had to be *added*: the
  // section used to end on a bare route, and a route with nothing bounding it is an instruction to bring
  // the record up — which is how an unrelated deployment note ends up appended to a question about the
  // screen. The second is the sentence the route used to contradict.
  assert.ok(prompt.includes('只在他问到的时候才提'), '要圈出这一段的范围：没问到就不要提');
  assert.ok(
    prompt.includes('你说的话会跟在读到的内容后面展示'),
    '也要说出混合问题读了之后会发生什么：话会被展示出来',
  );

  // And the route is a statement about this material rather than a branch on what the person typed: no
  // capability and no domain appears in the prompt at all, so there is no word for a question to be
  // matched against. `prompt.ts` makes the same claim about the whole document, and the temptation this
  // guards is a sentence about the record that names what the record is usually about.
  for (const word of [WORK, DESKTOP, '工作焦点']) {
    assert.ok(!prompt.includes(word), `prompt 不得出现 ${word}`);
  }

  // All or nothing: a model told about the route to a record when there is no record is being told about
  // a section that is not there. Asserted rather than reasoned about, because the way this breaks is a
  // later edit moving the sentence out of `continuityParagraph` and into the main body.
  const empty = harness({ script: [says('好。')], decisions: [] });
  await empty.answerer.answer('你好');
  assert.ok(
    !empty.requests[0].messages[0].content.includes('回答就是这些话本身'),
    '没有记录时，这一段整段不出现，路线也跟着不出现',
  );

  // And the grant goes with it, which is the same claim about a different sentence and needed its own
  // needle. Both sentences were once moved together and an earlier draft kept this one in the static body:
  // there, every machine read a second duty — "say what you read and what he said before together" —
  // including the machines whose model then had its sentence discarded, because the gate asks about the
  // record. A model told to write something this build throws away is being asked for work it cannot
  // deliver, and the guard above could not catch it: it looks for the route.
  assert.ok(
    !empty.requests[0].messages[0].content.includes('你负责的事有两件'),
    '没有记录时，也不能授权模型「把两半一起说清楚」',
  );
});

/** One confirmed statement, as this plugin's own record keeps it. Named for what it is about. */
const DEPLOYMENT_DECISION = Object.freeze({
  statement: '快速认知部署原则是：先在一台机器上跑通，再考虑第二台。',
  at: '2026-10-01T00:00:00.000Z',
});

test('有记录时，读过之后说的话跟在读回来的内容后面，并且标明那是谁说的', async () => {
  // The outcome this round added, asserted as a shape rather than as a substring: a reading, then a label,
  // then the model's sentence. The order is the entire safety argument — the label leads its section and
  // the section follows every reading — so a test that only checked the sentence was somewhere in the
  // answer would pass on an implementation that had laid it between two of the owner's lines.
  //
  // The question is a mixed one and the script says what the model did with it: read the work focus, then
  // say something joining that reading to what this person confirmed before. A scripted model cannot show
  // that a real one *would* — that evidence is `language-semantic.live.test.mjs`'s half and it is skipped
  // without an endpoint. What is pinned here is that when a model does, the answer has a place to put it.
  const spoken = '你之前说过先在一台机器上跑通再考虑第二台；现在这台机器上还没有相关的草稿。';
  const h = harness({
    script: [callsTo(toolCall('c1', WORK)), says(spoken)],
    focus: [],
    decisions: [DEPLOYMENT_DECISION],
  });

  const reply = await h.answerer.answer('我们之前确认的部署原则是什么？当前焦点又是什么？');
  assert.equal(reply.outcome, 'answered');

  // The reading first, and byte for byte what the owner rendered. Nothing above it, because a label that
  // came before the readings would be a section about them rather than an aside after them.
  const reading = renderFocus([]);
  assert.deepEqual(reply.lines.slice(0, reading.length), reading, '读回来的内容在最前面，且没有被改动');

  const composed = reply.lines.slice(reading.length);
  assert.equal(composed.length, 2, '一段：标签一行，模型的话一行');
  assert.ok(composed[0].startsWith('（'), '标签在段首，不在两句之间');
  assert.ok(composed[0].includes('不是读回来的内容'), '标签要说这不是读回来的');
  // The second clause, which is the only place a reader learns that a sentence about their own past words
  // is not the record itself. A label saying only "not a reading" would leave the stronger-looking claim —
  // this person's own words, therefore a fact — unmarked.
  assert.ok(composed[0].includes('没有核实过'), '标签也要说记录本身没有被 Hikari 核实过');
  assert.equal(composed[1], spoken, '模型的话逐字出现，不被改写');
});

test('没有记录时，读过之后说的话仍然不算数', async () => {
  // The gate, and the reason it is the record rather than the model's own confidence: with no confirmed
  // statements the only material in the context is the readings, so a sentence added to them is a sentence
  // *about the readings* — the judgement `answer.ts`'s header says this surface does not have. The same
  // condition also keeps every machine that has never recorded anything on exactly the behavior it had
  // before this existed, which is what makes the change checkable against the old tests rather than only
  // against new ones.
  const spoken = '看起来你正在写 Hikari。';
  const h = harness({
    script: [callsTo(toolCall('c1', WORK)), says(spoken)],
    focus: [],
    decisions: [],
  });

  const reply = await h.answerer.answer('我在做什么？');
  assert.equal(reply.outcome, 'answered');
  assert.deepEqual(reply.lines, renderFocus([]), '没有材料可谈时，模型的话不出现');
});

test('提问进行中才写进来的记录，不给这一轮开门', async () => {
  // The store reaches the loop as a live view rather than a copy — `continuity.ts` says so in the
  // interface's own words and `plugin.ts` hands that view straight over — and this endpoint serves one
  // connection at a time with nothing serialized between them, so a `confirm` on another connection lands
  // while an ask is waiting on the model. The prompt for that ask was built before the write and lists no
  // record. If the gate asked about the store instead of about the page it would see the new record, open,
  // and the answer would carry a section labelled as drawing on this person's words while showing none.
  //
  // Written from inside the model call, which is the only moment the race can happen, and the moment a
  // length test cannot cover: the value read before the call and the value read after it are the same
  // array. This builds its own answerer rather than going through `harness` because the push has to happen
  // between the two steps, and `harness` is handed a script rather than a hook.
  const decisions = [];
  const reader = createExposureReader({
    async readFocus() {
      return Object.freeze([]);
    },
    async peek() {
      return assessmentFixture();
    },
  });

  let calls = 0;
  const answerer = createAnswerer({
    async step() {
      calls += 1;
      if (calls === 1) {
        decisions.push(DEPLOYMENT_DECISION);
        return callsTo(toolCall('c1', WORK));
      }
      return says('你之前说过先在一台机器上跑通再考虑第二台。');
    },
    async read(exposure) {
      return reader(exposure);
    },
    now: () => NOW,
    exposures: LANGUAGE_EXPOSURES,
    decisions: () => decisions,
  });

  const reply = await answerer.answer('我们之前确认的部署原则是什么？当前焦点又是什么？');
  assert.equal(reply.outcome, 'answered');
  assert.deepEqual(reply.lines, renderFocus([]), 'prompt 里没有记录段时，这一轮也不许出现合成段');
});

test('合成段的标签在默认终端宽度下是一整行', () => {
  // The label is the only thing telling a reader these lines are not a reading, and it is one line of an
  // answer a terminal lays out: `tui-render.ts` clips every line to `render.columns` and reserves a column
  // for its own ellipsis, so at the default 80 the budget is 79. A wider label loses its tail on a default
  // window, and the tail is the clause that says the material was never verified — the label would then be
  // present, cut, and useless exactly where it matters most.
  //
  // Measured off the rendered section rather than off a constant, so the number checked is the one a human
  // would be shown, and measured with the terminal's own `displayWidth`, so a label that is short in code
  // points but wide in cells cannot pass.
  const width = displayWidth(renderSynthesis('好。')[0]);
  assert.ok(width <= 79, `标签占 ${width} 列，默认终端一行放不下（上限 79）`);

  // Both claims survive at that width, which is the reason the text is as short as it is: the first says
  // where these lines came from, the second says nothing verified them. Dropping either to save columns
  // would make the remaining one a weaker statement than the one this build can actually make.
  assert.ok(renderSynthesis('好。')[0].includes('不是读回来的内容'));
  assert.ok(renderSynthesis('好。')[0].includes('没有核实过'));
});

test('最后一步被截断时，半句话不进回答', async () => {
  // A truncated step carries a prefix of a sentence and nothing says where the rest went. The rule is not
  // new — the chat path already refuses to show one — and it has to hold here for a reason the label
  // creates: a reader told these are Hikari's own words is being told the sentence is whole, and the half
  // that is missing would be missing exactly there, underneath a claim that it is complete.
  const h = harness({
    script: [
      callsTo(toolCall('c1', WORK)),
      { content: '你之前说过先在一台机器上跑通，', toolCalls: [], truncated: true },
    ],
    focus: [],
    decisions: [DEPLOYMENT_DECISION],
  });

  const reply = await h.answerer.answer('我们之前确认的部署原则是什么？');
  assert.equal(reply.outcome, 'answered');
  assert.deepEqual(reply.lines, renderFocus([]), '半句话不出现在回答里');
});

test('因为调用没执行而结束的那一步，写的话不算数', async () => {
  // The loop's other exit. That step both wrote and called, and the assistant message pushed back onto the
  // array carries no content — the model is deliberately not told it said something no human saw. A
  // sentence the loop hid twice on the way in is not one to surface on the way out, so the capture hangs
  // off the grounded exit specifically and not off the loop's ending.
  //
  // A repeated capability is what reaches that exit, and the repeat is the fixture: the second step asks
  // for the focus it already read.
  const h = harness({
    script: [
      callsTo(toolCall('c1', WORK)),
      { content: '你之前说过先在一台机器上跑通。', toolCalls: [toolCall('c2', WORK)], truncated: false },
    ],
    focus: [],
    decisions: [DEPLOYMENT_DECISION],
  });

  const reply = await h.answerer.answer('我们之前确认的部署原则是什么？');
  assert.equal(reply.outcome, 'answered');
  assert.deepEqual(reply.lines, renderFocus([]), '被拒绝的重复读取那一步，说的话不出现');
});

test('没被确认过的话在重启之后不回来', { skip: NO_PIPES }, async (t) => {
  // The other direction of the same claim, and the one that would be silently wrong if `ask` wrote
  // anything: an entire conversation — including a sentence that reads exactly like something worth
  // keeping — is gone after a restart, and the model is told no record at all.
  const { root } = storeRoot(t);

  const first = await resident(t, root, { script: [says('好。')] });
  await requestLanguage(root, { word: 'ask', text: `记一下：${CONFIRMED}` });
  await first.stop();

  const second = await resident(t, root, { script: [says('是的。')] });
  await requestLanguage(root, { word: 'ask', text: '我刚才让你记了什么？' });

  const prompt = systemPromptOf(second.models[0]);
  assert.ok(!prompt.includes(CONFIRMED), 'ask 说过的话不得在重启后回来');
  assert.ok(!prompt.includes('明确确认过'), '没有记录时，这一段整个不出现，而不是出现一个空的');
});

test('删掉记录之后，Hikari 不装作还记得', { skip: NO_PIPES }, async (t) => {
  // §8's seventh item. The record is a file and there is no second copy — no database, no index, no
  // cache that outlives the activation — so removing it removes the memory.
  //
  // The replacement store is built by the owner's own initializer under the same identity, rather than
  // by editing the file or parsing it here. That keeps this file from holding a second opinion about
  // the format, and it is the same end state an operator's `rm` would leave.
  const { root, identity } = storeRoot(t);

  const first = await resident(t, root, { script: [says('好。')] });
  await requestLanguage(root, { word: 'confirm', text: CONFIRMED });
  await first.stop();

  const emptied = createRoot(t);
  initializeChronicle({ rootDir: emptied, identity });
  copyFileSync(resolveChroniclePath(emptied), resolveChroniclePath(root));
  // The setup is asserted rather than assumed. Without this, a copy that silently did nothing would
  // leave the record in place, and the only thing that would notice is the assertion at the bottom —
  // arriving as a failure of the wrong claim, which is the one way a test like this wastes an hour.
  assert.deepEqual(await storedFacts(root, identity), [], '删除这一步本身要成立');

  const second = await resident(t, root, { script: [says('是的。')] });
  await requestLanguage(root, { word: 'ask', text: '我刚才让你记了什么？' });

  assert.ok(!systemPromptOf(second.models[0]).includes(CONFIRMED), '记录没了就不能再说记得');
});

test('重启时读回记录不会恢复工作焦点', { skip: NO_PIPES }, async (t) => {
  // §8's eighth item, checked as a call that does not happen. Restoring the work focus would require
  // reading it while reading the record back — there is nowhere else it could happen at activation — so
  // a zero here is the claim. The question afterwards is what keeps the zero from being vacuous: a
  // question that reads the focus does move the counter, so it is measuring something.
  const { root } = storeRoot(t);

  const first = await resident(t, root, { script: [says('好。')] });
  await requestLanguage(root, { word: 'confirm', text: CONFIRMED });
  await first.stop();

  const second = await resident(t, root, { script: [callsTo(toolCall('a', WORK)), DONE] });
  assert.equal(second.focusReads(), 0, '激活不得读工作焦点');

  await requestLanguage(root, { word: 'ask', text: '我现在关注什么？' });
  assert.equal(second.focusReads(), 1, '焦点确实可被读——否则上面的 0 什么也没测到');
});

test('Chronicle 读不出来时，Language 照常说话，只是没有记录那一段', { skip: NO_PIPES }, async (t) => {
  // §8's last item's second half: the degradation. The direction is `repository-ci-attention/plugin.ts`'s
  // — speak with what you have rather than refuse — and the empty list it degrades to produces a prompt
  // with no record section in it, which says nothing at all. That is why it is honest here and would not
  // be anywhere that read it as "nothing was ever confirmed", and nothing in this build asks that.
  const root = createRoot(t);
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  const models = [];
  await runtime.loadPlugin(
    provider('test.focus-provider', workFocusCurrentService, Object.freeze({ current: async () => ['hikari-new'] })),
  );
  await runtime.loadPlugin(
    provider(
      'test.awareness-provider',
      desktopSessionAwarenessPeekService,
      Object.freeze({ peek: async () => assessmentFixture() }),
    ),
  );
  await runtime.loadPlugin({
    id: 'test.chronicle-provider',
    version: '1.0.0',
    provides: [chronicleService],
    setup(context) {
      context.services.provide(
        chronicleService,
        Object.freeze({
          async append() {
            throw new Error('这个组合不该被写入');
          },
          async get() {
            return undefined;
          },
          async read() {
            throw new Error('store is unreadable');
          },
        }),
      );
    },
  });

  assert.equal(
    await runtime.loadPlugin(
      createLanguagePlugin(() => {
        const model = scriptedModel([DONE]);
        models.push(model);
        return model;
      }),
      {
        rootDir: root,
        endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
        model: 'test-model',
        credentialEnv: undefined,
      },
    ),
    'active',
    '读不出来不该让插件起不来',
  );

  const answer = await requestLanguage(root, { word: 'ask', text: '你现在看到什么？' });
  assert.equal(answer.kind, 'replied');
  assert.notEqual(answer.reply.outcome, 'failed', '存储读失败不得变成答不出话');
  assert.ok(!systemPromptOf(models[0]).includes('明确确认过'), '降级时这一段不出现');
});

test('Chronicle 不可写时，confirm 是 failed，而不是一个成功的样子', { skip: NO_PIPES }, async (t) => {
  // The write half of the same boundary, over the pipe and through the real client: the operator learns
  // that nothing was kept at the moment they asked for it to be kept, rather than at the next restart
  // when it is not there.
  const root = createRoot(t);
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  await runtime.loadPlugin(
    provider('test.focus-provider', workFocusCurrentService, Object.freeze({ current: async () => [] })),
  );
  await runtime.loadPlugin(
    provider(
      'test.awareness-provider',
      desktopSessionAwarenessPeekService,
      Object.freeze({ peek: async () => assessmentFixture() }),
    ),
  );
  await runtime.loadPlugin({
    id: 'test.chronicle-provider',
    version: '1.0.0',
    provides: [chronicleService],
    setup(context) {
      context.services.provide(
        chronicleService,
        Object.freeze({
          async append() {
            throw new Error('store is read-only');
          },
          async get() {
            return undefined;
          },
          async read() {
            return [];
          },
        }),
      );
    },
  });
  await runtime.loadPlugin(createLanguagePlugin(() => scriptedModel([says('好。')])), {
    rootDir: root,
    endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
    model: 'test-model',
    credentialEnv: undefined,
  });

  const reply = await requestLanguage(root, { word: 'confirm', text: CONFIRMED });
  assert.equal(reply.kind, 'replied');
  assert.equal(reply.reply.outcome, 'failed');
  const lines = reply.reply.lines.join('\n');
  assert.ok(lines.includes('没有记下来'));
  assert.ok(!lines.includes('记下了'), '失败时不得说记下了');

  // And `hikari confirm`'s exit code follows it, which is how a script learns the difference. Run
  // against the same resident, so this is the real client and the real plugin rather than a second
  // composition that happens to look like it.
  const outcome = await confirmCommand({ dataDir: root, text: CONFIRMED });
  assert.equal(outcome.exitCode, 1);
  assert.equal(outcome.stdout, '', '失败的话不上 stdout');
  assert.ok(outcome.stderr.length > 0, '失败的理由要有人看得到');
});
