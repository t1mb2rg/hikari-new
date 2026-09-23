import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { desktopSessionAwarenessPeekService } from '../dist/desktop-session-awareness/index.js';
import { renderAssessment } from '../dist/desktop-session-observe/index.js';
import { renderFocus } from '../dist/language/express.js';
import { LANGUAGE_EXPOSURES, createAnswerer } from '../dist/language/index.js';
import { createHttpModel } from '../dist/language/model.js';
import { createExposureReader } from '../dist/language/read.js';
import { workFocusCurrentService } from '../dist/work-focus/index.js';

// The semantic half of this slice's verification, and the half no fake model can reach.
//
// Everything else in `test/` proves *structure*: given that a model decided to call a capability, the
// loop reads it once, refuses a duplicate, keeps the wire batch complete, drops the model's prose, and
// ends. Those are properties of this repository's own control flow, and a scripted model settles them
// completely — it was told what to decide.
//
// What a scripted model cannot settle is whether a *real* model decides the right thing. "The user asked
// what is on screen, so the model reads the desktop" is a claim about semantic selection, and a fake
// that was instructed to emit `desktop_context_read` agrees with it by construction. The only evidence
// for that claim is a real endpoint. This file is where that evidence is collected, and it is skipped by
// default because CI has no endpoint and no credential.
//
//   PowerShell:
//     $env:HIKARI_SEMANTIC_ENDPOINT = 'https://api.example.com/v1/chat/completions'
//     $env:HIKARI_SEMANTIC_MODEL    = 'some-model'
//     $env:HIKARI_SEMANTIC_CREDENTIAL_ENV = 'SOME_API_KEY'     # optional; omit for a local endpoint
//     $env:HIKARI_SEMANTIC_REASONING_EFFORT = 'high'           # optional; omit to send no such field.
//                                                              # 'high' is the value this build is being
//                                                              # taken to production with, and the value
//                                                              # the runs behind the replay decision were
//                                                              # taken under. 'none' is a legitimate run too
//                                                              # — it is the configuration a deployment that
//                                                              # does not want a chain of thought would use —
//                                                              # but a green table collected under 'none' has
//                                                              # not exercised the thinking path at all.
//     node --test test/language-semantic.live.test.mjs
//
// The effort is set here rather than in a request body written for this file. There is one body, in
// `createHttpModel`, and the three variables above land on the same fields the resident's configuration
// lands on — `--model-reasoning-effort` reaches exactly this `reasoningEffort`. A harness holding its
// own copy of the request would be evidence about the harness.
//
// The selection criterion these sentences are judged against is frozen, and it is worth stating in the
// file that applies it, because the intuitive rule is the wrong one:
//
//   The model selects a capability according to whether reading it is *necessary in order to answer the
//   current user intent honestly* — not according to which domain words the sentence contains.
//
// So mentioning the desktop does not mean the desktop needs reading, and a sentence that never says
// "desktop" may still need it. The two negative cases below that name the desktop while asking about its
// architecture are the sharp edge of that rule, and `别看我的桌面，我们聊聊桌面架构。` is sharper still: it
// is an explicit instruction not to read, and a model that reads anyway has failed at instruction
// following even though the read itself has no side effect.
//
// What this file deliberately does not do, per the governing mandate: it does not add a keyword table, a
// domain-specific branch, or a second paraphrase of an owner's description to the system prompt. If a
// real model mis-selects, the first thing to check is whether the owning plugin's own `description` is
// unclear, and any change goes in that owner's file. If the owner's description is clear and a model
// still routes on keywords, the honest conclusion is that the model is unsuitable for this loop's
// selection requirement — not that the architecture should be bent around it.
//
// ── How a run is scored ───────────────────────────────────────────────────────────────────────────
//
// The criterion this file applies is the frozen one, and it is deliberately not "the selected set equals
// the expected set". Three dimensions, and only two of them are failures:
//
//   required    当前意图真正需要的事实。缺一个 = correctness failure。
//   forbidden   用户明确禁止读取的。碰一个 = hard failure，与有无副作用无关。
//   只读的过度读取（over-read）与 semantic detour 记录在表里，不是硬失败。高 reasoning effort 下模型
//               会多读一个它不需要但不被禁止的 capability；这不是边界问题，是优化信号，把两件事混成
//               一个「不符合」会让真正该失败的那一类失去信号。
//
// 唯一不放宽的是 forbidden：`别看我的桌面` 是一句明确的负向指令，读到就失败。
//
// Two things that are not selection verdicts at all and still fail here, because the alternative is a
// green result that means nothing: a transport or protocol failure (no decision was ever reached), and
// `finish_reason = length` (a response cut off before it selected). Both would otherwise read as "the
// model correctly chose nothing" on the four sentences that require nothing.

