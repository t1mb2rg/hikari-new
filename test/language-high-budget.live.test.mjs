import assert from 'node:assert/strict';
import test from 'node:test';

import { LANGUAGE_EXPOSURES, createAnswerer } from '../dist/language/index.js';
import { createHttpModel } from '../dist/language/model.js';

// A single-variable A/B on the *output budget* at one fixed reasoning depth, and on nothing else.
//
// ── HISTORICAL EXPERIMENT — 前提已移动（2026-09），**现在跑它会失败，而且是按设计失败** ──────────────
//
// 本文件保持原样，作为一次 A/B 的记录。两个前提都动了：
//
//   1. 本文件绕过的那道墙（「thinking 下不 replay `reasoning_content`，所以两轮 thinking 对话是在测一个
//      此构建没有的协议」）已经不存在：interaction 内原样 transient replay 已实现，真实端点门禁 PASS
//      （`docs/development/language-tool-use-loop-v1.md` §15 / §15.8）。
//   2. A 臂取的是「生产的 `MODEL_MAX_TOKENS`」，当时是 512。生产现在是 **4096**（§15），所以文件末尾那条
//      「production 必须还是 512」的断言会触发，并明确报出前提变了——那正是它被写下来的用途。
//
// 所以：**不要把 production 改回 512 去满足本文件**，也不要顺手改这里或那里的断言去让它变绿。它作为
// 512 vs 4096 在 `high` 下的一次选择对照仍然成立；读结论，不要把它当作当前生产的描述。
//
// The question: the depth matrix left one open item at `reasoning_effort: "high"` — a response that ended
// with `finish_reason = length`. Everything else in that column was clean, so the one thing to find out
// is whether the truncation was the budget rather than the model's selection, and whether raising the
// budget pays for itself or costs something elsewhere.
//
//   A:  reasoning_effort = high   max_tokens = 512    （生产的 MODEL_MAX_TOKENS）
//   B:  reasoning_effort = high   max_tokens = 4096
//
// So this file observes one step and stops:
//
//   user → system prompt + tools → deepseek-flash → first response → 记录 → 结束
//
// It does not execute a Service, does not replay a tool result, does not send a second request, and
// produces no grounded answer. The reason is not convenience: a thinking response carries
// `reasoning_content`, and the loop deliberately does not parse, store or replay it, so a full two-turn
// thinking conversation would be an experiment about a protocol this build does not have. The first
// selection is one request in both arms, so it is the part of the question that can be asked cleanly.
//
// ── The one thing this file does that the depth matrix did not ───────────────────────────────────
//
// `max_tokens` is not a field of `LanguageModelConnection`. It is the module-private constant
// `MODEL_MAX_TOKENS = 512` in `src/language/model.ts`, written into the body at the point the body is
// built, and it is deliberately not configurable: a knob nobody asked for is how a configuration
// surface becomes an architecture. So the 4096 arm is produced **at the fetch layer**, by the same
// wrapper that already observes this experiment — it parses the outgoing body, records the
// `max_tokens` production put there, replaces that one key, and re-serializes.
//
// That is a real deviation and it is reported as one rather than hidden: every observation records
// both the production value and the value that actually went out, the report prints both, and the
// arms are asserted to agree on every other field of the body. `src/` is not touched, and an assertion
// checks that production still says 512 in both arms — so if someone later changes `MODEL_MAX_TOKENS`,
// this file fails and says the experiment's premise moved rather than quietly measuring a new one.
//
// Everything else is held identical the same way the depth matrix held it: by *not restating any of
// it*. The system prompt, the exposure set, and the native tool schema all come from the same
// production code the resident runs, reached through `createAnswerer`'s `step` dependency — the loop
// builds them and hands them over. Nothing about the request is written down a second time in this
// file, so nothing here can drift from what Hikari actually sends. The only things this harness
// chooses are the sentence, the effort, and the one key it rewrites.
//
// ── Four separate readings, never one score ──────────────────────────────────────────────────────
//
//   Required Read      当前意图确实需要的事实读到了没有。缺失 = correctness failure。
//   Forbidden Read     用户明确禁止的 capability 被碰了没有。碰了 = hard failure，即使它只读、无副作用。
//   Over-read          不是必需、但被额外读取的只读 capability。不是 hard failure，但必须记录：
//                      grounded loop 一旦读到 capability 就可能进入 deterministic grounded answer，
//                      所以一次无关读取仍可能变成 semantic detour / response derail。
//
// 加上 finish_reason、reasoning_content 的存在与长度、以及延迟。
//
// 一个 capability 是否「该被选择」，判据是**读它是不是诚实回答当前用户意图所必需**，而不是这句话里
// 出现了哪个领域词。
//
//   PowerShell:
//     $env:HIKARI_SEMANTIC_ENDPOINT = 'https://<endpoint>/chat/completions'
//     $env:HIKARI_SEMANTIC_MODEL    = 'deepseek-flash'
//     $env:HIKARI_SEMANTIC_CREDENTIAL_ENV = '<存 key 的环境变量名>'
//     node --test test/language-high-budget.live.test.mjs
//
// Roughly 20 minutes: 48 first-turn requests, all of them carrying a reasoning budget.
//
// What this harness deliberately does not do, and the list is the mandate's: it does not change an owner
// description, the language system prompt, a tool name, the model, the temperature strategy, or any
// test's expected result. It adds no keyword rule, no domain branch, no router and no registry. It does
// not touch `MODEL_MAX_TOKENS`, and it does not put 4096 anywhere in `src/`. It draws no product
// conclusion and does not propose a production default.

