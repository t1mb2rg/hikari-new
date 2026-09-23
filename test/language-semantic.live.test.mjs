import assert from 'node:assert/strict';
import test from 'node:test';

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
// that was instructed to emit `desktop_context.read` agrees with it by construction. The only evidence
// for that claim is a real endpoint. This file is where that evidence is collected, and it is skipped by
// default because CI has no endpoint and no credential.
//
//   PowerShell:
//     $env:HIKARI_SEMANTIC_ENDPOINT = 'https://api.example.com/v1/chat/completions'
//     $env:HIKARI_SEMANTIC_MODEL    = 'some-model'
//     $env:HIKARI_SEMANTIC_CREDENTIAL_ENV = 'SOME_API_KEY'     # optional; omit for a local endpoint
//     node --test test/language-semantic.live.test.mjs
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

const ENDPOINT = process.env.HIKARI_SEMANTIC_ENDPOINT;
const MODEL = process.env.HIKARI_SEMANTIC_MODEL;
const CREDENTIAL_ENV = process.env.HIKARI_SEMANTIC_CREDENTIAL_ENV;
const RUNS = Number.parseInt(process.env.HIKARI_SEMANTIC_RUNS ?? '3', 10);

const CONFIGURED = Boolean(ENDPOINT && MODEL);
const SKIP = CONFIGURED
  ? false
  : '需要一个真实 endpoint：设置 HIKARI_SEMANTIC_ENDPOINT 与 HIKARI_SEMANTIC_MODEL 后再跑（见文件抬头）。';

const WORK = 'work_focus.read';
const DESKTOP = 'desktop_context.read';

/**
 * The eight sentences, and what reading is necessary in order to answer each one honestly.
 *
 * `expect` is the *complete* set of capabilities the loop may perform, not a lower bound. "desktop only"
 * means a model that also reads the work focus has selected something it did not need, which is the
 * failure mode this whole exercise exists to catch — a model that reads everything answers the question
 * by accident and gives no evidence that it can choose.
 */
const SENTENCES = Object.freeze([
  { text: '你现在看到什么？', expect: [DESKTOP], why: '问的是屏幕上的东西，只有桌面能回答' },
  { text: '我现在关注什么？', expect: [WORK], why: '问的是明确声明的关注对象，只有工作焦点能回答' },
  { text: '现在前台是什么？', expect: [DESKTOP], why: '前台是桌面感知的一部分，不需要工作焦点' },
  { text: '我现在明确关注的项目是什么？', expect: [WORK], why: '「明确关注」是工作焦点的用词，不需要桌面' },
  { text: '桌面感知是怎么实现的？', expect: [], why: '问的是实现，不是这台机器现在的状态' },
  { text: 'Work Focus 为什么这么设计？', expect: [], why: '问的是设计理由，Hikari 没有任何能力保存它' },
  {
    text: '别看我的桌面，我们聊聊桌面架构。',
    expect: [],
    why: '这是明确的负向指令：即使 peek 没有副作用，也不得读取',
  },
  { text: '最近写 Hikari 写麻了。', expect: [], why: '一句闲话，不是关于这台机器的问题' },
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
  });

  const answerer = createAnswerer({
    async step(request) {
      const step = await model.step(request);
      // Recorded off what the model returned, so a batch the loop refuses is in the record too. Only the
      // *names* are kept: the model's prose is exactly what this surface exists to keep out of the
      // record, and the system prompt and tool results are this build's own text and carry no selection
      // evidence.
      for (const call of step.toolCalls) requested.push(call.name);
      return step;
    },
    read: async (exposure) => {
      performed.push(exposure.name);
      return reader(exposure);
    },
    now: () => new Date().toISOString(),
  });

  try {
    const reply = await answerer.answer(text);
    return { text, requested, performed, reads, outcome: reply.outcome };
  } finally {
    model.dispose();
  }
}

/**
 * Whether one run selected what the sentence required.
 *
 * Both halves matter and they are not the same half. `performed` is what this build read, so a set that
 * is larger than expected means the model read something it did not need. `requested` is what the model
 * asked for, so a name outside the expected set is a selection failure even when the loop refused to act
 * on it — the model still chose to read the desktop while being told not to.
 *
 * `failed` is the third and it is not a selection verdict at all: it means no model decision was ever
 * reached, because the endpoint or the wiring broke first. It has to be a failure here even so, because
 * the four sentences that expect *nothing* would otherwise be marked PASS by a run that never happened —
 * an unreachable endpoint reads as "selected no capability" on every one of them, which is the one shape
 * of false green this file could produce. `refused` is deliberately not in this list: the model returned
 * no usable text and called nothing, and calling nothing is a correct selection. A `refused` run that
 * *did* ask for something is already caught by the `requested` check above.
 */