const ENDPOINT = process.env.HIKARI_SEMANTIC_ENDPOINT;
const MODEL = process.env.HIKARI_SEMANTIC_MODEL;
const CREDENTIAL_ENV = process.env.HIKARI_SEMANTIC_CREDENTIAL_ENV;
const REASONING_EFFORT = process.env.HIKARI_SEMANTIC_REASONING_EFFORT;
const RUNS = Number.parseInt(process.env.HIKARI_SEMANTIC_RUNS ?? '3', 10);

const CONFIGURED = Boolean(ENDPOINT && MODEL);
const SKIP = CONFIGURED
  ? false
  : '需要一个真实 endpoint：设置 HIKARI_SEMANTIC_ENDPOINT 与 HIKARI_SEMANTIC_MODEL 后再跑（见文件抬头）。';

const WORK = 'work_focus_read';
const DESKTOP = 'desktop_context_read';

// ── 受控诊断 ─────────────────────────────────────────────────────────────────────────────────────
//
// Everything below exists for one failure and for nothing else: a run that reaches the endpoint and
// comes back `failed` on every interaction, before any capability selection is observed. The question
// that failure asks is not what the model decided — it never decided — it is what this build actually
// put on the wire and what the endpoint said about it.
//
// The transport keeps the HTTP status and drops the body, and that is a decision with its reason
// written where it is made: an error body is a road to a human, and this build does not read one.
// Rather than widen that decision to serve a diagnostic, the observation happens *outside* it — a
// wrapper around `globalThis.fetch`, which is the same global the transport reaches through. Nothing
// in `src/` changes, so nothing here can become behaviour a resident has, and what is described below
// is the real outgoing JSON rather than a reading of the code that builds it.
//
// Printed, when the first request fails: the status, the provider's own `error.type` / `error.code` /
// `error.param` / `error.message`, and a redacted description of the request that produced it. Never
// printed: the Authorization value, the credential, the system prompt's text, model prose from a
// successful response, or any reasoning content. Message *keys* are printed and message *values* never
// are, which is the structural reason that list holds — there is no path here that reads a message's
// content into the output.
//
// It fires once. Twenty-four identical failures are one fact, and repeating it twenty-four times is
// how the second fact — whatever differs on run two — gets lost in the scroll. `HIKARI_SEMANTIC_DIAGNOSTIC=off`
// disables it for a re-run of the clean gate.
const DIAGNOSTIC = process.env.HIKARI_SEMANTIC_DIAGNOSTIC !== 'off';
const DIST_ROOT = fileURLToPath(new URL('../dist/', import.meta.url));
const SRC_ROOT = fileURLToPath(new URL('../src/', import.meta.url));

let diagnosticPrinted = false;
let lastRequest = null;