const ENDPOINT = process.env.HIKARI_SEMANTIC_ENDPOINT;
const MODEL = process.env.HIKARI_SEMANTIC_MODEL;
const CREDENTIAL_ENV = process.env.HIKARI_SEMANTIC_CREDENTIAL_ENV;
const RUNS = Number.parseInt(process.env.HIKARI_SEMANTIC_RUNS ?? '3', 10);

const CONFIGURED = Boolean(ENDPOINT && MODEL);
const SKIP = CONFIGURED
  ? false
  : '需要一个真实 endpoint：设置 HIKARI_SEMANTIC_ENDPOINT 与 HIKARI_SEMANTIC_MODEL 后再跑（见文件抬头）。';

// The production constant this experiment is *about*, quoted so the report can show the two numbers
// side by side and so the assertion below can notice if it moves.
const PRODUCTION_MAX_TOKENS = 512;

/** The two arms. `reasoningEffort` is the same in both; the budget is the whole of the variable. */
const ARMS = Object.freeze([
  { label: 'high@512', reasoningEffort: 'high', maxTokens: PRODUCTION_MAX_TOKENS },
  { label: 'high@4096', reasoningEffort: 'high', maxTokens: 4096 },
]);

// The client-side bound this harness gives each request, and why it is not the production one.
//
// `MODEL_TIMEOUT_MS` is 15 s, and a thinking response — especially one with four times the output
// budget — can easily take longer. Leaving it in place would make this experiment two variables rather
// than one: an arm that is cut off by a clock is not an arm that chose differently, and every timeout
// would arrive here as "the model selected nothing", which is the same empty result the negative
// sentences are supposed to be able to produce honestly. So the bound is widened, every request is
// timed, and the report says how many exceeded the production limit. That is strictly more information
// than the production bound would have given, not less — and it is an experiment bound, not a proposal
// about production policy.
const HARNESS_TIMEOUT_MS = 180_000;
const PRODUCTION_TIMEOUT_MS = 15_000;

const WORK = 'work_focus_read';
const DESKTOP = 'desktop_context_read';

/** `D` / `W` for the two capabilities, so a two-column table of three runs each stays readable. */
const CODE = Object.freeze({ [WORK]: 'W', [DESKTOP]: 'D' });

/**
 * The eight sentences, verbatim from the frozen criterion, with the classification each one carries.
 *
 * required / forbidden / exact are three independent readings, so all three are stated on every row:
 * `required` 判定正确性，`exact` 判定是否正好相等，因此「required satisfied = YES 而 exact = NO」
 * （#1 同时取走两个 capability）是一个能被表达出来的结果，不是一个被折进布尔量的东西。
 *
 * `detour` 标记「本来就不需要当前事实」的句子：在这些句子上发生的任何读取都记进 semantic-detour。
 * #7 的读取**不**计进 detour，它已经单独记成 forbidden violation / over-read，一次读取只进一个桶。
 *
 * Spelled out here rather than imported, for the reason the other two live harnesses give: the only file
 * that holds it is another live test, and importing a `.test.mjs` would run its tests. This is now the
 * third copy of the same frozen table — the duplication is between experiment harnesses that each
 * hardcode it, not between a test and the code it tests. The exposure set itself is imported and
 * guarded below, so a third capability cannot appear without this file failing.
 */
const SENTENCES = Object.freeze([
  {
    text: '你现在看到什么？',
    required: [DESKTOP],
    forbidden: [],
    exact: [DESKTOP],
    detour: false,
  },
  {
    text: '我现在关注什么？',
    required: [WORK],
    forbidden: [],
    exact: [WORK],
    detour: false,
  },
  {
    text: '现在前台是什么？',
    required: [DESKTOP],
    forbidden: [],
    exact: [DESKTOP],
    detour: false,
  },
  {
    text: '我现在明确关注的项目是什么？',
    required: [WORK],
    forbidden: [],
    exact: [WORK],
    detour: false,
  },
  {
    text: '桌面感知是怎么实现的？',
    required: [],
    forbidden: [],
    exact: [],
    detour: true,
  },
  {
    text: 'Work Focus 为什么这么设计？',
    required: [],
    forbidden: [],
    exact: [],
    detour: true,
  },
  {
    text: '别看我的桌面，我们聊聊桌面架构。',
    required: [],
    forbidden: [DESKTOP],
    exact: [],
    detour: false,
  },
  {
    text: '最近写 Hikari 写麻了。',
    required: [],
    forbidden: [],
    exact: [],
    detour: true,
  },
]);

// ── The wire observation, and the one rewrite ────────────────────────────────────────────────────
//
// The transport parses a response into a `ModelStep`, and a `ModelStep` is deliberately narrow: prose,
// tool calls, truncation. `reasoning_content` is not in it and must not be — the loop does not own a
// reasoning trace — and `finish_reason` is not in it either, only the `truncated` boolean derived from
// it. So both of those can only be read from the response body, outside the parser.
//
// The same wrapper does the budget rewrite, and the two concerns are kept visibly apart: it records
// what production built *before* it changes anything, so "what production would have sent" and "what
// this experiment sent" are two recorded facts rather than one inferred one.
let wire = [];

/** The budget the current observation wants on the wire. Set per run, read by the wrapper. */
let currentMaxTokens = null;