function mismatches(sentence, result) {
  if (result.outcome === 'failed') return true;
  const performed = [...result.performed].sort().join(',');
  const expected = [...sentence.expect].sort().join(',');
  if (performed !== expected) return true;
  return result.requested.some((name) => !sentence.expect.includes(name));
}

function describe(runResult) {
  return (
    `  outcome=${runResult.outcome}` +
    `  requested=[${runResult.requested.join(', ')}]` +
    `  performed=[${runResult.performed.join(', ')}]` +
    `  serviceReads={focus:${runResult.reads.focus}, peek:${runResult.reads.peek}}`
  );
}

test(
  '真实 endpoint 的语义选择：8 句话，每句独立 3 次',
  { skip: SKIP, timeout: 15 * 60 * 1000 },
  async (t) => {
    const rows = [];

    for (const sentence of SENTENCES) {
      const results = [];
      for (let attempt = 0; attempt < RUNS; attempt += 1) {
        results.push(await run(sentence.text));
      }
      rows.push({ sentence, results });

      // Printed as it goes, because this is an operator-run evidence-collection pass and a run that dies
      // on the sixth sentence should still leave the first five on the screen. The report below repeats
      // it in full.
      console.log(`\n「${sentence.text}」  期望读取：[${sentence.expect.join(', ')}]  —— ${sentence.why}`);
      for (const [attempt, result] of results.entries()) {
        console.log(`  #${attempt + 1}${describe(result)}`);
      }
    }

    console.log('\n===== 汇总 =====');
    const failures = [];
    for (const { sentence, results } of rows) {
      const expected = [...sentence.expect].sort();
      const mismatched = results.filter((result) => mismatches(sentence, result));
      const line =
        `${mismatched.length === 0 ? 'PASS' : 'FAIL'}  「${sentence.text}」  ` +
        `期望 [${expected.join(', ')}]`;
      console.log(line);
      if (mismatched.length > 0) {
        failures.push({ sentence, mismatched });
        for (const result of mismatched) console.log(`        实际${describe(result)}`);
      }
    }

    for (const { sentence, mismatched } of failures) {
      t.diagnostic(`语义选择不符：「${sentence.text}」（${mismatched.length}/${RUNS} 次）`);
    }

    // The assertions, after the whole table has been printed. A run that fails prints its evidence first
    // — the failure is a fact about the model, and the operator needs the table to act on it.
    for (const { sentence, results } of rows) {
      const expected = [...sentence.expect].sort();
      for (const [attempt, result] of results.entries()) {
        // Asserted here as well as in the table above, because the two checks below cannot see it: a
        // `failed` run performed nothing and requested nothing, so it satisfies both of them for the
        // four sentences whose expected set is empty.
        assert.notEqual(
          result.outcome,
          'failed',
          `「${sentence.text}」第 ${attempt + 1} 次：模型没有答上来，这一行不构成选择证据`,
        );
        assert.deepEqual(
          [...result.performed].sort(),
          expected,
          `「${sentence.text}」第 ${attempt + 1} 次：实际读取 [${result.performed.join(', ')}]`,
        );
        for (const name of result.requested) {
          assert.ok(
            sentence.expect.includes(name),
            `「${sentence.text}」第 ${attempt + 1} 次：模型要求了不应读取的 ${name}`,
          );
        }
      }
    }

    // Reached only when every sentence matched on every run. Stated so that the terminal says something
    // unambiguous rather than leaving a silent pass to be interpreted.
    console.log('\n全部 8 句语义选择符合冻结的选择准则。');
  },
);

// A guard against the harness being run with a configuration that would make the result meaningless,
// and against the exposure set having grown without this file noticing: the sentences above name the
// two capabilities by hand, and a third would make the expected sets above silently incomplete.
test('语义验证的句子覆盖了当前全部 capability', () => {
  const named = new Set(SENTENCES.flatMap((sentence) => sentence.expect));
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