function scalar(value) {
  if (value === undefined) return '（没有这个字段）';
  if (value === null) return 'null';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

// The wire shape of one tool, as the provider will read it. `parameters` is printed in full because the
// known-good manual request has one and its *shape* is the thing being compared; it is this build's own
// literal, not anything a model wrote.
function toolShape(tool) {
  const fn = tool?.function ?? {};
  return (
    `    - type=${scalar(tool?.type)}  name=${scalar(fn.name)}` +
    `  function keys=[${Object.keys(fn).sort().join(', ')}]` +
    `  parameters=${Object.hasOwn(fn, 'parameters') ? '有' : '没有'}` +
    `  description 长度=${typeof fn.description === 'string' ? fn.description.length : '（不是字符串）'}` +
    `\n      parameters=${JSON.stringify(fn.parameters ?? null)}`
  );
}

// Everything the mandate asks to see about the request, and nothing it forbids. `init.body` is the
// string `JSON.stringify` produced in the transport, so this is a description of the bytes that went
// out rather than of the object that produced them.
function requestShape(url, init) {
  const headers = new Headers(init?.headers ?? {});
  const authorization = headers.get('authorization');
  const body = JSON.parse(init.body);

  return [
    `  endpoint：${String(url)}`,
    // Presence and scheme, never the value. The third field is a boolean rather than a length for the
    // same reason the first two are worded the way they are: `Bearer ` followed by nothing is a header
    // that exists and is not a credential, and it would otherwise be indistinguishable here from a real
    // one — which is the one shape of "check A passed" that could be wrong.
    `  请求头：[${[...headers.keys()].sort().join(', ')}]` +
      `  authorization=${authorization === null ? '没有' : '有'}` +
      `  方案是 Bearer=${authorization !== null && authorization.startsWith('Bearer ')}` +
      `  凭据非空=${authorization !== null && authorization.slice('Bearer '.length).trim() !== ''}`,
    `  top-level keys：[${Object.keys(body).sort().join(', ')}]`,
    `  model：${scalar(body.model)}`,
    `  reasoning_effort：${
      Object.hasOwn(body, 'reasoning_effort')
        ? `存在，值 ${JSON.stringify(body.reasoning_effort)}`
        : '不存在（请求里没有这个字段）'
    }`,
    `  temperature：${scalar(body.temperature)}`,
    `  tool_choice：${scalar(body.tool_choice)}`,
    `  max_tokens：${scalar(body.max_tokens)}`,
    `  messages（role 与每条 message 的 keys）：`,
    ...body.messages.map(
      (message, index) =>
        `    #${index + 1} ${scalar(message.role)}  keys=[${Object.keys(message).sort().join(', ')}]`,
    ),
    `  tools：`,
    ...body.tools.map(toolShape),
  ];
}

// The provider's structured error, which is the whole point of the probe: it names the field the
// endpoint refused, and "which field" is the difference this run is looking for. `error.message` is the
// provider talking about *our request* — not model prose and not reasoning content — and it is bounded
// rather than trusted, because it is the one string here this repository did not write.
function providerError(status, raw) {
  const lines = [`  HTTP status：${status}`];
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }

  const error = parsed?.error;
  if (error !== null && typeof error === 'object') {
    const message = typeof error.message === 'string' ? error.message.slice(0, 600) : error.message;
    lines.push(`  error.type：${scalar(error.type)}`);
    lines.push(`  error.code：${scalar(error.code)}`);
    lines.push(`  error.param：${scalar(error.param)}`);
    lines.push(`  error.message：${scalar(message)}`);
  } else if (typeof raw === 'string' && raw.trim() !== '') {
    lines.push(`  provider 应答不是 JSON（前 400 字符）：${raw.slice(0, 400)}`);
  } else {
    lines.push('  provider 应答是空的。');
  }
  return lines;
}

const REDACTION_NOTE =
  '（脱敏：不打印 Authorization 的值、不打印 credential、不打印 system prompt 正文、不打印模型输出）';

function printDiagnostic(status, transportError, raw) {
  if (diagnosticPrinted || !DIAGNOSTIC) return;
  diagnosticPrinted = true;

  console.log(`\n===== 第一次失败的请求 ${REDACTION_NOTE} =====`);
  if (lastRequest === null) {
    console.log('  这条请求没能被描述（脱敏过程本身出错，见下方 stderr）。');
  } else {
    for (const line of lastRequest) console.log(line);
  }
  console.log('  ── provider 的应答 ──');
  for (const line of status === null ? [`  没有拿到 HTTP 应答：${scalar(transportError)}`] : providerError(status, raw)) {
    console.log(line);
  }
  console.log('');
}