function installWire() {
  const real = globalThis.fetch;

  globalThis.fetch = async function observedFetch(url, init) {
    const startedAt = performance.now();
    const record = {
      status: null,
      error: null,
      elapsedMs: 0,
      productionMaxTokens: null,
      sentMaxTokens: null,
      sentShape: null,
      finishReason: null,
      reasoningPresent: false,
      reasoningLength: 0,
      messageKeys: null,
      bodyToolNames: null,
    };
    wire.push(record);

    let body = null;
    try {
      body = JSON.parse(init?.body ?? 'null');
    } catch {
      body = null;
    }

    if (body !== null) {
      // What production built, recorded before a single key is touched.
      record.productionMaxTokens = body.max_tokens ?? null;

      // The one rewrite. Assigning one key on the parsed object, so nothing else in the body can move:
      // the rest of the object is the same reference it was, and re-serializing is the only step that
      // touches it.
      if (body.max_tokens !== currentMaxTokens) {
        body.max_tokens = currentMaxTokens;
        init = { ...init, body: JSON.stringify(body) };
      }

      // Read back off the body that is actually going out, never off the arm's own argument.
      record.sentMaxTokens = body.max_tokens ?? null;
      record.sentShape = {
        model: body.model,
        reasoning_effort: body.reasoning_effort ?? '（不带这个字段）',
        temperature: body.temperature,
        tool_choice: body.tool_choice,
        max_tokens: body.max_tokens,
        topLevelKeys: Object.keys(body).sort().join(','),
        messageCount: Array.isArray(body.messages) ? body.messages.length : null,
        messageKeys: Array.isArray(body.messages)
          ? body.messages.map((message) => Object.keys(message).sort().join('+')).join(' | ')
          : null,
        toolNames: Array.isArray(body.tools)
          ? body.tools.map((tool) => tool?.function?.name ?? '（没有 name）').join(',')
          : null,
      };
    }

    let response;
    try {
      response = await real.call(globalThis, url, {
        ...init,
        signal: AbortSignal.timeout(HARNESS_TIMEOUT_MS),
      });
    } catch (error) {
      record.error = error instanceof Error ? error.message : String(error);
      record.elapsedMs = performance.now() - startedAt;
      throw error;
    }

    record.status = response.status;
    record.elapsedMs = performance.now() - startedAt;

    let parsed = null;
    try {
      parsed = JSON.parse(await response.clone().text());
    } catch {
      parsed = null;
    }

    const choice = parsed?.choices?.[0];
    const message = choice?.message;
    // Key names only, so that a provider which carries the trace under some other spelling is visible
    // as a missing field rather than as a silent "thinking did not happen".
    record.messageKeys =
      message !== null && typeof message === 'object' ? Object.keys(message).sort() : null;

    record.finishReason = choice?.finish_reason ?? null;

    const reasoning = message?.reasoning_content;
    record.reasoningPresent = reasoning !== undefined && reasoning !== null;
    record.reasoningLength = typeof reasoning === 'string' ? reasoning.length : 0;

    const calls = message?.tool_calls;
    record.bodyToolNames = Array.isArray(calls)
      ? calls.map((call) => call?.function?.name ?? '（没有 name）')
      : null;

    // `parsed` and `message` go out of scope here, and nothing that outlives this function holds the
    // body. The trace is measured and dropped in the same breath; there is no object in this process a
    // later `console.log` could reach.
    return response;
  };
}

// A sentinel, so the single step this harness wants is also the only step it takes. Thrown from the
// `step` dependency, it unwinds the loop before any Service is read and before any second request — the
// loop's own error path turns it into a `failed` outcome, which is expected here and is *not* a finding
// about the model. A real transport failure is distinguishable: it throws from `model.step` first, and
// lands in `wire` as a status or an error.
const STOP_AFTER_FIRST_TURN = new Error('实验：只观察第一轮，主动停止。');

/**
 * One first-turn selection: one sentence, one arm, one request, then stop.
 *
 * Returns what the mandate asks a run to record and nothing else. The reasoning text and the model's
 * prose are not returned because they are never read into a variable that outlives the measurement.
 */
async function firstSelection(text, arm) {
  wire = [];
  currentMaxTokens = arm.maxTokens;
  const model = createHttpModel({
    endpoint: ENDPOINT,
    model: MODEL,
    credential: CREDENTIAL_ENV === undefined ? undefined : process.env[CREDENTIAL_ENV],
    reasoningEffort: arm.reasoningEffort,
  });

  let requested = [];
  let truncated = false;
  let parseError = null;

  try {
    const answerer = createAnswerer({
      async step(request) {
        // The production request, built by the production loop from the production exposure set — with
        // one key rewritten at the fetch layer below.
        let step;
        try {
          step = await model.step(request);
        } catch (error) {
          // A 200 whose body production will not accept is not a selection either. Recording it as a
          // parse failure rather than letting `requested` stay empty is what keeps "the response was
          // unusable" from being reported as "the model chose nothing".
          parseError = error instanceof Error ? error.message : String(error);
          throw error;
        }
        requested = step.toolCalls.map((call) => call.name);
        truncated = step.truncated;
        throw STOP_AFTER_FIRST_TURN;
      },
      // Never reached — the step above unwinds the loop first — and it throws if that ever stops being
      // true. A harness that could read a Service would be measuring a loop rather than a selection.
      read: async () => {
        throw new Error('本实验不读取任何 Service。');
      },
      now: () => new Date().toISOString(),
      // The base set, and it is what makes this the same request production sends: both arms rewrite
      // exactly one key of the body, so the tool schema has to be the production one. Passed rather
      // than defaulted — the loop takes its closed set from its caller, and a default would be a second
      // place the variant is decided.
      exposures: LANGUAGE_EXPOSURES,
    });

    await answerer.answer(text);
  } finally {
    model.dispose();
    currentMaxTokens = null;
  }

  const record = wire[0] ?? null;

  // A response that never arrived, arrived with a failure status, or arrived in a shape the transport
  // will not accept. All three mean the same thing for this experiment — there is no selection to read —
  // and none of them may be reported as an empty selection.
  const transport =
    record === null
      ? '没有发出请求'
      : record.error !== null
        ? `没有应答：${record.error}`
        : record.status !== 200
          ? `HTTP ${record.status}`
          : parseError !== null
            ? `应答无法解析：${parseError}`
            : null;

  return {
    text,
    arm: arm.label,
    requested,
    requestCount: wire.length,
    transport,
    truncated:
      record === null ? false : parseError === null ? truncated : record.finishReason === 'length',
    finishReason: record?.finishReason ?? null,
    productionMaxTokens: record?.productionMaxTokens ?? null,
    sentMaxTokens: record?.sentMaxTokens ?? null,
    sentShape: record?.sentShape ?? null,
    bodyToolNames: record?.bodyToolNames ?? null,
    elapsedMs: record?.elapsedMs ?? 0,
    sentEffort: record?.sentShape?.reasoning_effort ?? '（没有发出请求）',
    reasoningPresent: record?.reasoningPresent ?? false,
    reasoningLength: record?.reasoningLength ?? 0,
    messageKeys: record?.messageKeys ?? null,
  };
}