function installDiagnostic() {
  if (!DIAGNOSTIC) return;
  const real = globalThis.fetch;

  globalThis.fetch = async function diagnosedFetch(url, init) {
    try {
      lastRequest = requestShape(url, init);
    } catch (error) {
      lastRequest = null;
      console.error('诊断无法描述这条请求：', error);
    }

    let response;
    try {
      response = await real.call(globalThis, url, init);
    } catch (error) {
      printDiagnostic(null, error, null);
      throw error;
    }

    if (!response.ok) {
      // Read off a copy, so the response the transport receives is the one the endpoint sent. The
      // transport will discard this body unread; reading it here is what turns a bare status code into
      // a named field.
      let raw = null;
      try {
        raw = await response.clone().text();
      } catch {
        raw = null;
      }
      printDiagnostic(response.status, null, raw);
    }
    return response;
  };
}

// Which modules this file imported, and whether the current `src/` still compiles to them. A harness
// running a stale `dist` would report `failed` for a reason that has nothing to do with the change under
// test — and, worse, would answer "does the request carry the new field" with evidence about the old
// build. The mtime comparison is a heuristic and is reported as one; the request shape above is the
// decisive answer, because it is read off the bytes that actually went out.
function staleModules() {
  const pairs = [
    ['language/model.js', 'language/model.ts'],
    ['language/plugin.js', 'language/plugin.ts'],
    ['language/answer.js', 'language/answer.ts'],
  ];
  const stale = [];
  for (const [dist, src] of pairs) {
    try {
      if (statSync(join(DIST_ROOT, dist)).mtimeMs < statSync(join(SRC_ROOT, src)).mtimeMs) {
        stale.push(dist);
      }
    } catch {
      stale.push(`${dist}（读不到，可能还没有 build）`);
    }
  }
  return stale;
}

/**
 * The eight sentences, and what reading each one needs, forbids, or merely tempts.
 *
 * `required` is what the intent cannot be answered honestly without — missing one is a correctness
 * failure. `forbidden` is what the human explicitly said not to read — reading it fails regardless of
 * whether the read has a side effect. `detour` marks the sentences that need nothing at all, where any
 * read is recorded as a semantic detour rather than scored as a failure.
 *
 * There is deliberately no `exact` set here. A model reading one capability more than it needed has
 * over-read, not broken a boundary, and the record shows it — the row is printed either way. What is not
 * negotiable is `forbidden`, and it is the one sentence in this table where "read anyway" is the failure
 * rather than a cost.
 */
const SENTENCES = Object.freeze([
  { text: '你现在看到什么？', required: [DESKTOP], forbidden: [], detour: false, why: '问的是屏幕上的东西，只有桌面能回答' },
  { text: '我现在关注什么？', required: [WORK], forbidden: [], detour: false, why: '问的是明确声明的关注对象，只有工作焦点能回答' },
  { text: '现在前台是什么？', required: [DESKTOP], forbidden: [], detour: false, why: '前台是桌面感知的一部分，不需要工作焦点' },
  { text: '我现在明确关注的项目是什么？', required: [WORK], forbidden: [], detour: false, why: '「明确关注」是工作焦点的用词，不需要桌面' },
  { text: '桌面感知是怎么实现的？', required: [], forbidden: [], detour: true, why: '问的是实现，不是这台机器现在的状态' },
  { text: 'Work Focus 为什么这么设计？', required: [], forbidden: [], detour: true, why: '问的是设计理由，Hikari 没有任何能力保存它' },
  {
    text: '别看我的桌面，我们聊聊桌面架构。',
    required: [],
    forbidden: [DESKTOP],
    detour: false,
    why: '这是明确的负向指令：即使 peek 没有副作用，也不得读取',
  },
  { text: '最近写 Hikari 写麻了。', required: [], forbidden: [], detour: true, why: '一句闲话，不是关于这台机器的问题' },
]);

function assessmentFixture() {
  // A fixed reading rather than the machine's own. What is under test is which capability the model
  // *chooses*; giving both capabilities a value that is obviously a fixture keeps a screenshot of this
  // machine from being mistaken for evidence about selection.
  const at = '2026-02-01T08:30:00.000Z';
  return {
    kind: 'baseline',
    current: {
      snapshotAt: at,
      foreground: {
        kind: 'available',
        observation: {
          observedAt: at,
          source: 'foreground.windows',
          foreground: { kind: 'present', title: '语义验证用的假标题', processName: 'semantic-probe' },
        },
      },
      inputActivity: {
        kind: 'available',
        observation: { observedAt: at, source: 'input-activity.windows', lastInputTick: 1 },
      },
    },
  };
}

/**
 * One run of one sentence, with everything a reader of the result needs to judge the selection.
 *
 * `requested` and `performed` are deliberately separate. `requested` is what the model asked for, which
 * is the thing being judged; `performed` is what this build actually read, which is what a claim about
 * Service reads has to be based on. A model that asks for a capability the loop refuses shows up as a
 * difference between the two rather than as a silently empty `performed`.
 *
 * `requested` is read off what `model.step` *returns*, which is the only place the choice exists before
 * `tools.ts` has had its say. Reading it back out of the next request's messages instead — which is what
 * this file did at first — misses exactly the case it exists for: the loop stops after a batch it
 * refuses, so that batch's assistant message is never sent anywhere and a model that asked for the
 * desktop while being told not to would be recorded as having asked for nothing.
 */
async function run(text) {
  const performed = [];
  const requested = [];
  const reads = { focus: 0, peek: 0 };
  const reasoningLengths = [];
  let steps = 0;
  let truncated = false;

  const reader = createExposureReader({
    async readFocus() {
      reads.focus += 1;
      return Object.freeze(['语义验证用的假关注对象']);
    },
    async peek() {
      reads.peek += 1;
      return assessmentFixture();
    },
  });

  const model = createHttpModel({
    endpoint: ENDPOINT,
    model: MODEL,
    credential: CREDENTIAL_ENV === undefined ? undefined : process.env[CREDENTIAL_ENV],
    // The same connection the resident builds, and the same field `--model-reasoning-effort` fills.
    reasoningEffort: REASONING_EFFORT,
  });

  const answerer = createAnswerer({
    async step(request) {
      steps += 1;
      const step = await model.step(request);
      // Recorded off what the model returned, so a batch the loop refuses is in the record too. Only the
      // *names* are kept: the model's prose is exactly what this surface exists to keep out of the
      // record, and the system prompt and tool results are this build's own text and carry no selection
      // evidence.
      for (const call of step.toolCalls) requested.push(call.name);
      // Whether a thinking endpoint produced a chain of thought, and how long it was. The *length* and
      // never the text: this file's redaction list is about what it prints, and a length is enough to
      // show that the replay below had something to replay. A run with no chain of thought at all is not
      // a failure here — the effort is configuration, and `none` is a legitimate one — but it is a fact
      // the table has to show, because a zero in every reasoning column means the thinking path was
      // never exercised no matter how green the selection rows are.
      if (step.reasoningContent !== undefined) reasoningLengths.push(step.reasoningContent.length);
      if (step.truncated) truncated = true;
      return step;
    },
    read: async (exposure) => {
      performed.push(exposure.name);
      return reader(exposure);
    },
    now: () => new Date().toISOString(),
    // The base set, which is the surface this harness measures — the coverage test below asserts the
    // same list, so the sentences and the tool schema cannot diverge about which capabilities exist.
    // Passed rather than defaulted: the loop takes its closed set from its caller, and a default here
    // would be a second place the variant is decided. See `answer.ts`.
    exposures: LANGUAGE_EXPOSURES,
  });

  try {
    const reply = await answerer.answer(text);
    return {
      text,
      requested,
      performed,
      reads,
      outcome: reply.outcome,
      steps,
      reasoningLengths,
      truncated,
      // Kept only for the two outcomes whose lines are not the model's words. `answered` is the owner's
      // renderer output — the model cannot reach it, which is the property the determinism check below
      // asserts — and `failed` is a thrown error's message this repository wrote. `chatted` is the one
      // outcome whose lines *are* model prose, and it is deliberately not kept: this surface exists to
      // keep model text out of the record, and a chat reply is the whole of what the model said.
      lines: reply.outcome === 'chatted' ? null : reply.lines,
      // Kept only for a failure, where the lines are this repository's own message about what broke.
      failure: reply.outcome === 'failed' ? reply.lines.join(' ') : null,
    };
  } finally {
    model.dispose();
  }
}

const sorted = (names) => [...names].sort();