// ── The three readings ───────────────────────────────────────────────────────────────────────────

function selectionOf(result) {
  return [...new Set(result.requested)].sort();
}

function sorted(values) {
  return [...new Set(values)].sort();
}

/**
 * Classify one observation on the three dimensions, and say which of them are even answerable.
 *
 * A response that did not arrive, or that was cut off by the output budget, produced no selection to
 * judge. That is not the same as a selection that happened to be empty, and `kind` is what keeps the
 * two apart everywhere downstream: `transport` and `truncated` observations are printed in full, are
 * counted in their own rows, and are left out of every semantic-selection statistic.
 *
 * The exclusion matters most for the four negative sentences. A truncated response carries no
 * `tool_calls`, so counting it would score as "the model correctly chose nothing" — a pass minted out
 * of a failure. It also matters *for this experiment specifically*: the whole question is whether one
 * arm truncates more than the other, and a statistic that scored truncation as a correct empty
 * selection would answer that question backwards.
 */
function classify(sentence, result) {
  const selected = selectionOf(result);

  if (result.transport !== null || result.truncated) {
    return {
      kind: result.transport !== null ? 'transport' : 'truncated',
      selected,
      requiredSatisfied: null,
      missing: null,
      forbiddenHit: null,
      overRead: null,
      exact: null,
      detour: null,
    };
  }

  const required = sorted(sentence.required);
  const forbidden = sorted(sentence.forbidden);
  const exact = sorted(sentence.exact);
  const missing = required.filter((name) => !selected.includes(name));
  const forbiddenHit = selected.filter((name) => forbidden.includes(name));
  const overRead = selected.filter((name) => !required.includes(name));

  return {
    kind: 'selection',
    selected,
    requiredSatisfied: missing.length === 0,
    missing,
    forbiddenHit,
    overRead,
    exact: selected.join(',') === exact.join(','),
    // 一次读取只进一个桶：#7 的读取已经记成 forbidden violation / over-read，不再重复计进 detour。
    detour: sentence.detour && selected.length > 0,
  };
}

function median(numbers) {
  if (numbers.length === 0) return null;
  const sortedNumbers = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sortedNumbers.length / 2);
  return sortedNumbers.length % 2 === 1
    ? sortedNumbers[middle]
    : Math.round((sortedNumbers[middle - 1] + sortedNumbers[middle]) / 2);
}

function range(numbers) {
  if (numbers.length === 0) return '—';
  return `${Math.min(...numbers)} / ${median(numbers)} / ${Math.max(...numbers)}`;
}

/** `D` / `W` per capability, `·` for nothing, `✗` for a response that never produced a selection. */
function compact(verdict) {
  if (verdict.kind === 'transport') return '✗';
  if (verdict.kind === 'truncated') return '截';
  if (verdict.selected.length === 0) return '·';
  return verdict.selected.map((name) => CODE[name] ?? name).join('+');
}

function selectionText(result) {
  if (result.transport !== null) return `（${result.transport}）`;
  return result.requested.length === 0 ? '不调用' : result.requested.join(', ');
}

function displayWidth(text) {
  let width = 0;
  for (const character of text) {
    width += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/.test(character) ? 2 : 1;
  }
  return width;
}

function pad(text, width) {
  return text + ' '.repeat(Math.max(0, width - displayWidth(text)));
}

/** One arm's readings, computed once and read by both the detail blocks and the summary table. */
function summarize(arm, entries) {
  const withVerdict = entries.map((entry) => ({
    ...entry,
    verdict: classify(entry.sentence, entry.result),
  }));
  const usable = withVerdict.filter((entry) => entry.verdict.kind === 'selection');
  const positive = usable.filter((entry) => entry.sentence.required.length > 0);
  const forbidden = usable.filter((entry) => entry.sentence.forbidden.length > 0);
  const latencies = entries.map((entry) => Math.round(entry.result.elapsedMs));
  const lengths = entries
    .filter((entry) => entry.result.reasoningPresent)
    .map((entry) => entry.result.reasoningLength);

  const finishReasons = new Map();
  for (const entry of entries) {
    const key = entry.result.finishReason ?? '（没有应答）';
    finishReasons.set(key, (finishReasons.get(key) ?? 0) + 1);
  }

  return {
    label: arm.label,
    arm,
    entries: withVerdict,
    usable,
    requiredSuccess: positive.filter((entry) => entry.verdict.requiredSatisfied).length,
    requiredTotal: positive.length,
    forbiddenViolations: forbidden.filter((entry) => entry.verdict.forbiddenHit.length > 0).length,
    forbiddenTotal: forbidden.length,
    exactCount: usable.filter((entry) => entry.verdict.exact).length,
    overReadCount: usable.reduce((total, entry) => total + entry.verdict.overRead.length, 0),
    detourCount: usable.filter((entry) => entry.verdict.detour).length,
    transportCount: withVerdict.filter((entry) => entry.verdict.kind === 'transport').length,
    reasonedCount: entries.filter((entry) => entry.result.reasoningPresent).length,
    reasoningLengths: lengths,
    reasoningRange: range(lengths),
    latencyRange: range(latencies),
    slowCount: latencies.filter((ms) => ms > PRODUCTION_TIMEOUT_MS).length,
    finishReasons,
    truncatedCount: withVerdict.filter((entry) => entry.verdict.kind === 'truncated').length,
  };
}