// An empty set printed as an empty bracket pair reads as a missing value rather than as a requirement of
// nothing, and four of the eight sentences require nothing.
const orNone = (names) => (names.length === 0 ? '（无）' : names.join(', '));

/**
 * One run, on the three dimensions the frozen criterion names — plus the two facts that are not selection
 * verdicts at all.
 *
 * `selected` is what was *read*, and the dimensions are computed from it: missing required is a
 * correctness failure, a forbidden name is a hard failure, and anything else read is an over-read. The
 * `requested` list is consulted for one thing only — a model that asked for a forbidden capability and
 * was refused by the loop has still chosen to cross the boundary the human drew, and the refusal is this
 * build's guard rather than evidence about the model.
 *
 * `kind` keeps a run that never reached a decision apart from one that decided to read nothing, and the
 * distinction is load-bearing on the four sentences requiring nothing: a transport failure or a
 * truncated response carries no selection, and scoring either as "chose nothing" would mint a pass out of
 * a failure.
 */
function classify(sentence, result) {
  const selected = sorted(new Set(result.performed));
  const requested = sorted(new Set(result.requested));
  const required = sorted(sentence.required);
  const forbidden = sorted(sentence.forbidden);

  if (result.outcome === 'failed') {
    return { kind: 'failed', selected, requested, missing: null, forbiddenHit: null, overRead: null, detour: null };
  }
  if (result.truncated) {
    return { kind: 'truncated', selected, requested, missing: null, forbiddenHit: null, overRead: null, detour: null };
  }

  const missing = required.filter((name) => !selected.includes(name));
  // Asked-for counts, not only read. The loop refuses a call it will not perform, so `performed` alone
  // would report a model that tried to read the forbidden desktop as having read nothing — the one
  // reading of this sentence that must not be possible.
  const forbiddenHit = forbidden.filter(
    (name) => selected.includes(name) || requested.includes(name),
  );

  return {
    kind: 'selection',
    selected,
    requested,
    missing,
    forbiddenHit,
    // What was read beyond what was needed, excluding what was read against an instruction. 一次读取只进
    // 一个桶：#7 的读取已经是 forbidden violation，再记成 over-read 会让同一个事实在表上出现两次，而
    // over-read 那一列的用途是看清「模型多读了一个它没被禁止的东西」这类优化信号。
    overRead: selected.filter((name) => !required.includes(name) && !forbidden.includes(name)),
    detour: sentence.detour && selected.length > 0,
  };
}

/**
 * Whether a classified run is a failure, and there are exactly three ways to be one: no decision was
 * reached, a required read is missing, or a forbidden capability was read or asked for. Over-reads and
 * detours are recorded in the table and are not failures — see the note at the top of the file.
 */
function isFailure(verdict) {
  return (
    verdict.kind !== 'selection' ||
    verdict.missing.length > 0 ||
    verdict.forbiddenHit.length > 0
  );
}

/** The owner's own rendering of what was read, in read order — what a grounded answer must equal. */
function expectedAnswer(result) {
  const lines = [];
  for (const name of result.performed) {
    // Not model prose and not a paraphrase: the same arrays the loop hands a human, so this is an
    // equality between the answer and the owners' renderers rather than between an answer and a copy of
    // it written here.
    if (name === WORK) lines.push(...renderFocus(['语义验证用的假关注对象']));
    else if (name === DESKTOP) lines.push(...renderAssessment(assessmentFixture()));
  }
  return lines;
}

function describe(runResult) {
  return (
    `  outcome=${runResult.outcome}` +
    `  requested=[${runResult.requested.join(', ')}]` +
    `  performed=[${runResult.performed.join(', ')}]` +
    `  serviceReads={focus:${runResult.reads.focus}, peek:${runResult.reads.peek}}` +
    // The one line that says *why* nothing was selected. Without it a `failed` row reports the absence
    // of a decision and withholds the reason, which is the state this diagnostic was added to end.
    //
    // Deliberately outside the `HIKARI_SEMANTIC_DIAGNOSTIC` switch, because it is not the probe: the
    // probe is a wrapper around the network, and this is a value the table was already handed and threw
    // away. Turning the probe off must leave the reason readable, or the switch would take away the
    // finding along with the instrument.
    (runResult.failure === null ? '' : `\n      失败原因：${runResult.failure}`)
  );
}

test(
  '真实 endpoint 的语义选择：8 句话，每句独立 3 次',
  { skip: SKIP, timeout: 15 * 60 * 1000 },
  async (t) => {
    const rows = [];

    // Installed before the first request goes out, because it observes requests rather than replaying
    // them: a probe that ran afterwards would be describing a run that had already happened.
    installDiagnostic();

    // The request shape these runs are evidence about, printed before the first one goes out. A
    // selection result means nothing without it: the same 24 runs against a model that was reasoning by
    // default would be evidence about a different request than the one this build sends.
    const stale = staleModules();
    console.log(
      `端点：${ENDPOINT}\n模型：${MODEL}\nreasoning_effort：${REASONING_EFFORT ?? '（不带这个字段）'}\n每句次数：${RUNS}` +
        `\ndist 里比 src 旧的模块：${stale.length === 0 ? '没有' : stale.join(', ')}（先 npm run build）` +
        `\n诊断：${DIAGNOSTIC ? '开' : '关（HIKARI_SEMANTIC_DIAGNOSTIC=off）'}`,
    );

    for (const sentence of SENTENCES) {
      const results = [];
      for (let attempt = 0; attempt < RUNS; attempt += 1) {
        results.push(await run(sentence.text));
      }
      rows.push({ sentence, results });

      // Printed as it goes, because this is an operator-run evidence-collection pass and a run that dies
      // on the sixth sentence should still leave the first five on the screen. The report below repeats
      // it in full.
      console.log(
        `\n「${sentence.text}」  必须读到：[${orNone(sentence.required)}]` +
          (sentence.forbidden.length === 0 ? '' : `  禁止读取：[${sentence.forbidden.join(', ')}]`) +
          `  —— ${sentence.why}`,
      );
      for (const [attempt, result] of results.entries()) {
        console.log(`  #${attempt + 1}${describe(result)}`);
      }
    }

    // Whether this run exercised the path the slice is about. A table of green selection rows collected
    // without a single chain of thought is a table about the non-thinking path, and the reasoning replay
    // would have had nothing to replay on any of the twenty-four runs.
    const reasoningSteps = rows.reduce(
      (total, { results }) => total + results.reduce((sum, result) => sum + result.reasoningLengths.length, 0),
      0,
    );
    const totalSteps = rows.reduce(
      (total, { results }) => total + results.reduce((sum, result) => sum + result.steps, 0),
      0,
    );
    console.log(
      `\n推理链（reasoning_content）：${reasoningSteps}/${totalSteps} 次模型请求带回了它（只记长度，不记内容）` +
        `；reasoning_effort=${REASONING_EFFORT ?? '（不带这个字段）'}，max_tokens=4096（production 值）`,
    );

    console.log('\n===== 汇总 =====');
    const failures = [];
    const recorded = [];
    for (const { sentence, results } of rows) {
      const verdicts = results.map((result) => classify(sentence, result));
      const failedIndexes = verdicts.flatMap((verdict, index) => (isFailure(verdict) ? [index] : []));
      const overReads = verdicts.filter((verdict) => verdict.overRead?.length > 0).length;
      const detours = verdicts.filter((verdict) => verdict.detour === true).length;
      const truncations = verdicts.filter((verdict) => verdict.kind === 'truncated').length;

      console.log(
        `${failedIndexes.length === 0 ? 'PASS' : 'FAIL'}  「${sentence.text}」` +
          `  必须读到 [${orNone(sentence.required)}]` +
          (sentence.forbidden.length === 0 ? '' : `  禁止 [${sentence.forbidden.join(', ')}]`) +
          `  过度读取 ${overReads}/${RUNS}` +
          (sentence.detour ? `  语义绕道 ${detours}/${RUNS}` : '') +
          (truncations === 0 ? '' : `  被截断 ${truncations}/${RUNS}`),
      );

      if (failedIndexes.length > 0) {
        failures.push({ sentence, failedIndexes });
        for (const index of failedIndexes) console.log(`        实际${describe(results[index])}`);
      }
      // Recorded, not failed. Printed with the run it belongs to so the signal is actionable rather than
      // a count: an operator can see *which* capability the model reached for unnecessarily.
      if (overReads > 0 || detours > 0) recorded.push({ sentence, overReads, detours });
    }

    for (const { sentence, failedIndexes } of failures) {
      t.diagnostic(`语义选择不符：「${sentence.text}」（${failedIndexes.length}/${RUNS} 次）`);
    }
    for (const { sentence, overReads, detours } of recorded) {
      t.diagnostic(
        `记录（不是失败）：「${sentence.text}」 过度读取 ${overReads}/${RUNS}，语义绕道 ${detours}/${RUNS}`,
      );
    }

    // The assertions, after the whole table has been printed. A run that fails prints its evidence first
    // — the failure is a fact about the model, and the operator needs the table to act on it.
    for (const { sentence, results } of rows) {
      for (const [attempt, result] of results.entries()) {
        const where = `「${sentence.text}」第 ${attempt + 1} 次`;
        const verdict = classify(sentence, result);

        // Before the selection checks, because they cannot see this: a `failed` run performed nothing and
        // requested nothing, so it would satisfy both of them for the four sentences requiring nothing.
        assert.notEqual(result.outcome, 'failed', `${where}：模型没有答上来，这一行不构成选择证据`);
        assert.ok(
          !result.truncated,
          `${where}：应答被 max_tokens 截断（finish_reason = length），这一行同样不构成选择证据`,
        );

        assert.deepEqual(verdict.missing, [], `${where}：必须读到的没有读到`);
        // The one criterion the mandate does not relax, and it counts a refused call as well as a
        // performed one — a model that asked for the forbidden capability has crossed the line whatever
        // this build then did about it.
        assert.deepEqual(
          verdict.forbiddenHit,
          [],
          `${where}：读取或要求了明确被禁止的 capability（performed=[${result.performed.join(', ')}] requested=[${result.requested.join(', ')}]）`,
        );

        // The claim this slice's second half rests on: a grounded answer is the owners' rendering of what
        // was read, and nothing else. Checked against the same renderers a human's terminal goes through,
        // so this is not a copy of the expected answer written here — it is the answer, recomputed.
        if (result.outcome === 'answered') {
          assert.deepEqual(
            result.lines,
            expectedAnswer(result),
            `${where}：grounded 回答不等于「已读取内容的确定性渲染」，模型的话可能漏进了回答`,
          );
        }
      }
    }

    // Reached only when every sentence met the frozen criterion on every run. Stated so that the terminal
    // says something unambiguous rather than leaving a silent pass to be interpreted.
    console.log('\n全部 8 句符合冻结的语义选择准则（required 齐全、forbidden 未触碰）。');
  },
);