/** The subset of an arm's observations that belongs to one sentence, verdicts attached. */
function slice(summary, sentence) {
  return summary.entries.filter((entry) => entry.sentence === sentence);
}

test(
  'HIGH REASONING TOKEN-BUDGET A/B：high@512 vs high@4096，8 句 × 3 次 × 2 档',
  { skip: SKIP, timeout: 2 * 60 * 60 * 1000 },
  async (t) => {
    installWire();

    const credential = CREDENTIAL_ENV === undefined ? undefined : process.env[CREDENTIAL_ENV];
    console.log(
      `端点：${ENDPOINT}\n模型：${MODEL}\n凭据：${credential === undefined ? '不带 Authorization' : `来自 $${CREDENTIAL_ENV}（非空=${credential !== ''}）`}` +
        `\n每句次数：${RUNS}   两档：${ARMS.map((arm) => arm.label).join(' vs ')}` +
        `\n单次请求上限：${HARNESS_TIMEOUT_MS} ms（生产是 ${PRODUCTION_TIMEOUT_MS / 1000} s；实验上限不是生产策略）` +
        `\nreasoning_effort：两档都是 high（唯一变量不是它）` +
        `\nmax_tokens：${ARMS[0].maxTokens}（生产的 MODEL_MAX_TOKENS）vs ${ARMS[1].maxTokens}` +
        `（4096 由 harness 在 fetch 层改写，src/ 未动）`,
    );

    const runs = new Map(ARMS.map((arm) => [arm.label, []]));

    for (const arm of ARMS) {
      console.log(`\n=============== 条件 ${arm.label} ===============`);
      for (const sentence of SENTENCES) {
        console.log(
          `\n「${sentence.text}」  需要：[${sorted(sentence.required).join(', ') || '无'}]` +
            `  禁止：[${sorted(sentence.forbidden).join(', ') || '无'}]` +
            `  完全正确：[${sorted(sentence.exact).join(', ') || '不调用'}]`,
        );
        for (let attempt = 0; attempt < RUNS; attempt += 1) {
          const result = await firstSelection(sentence.text, arm);
          const verdict = classify(sentence, result);
          runs.get(arm.label).push({ sentence, attempt, result, verdict });

          const reading =
            verdict.kind === 'transport'
              ? 'TRANSPORT FAILURE'
              : verdict.kind === 'truncated'
                ? 'TRUNCATED（finish_reason=length，不计入语义选择）'
                : `required=${verdict.requiredSatisfied ? 'YES' : 'NO'}` +
                  `  禁止=${verdict.forbiddenHit.length > 0 ? 'VIOLATION' : 'NO'}` +
                  `  over-read=[${verdict.overRead.join(', ')}]` +
                  `  exact=${verdict.exact ? 'YES' : 'NO'}`;

          console.log(
            `  ${arm.label} #${attempt + 1}  请求=[${selectionText(result)}]` +
              `  ${reading}` +
              `  max_tokens=${result.productionMaxTokens}→${result.sentMaxTokens}` +
              `  finish_reason=${result.finishReason ?? '—'}` +
              `  reasoning_content=${result.reasoningPresent ? `present(${result.reasoningLength})` : 'absent'}` +
              `  ${Math.round(result.elapsedMs)}ms`,
          );
        }
      }
    }

    const summaries = ARMS.map((arm) => summarize(arm, runs.get(arm.label)));

    // ── 六、两档对照表 ──────────────────────────────────────────────────────────────────────────
    console.log('\n===== 两档对照表 =====');
    console.log(
      '每个格子是该档在 24 次观察里的数字；可用数排除 transport 失败与 finish_reason=length 的截断观察。',
    );

    const rows = [
      ['usable observations', (s) => `${s.usable.length}/24`],
      ['required-read success', (s) => `${s.requiredSuccess}/${s.requiredTotal}`],
      ['forbidden violations', (s) => `${s.forbiddenViolations}/${s.forbiddenTotal}`],
      ['exact selections', (s) => `${s.exactCount}/${s.usable.length}`],
      ['over-read count', (s) => `${s.overReadCount}`],
      ['semantic-detour count', (s) => `${s.detourCount}`],
      ['transport failures', (s) => `${s.transportCount}`],
      ['finish_reason=length', (s) => `${s.truncatedCount}`],
      ['reasoning_content present', (s) => `${s.reasonedCount}/24`],
      ['reasoning_content length min/median/max', (s) => s.reasoningRange],
      ['latency min/median/max (ms)', (s) => s.latencyRange],
      [`>${PRODUCTION_TIMEOUT_MS / 1000}s requests`, (s) => `${s.slowCount}`],
    ];
    // Every cell is exactly as wide as the widest one, computed before anything is printed. Padding to a
    // guessed width is how two columns end up printed against each other with nothing between them —
    // which is worse than a ragged table, because it reads as one column and invites the wrong
    // comparison.
    const rowWidths = [
      Math.max(displayWidth('指标'), ...rows.map((row) => displayWidth(row[0]))) + 2,
      ...summaries.map(
        (summary) =>
          Math.max(
            displayWidth(summary.label),
            ...rows.map((row) => displayWidth(row[1](summary))),
          ) + 2,
      ),
    ];
    console.log(
      pad('指标', rowWidths[0]) +
        summaries.map((summary, i) => pad(summary.label, rowWidths[i + 1])).join(''),
    );
    for (const row of rows) {
      console.log(
        pad(row[0], rowWidths[0]) +
          summaries.map((summary, i) => pad(row[1](summary), rowWidths[i + 1])).join(''),
      );
    }

    // ── 逐句：两档各三次实际 selection ──────────────────────────────────────────────────────────
    console.log('\n===== 逐句：两档各三次实际 selection =====');
    console.log(
      'D=desktop_context_read  W=work_focus_read  ·=不调用  ✗=传输失败  +=同时读取  截=finish_reason=length',
    );
    const sentenceRows = SENTENCES.map((sentence) => ({
      sentence: sentence.text,
      required: sorted(sentence.required).join(', ') || '无',
      forbidden: sorted(sentence.forbidden).join(', ') || '无',
      cells: summaries.map((summary) =>
        slice(summary, sentence)
          .map((entry) => compact(entry.verdict))
          .join(' | '),
      ),
    }));
    const sentenceWidths = [
      Math.max(displayWidth('句子'), ...sentenceRows.map((row) => displayWidth(row.sentence))) + 2,
      Math.max(
        displayWidth('需要 / 禁止'),
        ...sentenceRows.map((row) => displayWidth(`${row.required} / ${row.forbidden}`)),
      ) + 2,
      ...summaries.map(
        (summary, index) =>
          Math.max(
            displayWidth(`${summary.label} 3 次`),
            ...sentenceRows.map((row) => displayWidth(row.cells[index])),
          ) + 2,
      ),
    ];
    console.log(
      pad('句子', sentenceWidths[0]) +
        pad('需要 / 禁止', sentenceWidths[1]) +
        summaries
          .map((summary, index) => pad(`${summary.label} 3 次`, sentenceWidths[index + 2]))
          .join(''),
    );
    for (const row of sentenceRows) {
      console.log(
        pad(row.sentence, sentenceWidths[0]) +
          pad(`${row.required} / ${row.forbidden}`, sentenceWidths[1]) +
          row.cells.map((cell, index) => pad(cell, sentenceWidths[index + 2])).join(''),
      );
    }

    // ── 九 / 六：截断是否消失 ───────────────────────────────────────────────────────────────────
    console.log('\n===== 截断是否消失 =====');
    for (const summary of summaries) {
      const truncated = summary.entries.filter((entry) => entry.verdict.kind === 'truncated');
      console.log(
        `  ${pad(summary.label, 10)}finish_reason=length：${summary.truncatedCount}/24` +
          (truncated.length === 0
            ? ''
            : `   出现在：${truncated
                .map((entry) => `「${entry.sentence.text}」#${entry.attempt + 1}`)
                .join(' ')}`),
      );
    }
    {
      const before = summaries[0].truncatedCount;
      const after = summaries[1].truncatedCount;
      console.log(
        `  对照：high@512 ${before}/24 → high@4096 ${after}/24` +
          (before > 0 && after === 0
            ? '  ← 本轮的截断在更大的预算下消失'
            : before === 0 && after === 0
              ? '  ← 两档都没有出现截断（本轮没有可消除的截断）'
              : after > 0
                ? '  ← 更大预算下仍然出现截断，不是预算不足'
                : '  ← 512 没有截断而 4096 出现了，方向与预期相反'),
      );
    }

    // ── 特别单列 A / B / C ──────────────────────────────────────────────────────────────────────
    console.log('\n===== 单列 A：「Work Focus 为什么这么设计？」——512 的截断在 4096 下是否消失 =====');
    {
      const sentence = SENTENCES[5];
      for (const summary of summaries) {
        const list = slice(summary, sentence);
        console.log(`  ${pad(summary.label, 10)}`);
        for (const entry of list) {
          console.log(
            `    #${entry.attempt + 1}  selection=[${entry.verdict.selected.join(', ') || '不调用'}]` +
              `  finish_reason=${entry.result.finishReason ?? '—'}` +
              `  reasoning_content=${entry.result.reasoningPresent ? `present(${entry.result.reasoningLength})` : 'absent'}` +
              `  ${Math.round(entry.result.elapsedMs)}ms`,
          );
        }
      }
    }

    console.log('\n===== 单列 B：「你现在看到什么？」——4096 是否引入额外 work_focus_read =====');
    {
      const sentence = SENTENCES[0];
      for (const summary of summaries) {
        const list = slice(summary, sentence).filter((entry) => entry.verdict.kind === 'selection');
        const withWork = list.filter((entry) => entry.verdict.selected.includes(WORK)).length;
        console.log(
          `  ${pad(summary.label, 10)}取走 work_focus_read：${withWork}/${list.length}` +
            `   三次实际选择：${list.map((entry) => `[${entry.verdict.selected.join(', ') || '不调用'}]`).join(' ')}`,
        );
      }
    }

    console.log(
      '\n===== 单列 C：「别看我的桌面，我们聊聊桌面架构。」——两档各自单报 forbidden violation =====',
    );
    {
      const sentence = SENTENCES[6];
      for (const summary of summaries) {
        const list = slice(summary, sentence);
        const usable = list.filter((entry) => entry.verdict.kind === 'selection');
        const desktop = usable.filter((entry) => entry.verdict.selected.includes(DESKTOP)).length;
        const others = usable.filter(
          (entry) =>
            entry.verdict.selected.length > 0 && !entry.verdict.selected.includes(DESKTOP),
        ).length;
        console.log(
          `  ${pad(summary.label, 10)}desktop_context_read FORBIDDEN VIOLATION：${desktop}/${usable.length}` +
            `   非 desktop 的读取（over-read，非 hard failure）：${others}/${usable.length}` +
            `   三次实际选择：${list.map((entry) => `[${entry.verdict.selected.join(', ') || '不调用'}]`).join(' ')}`,
        );
      }
    }

    // ── 六、每档明细 ────────────────────────────────────────────────────────────────────────────
    console.log('\n===== 每档明细 =====');
    for (const summary of summaries) {
      console.log(
        `\n── ${summary.label} ──  可用 ${summary.usable.length}/24` +
          `（transport 失败 ${summary.transportCount}，finish_reason=length 截断 ${summary.truncatedCount}）`,
      );
      console.log(
        `  required-read success   ${summary.requiredSuccess}/${summary.requiredTotal}` +
          `（分母是四条正例 × ${RUNS} 次的可用观察）`,
      );
      console.log(
        `  forbidden violations   ${summary.forbiddenViolations}/${summary.forbiddenTotal}` +
          `（分母是带 forbidden 的句子；「别看我的桌面…」单列见上）`,
      );
      console.log(`  exact selections   ${summary.exactCount}/${summary.usable.length}`);
      console.log(`  over-read count   ${summary.overReadCount} 个额外 capability`);
      console.log(
        `  semantic-detour count   ${summary.detourCount}` +
          `（分母句：#5「桌面感知是怎么实现的？」#6「Work Focus 为什么这么设计？」#8「最近写 Hikari 写麻了。」）`,
      );
      console.log(`  transport failures   ${summary.transportCount}`);
      console.log(`  reasoning_content present   ${summary.reasonedCount}/24`);
      console.log(
        `  reasoning_content length   min/median/max = ${summary.reasoningRange}` +
          `（基于 ${summary.reasoningLengths.length} 次带 trace 的应答）`,
      );
      console.log(
        `  latency   min/median/max = ${summary.latencyRange} ms` +
          `   超过生产 ${PRODUCTION_TIMEOUT_MS / 1000} s 上限：${summary.slowCount}/24`,
      );
      console.log(
        `  finish_reason   ${[...summary.finishReasons.entries()]
          .map(([reason, count]) => `${reason} ${count}`)
          .join('   ')}`,
      );
    }

    // ── 单变量核对 ──────────────────────────────────────────────────────────────────────────────
    console.log('\n===== 单变量核对（读自实际发出的 body） =====');
    for (const summary of summaries) {
      const shapes = new Set(
        summary.entries
          .filter((entry) => entry.result.sentShape !== null)
          .map((entry) => JSON.stringify(entry.result.sentShape)),
      );
      const unparsed = summary.entries.filter((entry) => entry.result.sentShape === null).length;
      console.log(`\n${summary.label}：`);
      console.log(
        `  生产写进 body 的 max_tokens = [${[...new Set(summary.entries.map((entry) => String(entry.result.productionMaxTokens)))].join(', ')}]` +
          `   实际发出 = [${[...new Set(summary.entries.map((entry) => String(entry.result.sentMaxTokens)))].join(', ')}]`,
      );
      if (unparsed > 0) {
        console.log(`  ${unparsed}/${summary.entries.length} 次请求的 body 没有解析成功，未计入下面的形状`);
      }
      for (const shape of shapes) {
        const parsed = JSON.parse(shape);
        console.log(
          `  model=${parsed.model}  reasoning_effort=${parsed.reasoning_effort}  temperature=${parsed.temperature}` +
            `  tool_choice=${parsed.tool_choice}  max_tokens=${parsed.max_tokens}`,
        );
        console.log(
          `  top-level keys=[${parsed.topLevelKeys}]  messages=${parsed.messageCount}（keys: ${parsed.messageKeys}）  tools=[${parsed.toolNames}]`,
        );
      }
      if (shapes.size > 1) {
        console.log(`  ← 注意：本档内出现了 ${shapes.size} 种不同的请求形状`);
      }
    }
    {
      // The two arms must differ in exactly one field. Compared on the shape with `max_tokens` removed,
      // which is the only key the harness is allowed to have moved.
      //
      // A run whose body never parsed has no shape at all, and comparing `undefined` against a real
      // shape would report "不一致" — which reads as a second variable having crept in, when what
      // actually happened is that nothing was sent. The two are said apart here rather than merged into
      // one alarming line.
      const shapeOf = (summary) => {
        const shape = summary.entries.find((entry) => entry.result.sentShape !== null)?.result
          .sentShape;
        if (shape === undefined) return null;
        const copy = JSON.parse(JSON.stringify(shape));
        delete copy.max_tokens;
        return JSON.stringify(copy);
      };
      const left = shapeOf(summaries[0]);
      const right = shapeOf(summaries[1]);
      if (left === null || right === null) {
        console.log(
          `\n两档请求形状无法比较：${left === null ? summaries[0].label : summaries[1].label} 没有任何一次请求的 body 解析成功（上面已有 transport 断言会失败）。`,
        );
      } else {
        const same = left === right;
        console.log(
          `\n两档在 max_tokens 之外的请求形状${same ? '完全一致' : '不一致'}` +
            (same ? '  ← 单变量成立' : `：\n  ${left}\n  ${right}`),
        );
      }
    }

    console.log('\n===== 应答形状（确认没有把「解析不了」当成「不调用」） =====');
    for (const summary of summaries) {
      const shaped = summary.entries.filter((entry) => entry.verdict.kind === 'selection');
      const disagreed = shaped.filter(
        (entry) =>
          entry.result.bodyToolNames !== null &&
          entry.result.bodyToolNames.join(',') !== entry.result.requested.join(','),
      );
      console.log(
        `${summary.label}：body 里的 tool_calls 与 ModelStep 解析结果不一致 ${disagreed.length}/${shaped.length}`,
      );
    }

    // ── The assertions ──────────────────────────────────────────────────────────────────────────
    //
    // They gate the *experiment*, never the model. A run where the transport broke, or where the
    // thinking condition never actually thought, has not measured the thing it set out to measure, and
    // a table of zeros from such a run would read as a finding about the model. Which arm selected what
    // is not asserted anywhere: that is the result.
    for (const summary of summaries) {
      const label = summary.label;
      const all = summary.entries;

      const broken = all.filter((entry) => entry.verdict.kind === 'transport');
      assert.equal(
        broken.length,
        0,
        `条件 ${label} 有 ${broken.length}/${all.length} 次请求没有拿到可用的应答，这一条不构成选择证据：` +
          broken.map((entry) => entry.result.transport).join(' / '),
      );

      const reasoned = all.filter((entry) => entry.result.reasoningPresent).length;
      assert.ok(
        reasoned > 0,
        `条件 ${label} 的 ${all.length} 次应答里没有一次带 reasoning_content，` +
          `说明实验条件没有真正进入 thinking mode，这一档不能作为 high 证据。` +
          `（choices[0].message 的 keys：${all[0]?.result.messageKeys?.join(', ') ?? '（没有应答）'}）`,
      );

      const multi = all.filter((entry) => entry.result.requestCount !== 1);
      assert.equal(
        multi.length,
        0,
        `条件 ${label} 有 ${multi.length} 次观察发出的请求数不是 1：` +
          multi.map((entry) => `${entry.result.requestCount}`).join(' / ') +
          '（本实验只观察第一轮，不应出现第二次请求）',
      );

      // The variable, checked on the wire rather than in this file's own argument list.
      const wrongEffort = all.filter((entry) => entry.result.sentEffort !== summary.arm.reasoningEffort);
      assert.equal(
        wrongEffort.length,
        0,
        `条件 ${label} 有 ${wrongEffort.length} 次请求带的不是 ${summary.arm.reasoningEffort}：` +
          wrongEffort.map((entry) => String(entry.result.sentEffort)).join(' / '),
      );

      const wrongBudget = all.filter((entry) => entry.result.sentMaxTokens !== summary.arm.maxTokens);
      assert.equal(
        wrongBudget.length,
        0,
        `条件 ${label} 有 ${wrongBudget.length} 次请求实际发出的 max_tokens 不是 ${summary.arm.maxTokens}：` +
          wrongBudget.map((entry) => String(entry.result.sentMaxTokens)).join(' / '),
      );

      // Production must still be saying 512. If `MODEL_MAX_TOKENS` ever moves, this experiment's premise
      // moves with it, and a silently re-based comparison is worse than a failing one.
      const movedProduction = all.filter(
        (entry) => entry.result.productionMaxTokens !== PRODUCTION_MAX_TOKENS,
      );
      assert.equal(
        movedProduction.length,
        0,
        `条件 ${label} 有 ${movedProduction.length} 次请求，生产写进 body 的 max_tokens 不是 ${PRODUCTION_MAX_TOKENS}：` +
          movedProduction.map((entry) => String(entry.result.productionMaxTokens)).join(' / ') +
          `（src 里的 MODEL_MAX_TOKENS 变了，本实验的前提也跟着变了）`,
      );
    }

    for (const summary of summaries) {
      t.diagnostic(
        `${summary.label}: 可用 ${summary.usable.length}/24；required ${summary.requiredSuccess}/${summary.requiredTotal}；` +
          `forbidden ${summary.forbiddenViolations}/${summary.forbiddenTotal}；exact ${summary.exactCount}/${summary.usable.length}；` +
          `over-read ${summary.overReadCount}；detour ${summary.detourCount}；transport ${summary.transportCount}；` +
          `reasoning_content ${summary.reasonedCount}/24（${summary.reasoningRange}）；` +
          `latency ${summary.latencyRange} ms；>15s ${summary.slowCount}；length ${summary.truncatedCount}`,
      );
    }

    console.log('\n实验结束。这只报告事实：两档没有总分，也不推荐任何一档，更不决定 production 默认值。');
  },
);