// A guard against the harness being run with a configuration that would make the result meaningless,
// and against the exposure set having grown without this file noticing: the sentences above name the
// two capabilities by hand, and a third would make the required sets above silently incomplete.
//
// `required` and `forbidden` together, not `required` alone. A capability covered only as something not
// to read is still covered — that is exactly what sentence #7 is — and a guard that demanded a positive
// requirement from every exposure would red on a table that is complete.
test('语义验证的句子覆盖了当前全部 capability', () => {
  const named = new Set(SENTENCES.flatMap((sentence) => [...sentence.required, ...sentence.forbidden]));
  for (const exposure of LANGUAGE_EXPOSURES) {
    assert.ok(
      named.has(exposure.name),
      `${exposure.name} 没有被任何一句话覆盖，语义验证的期望集合已经不完整`,
    );
  }
  assert.deepEqual(
    LANGUAGE_EXPOSURES.map((exposure) => exposure.name).sort(),
    [WORK, DESKTOP].sort(),
  );
  // And the two Service contracts the harness stubs are the two the plugin requires, so a third
  // dependency would fail here rather than being quietly left unread by every sentence.
  assert.equal(typeof workFocusCurrentService.id, 'string');
  assert.equal(typeof desktopSessionAwarenessPeekService.id, 'string');
  // The renderers, imported so that a change to either is a compile-time break in this file rather than
  // a stale expectation in the table above.
  assert.ok(renderFocus(['x']).length > 0);
  assert.ok(renderAssessment(assessmentFixture()).length > 0);
});