// The guard the other live harnesses carry, for the same reason: the sentences above name the
// capabilities by hand, so a third exposure would make every required/forbidden/exact set silently
// incomplete — and this experiment would then be measuring two budgets against a table that no longer
// describes the surface they select from.
test('high-budget harness 的句子覆盖了当前全部 capability', () => {
  const named = new Set(
    SENTENCES.flatMap((sentence) => [...sentence.required, ...sentence.forbidden, ...sentence.exact]),
  );
  for (const exposure of LANGUAGE_EXPOSURES) {
    assert.ok(named.has(exposure.name), `${exposure.name} 没有被任何一句话覆盖`);
  }
  assert.deepEqual(
    LANGUAGE_EXPOSURES.map((exposure) => exposure.name).sort(),
    [WORK, DESKTOP].sort(),
  );
  // 两档与三读数表是这份实验的全部输入，改动它们就是改实验条件本身。
  assert.deepEqual(
    ARMS.map((arm) => [arm.label, arm.reasoningEffort, arm.maxTokens]),
    [['high@512', 'high', 512], ['high@4096', 'high', 4096]],
  );
  for (const sentence of SENTENCES) {
    const required = sorted(sentence.required);
    const exact = sorted(sentence.exact);
    for (const name of required) {
      assert.ok(exact.includes(name), `「${sentence.text}」的 exact 缺了 required 的 ${name}`);
    }
    for (const name of sentence.forbidden) {
      assert.ok(!exact.includes(name), `「${sentence.text}」把 forbidden 的 ${name} 写进了 exact`);
    }
  }
});
