import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { askFailureLines, requestLanguageAsk } from '../dist/cli/ask.js';
import {
  desktopContextReadExposure,
  desktopSessionAwarenessPeekService,
  desktopSessionAwarenessService,
} from '../dist/desktop-session-awareness/index.js';
import { renderAssessment } from '../dist/desktop-session-observe/index.js';
import { Runtime } from '../dist/index.js';
import {
  createAnswerer,
  createLanguagePlugin,
  decodeLanguageReply,
  decodeLanguageRequest,
  LANGUAGE_PROTOCOL_VERSION,
  LANGUAGE_TOPICS,
  languageEndpointPath,
  languagePlugin,
  MAX_LANGUAGE_TEXT_LENGTH,
  TOPIC_GLOSS,
} from '../dist/language/index.js';
// Imported by path rather than through the barrel, and that is the honest shape of it: this list has no
// cross-module reader today, so exporting it would be a public symbol justified by "a test needs it" —
// the one reason `plugin-design-spec.md` §7 names as insufficient. The barrel can export it the day a
// module other than this one reads it.
import { LANGUAGE_EXPOSURES } from '../dist/language/exposure.js';
import { workFocusCurrentService, workFocusReadExposure } from '../dist/work-focus/index.js';

// Two halves in one file, and the split between them is the point of the whole design.
//
// The pipeline tests need no pipe, no model and no resident: `createAnswerer` takes its four
// dependencies as arguments, so a test chooses what the model says and reads what came back. They run
// everywhere, including CI, which is where they matter most — this repository's tests run on
// `ubuntu-latest`, where there are no named pipes and every endpoint test is skipped.
//
// The endpoint tests are the other half and run only on Windows. They are here rather than in a
// separate file for the reason `desktop-session-observe.test.mjs` gives: splitting them would put the
// claims about the wire on the side of the split that CI never runs, and the pipeline half would then
// be the only thing anybody checked.
const NO_PIPES = process.platform === 'win32' ? false : '命名管道只在 Windows 上存在';

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

// The sentence the prompt uses to offer the previous turn, and the whole way a test can tell whether a
// turn was offered. It has to be a marker rather than a search for the topic name: the topic names are
// in *every* prompt — that is what a closed set is — so `system.includes('work-focus')` is true of a
// first turn, a follow-up and a restart alike, and would pin nothing.
const OFFERED_PREVIOUS = '这个人上一轮问的是：';

/** The topic a prompt offered as the previous turn, or `null` when it offered none. */
function offeredPrevious(prompt) {
  const at = prompt.system.indexOf(OFFERED_PREVIOUS);
  if (at === -1) return null;
  // The topic runs to the end of that sentence; what follows it is the instruction about what to do
  // with it.
  return prompt.system.slice(at + OFFERED_PREVIOUS.length).split('。')[0];
}

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

// Every dependency recorded, because "the model was actually asked" and "the desktop was not read for
// a question about the work focus" are both claims about calls that a test has to be able to count.
function harness({
  topic = 'work-focus',
  throws,
  focus = Object.freeze(['hikari-new']),
  assessment = assessmentFixture(),
  at = NOW,
} = {}) {
  const prompts = [];
  const calls = { focus: 0, peek: 0 };
  let clock = at;
  let answer = topic;

  const answerer = createAnswerer({
    async classify(prompt) {
      prompts.push(prompt);
      if (throws !== undefined) throw throws;
      return answer;
    },
    async readFocus() {
      calls.focus += 1;
      return focus;
    },
    async peek() {
      calls.peek += 1;
      return assessment;
    },
    now: () => clock,
  });

  return {
    answerer,
    prompts,
    calls,
    say: (next) => {
      answer = next;
    },
    advance: (ms) => {
      clock = new Date(Date.parse(clock) + ms).toISOString();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Understand: the model's text becomes one of a closed set, or nothing.
// ---------------------------------------------------------------------------------------------

test('模型给出闭集内的主题时，问题得到回答，且提示词里有全部主题', async () => {
  const h = harness({ topic: 'work-focus' });

  const reply = await h.answerer.answer('我现在关注什么？');

  assert.equal(reply.outcome, 'answered');
  assert.equal(h.prompts.length, 1, 'fake 模型应被调用恰好一次');

  // The prompt carries the closed set, and it carries it from the owner's own table: a topic added to
  // `LANGUAGE_TOPICS` without a gloss, or a gloss left behind by a removed topic, fails here.
  for (const topic of LANGUAGE_TOPICS) {
    assert.ok(h.prompts[0].system.includes(topic), `提示词应包含主题 ${topic}`);
    assert.ok(h.prompts[0].system.includes(TOPIC_GLOSS[topic]), `提示词应包含 ${topic} 的说明`);
  }

  // The human's sentence is carried verbatim. Not trimmed, not folded, not rewritten — the model is
  // asked about what the person typed, and this is the only place that can be checked.
  assert.ok(h.prompts[0].user.includes('我现在关注什么？'));
});

test('模型说出闭集之外的东西时是 refused，不是 answered', async () => {
  const h = harness({ topic: '你现在正在专注写 Hikari' });

  const reply = await h.answerer.answer('我现在在干嘛？');

  assert.equal(reply.outcome, 'refused');
  assert.equal(h.prompts.length, 1, 'refused 也是一次真实的模型调用');
  assert.ok(
    !reply.lines.join('\n').includes('你现在正在专注写 Hikari'),
    '模型写的话不得出现在回答里',
  );
});

test('模型不可达是 failed，不是 refused', async () => {
  const h = harness({ throws: new Error('connect ECONNREFUSED 127.0.0.1:11434') });

  const reply = await h.answerer.answer('你现在看到什么？');

  assert.equal(reply.outcome, 'failed');
  // The reason is carried, because "the model is unreachable" and "the model answered nonsense" call
  // for different repairs and a human can only act on the difference if they are told which happened.
  assert.ok(reply.lines.join('\n').includes('ECONNREFUSED'));
});

test('refused 与 failed 是两件不同的事，不能说成同一件', async () => {
  const unclassified = await harness({ topic: '听不懂' }).answerer.answer('嗯');
  const unreachable = await harness({ throws: new Error('模型端点不可达') }).answerer.answer('嗯');

  assert.notEqual(unclassified.outcome, unreachable.outcome);
  assert.notDeepEqual(unclassified.lines, unreachable.lines);

  // The separation is not only a word: the refusal must not claim the model failed, and the failure
  // must not claim the question was not understood. A surface that reported "I did not understand
  // you" for a model that is down would blame the human for this side's failure.
  assert.ok(!unclassified.lines.join('\n').includes('模型端点不可达'));
  assert.ok(!unreachable.lines.join('\n').includes('没听懂'));
});

test('模型的自由文本没有任何一条通路到最终回答', async () => {
  // Each model answer contains a sentence no renderer could produce, and is spelled so that a lookup
  // either accepts it whole or does not accept it at all. The middle case is the interesting one:
  // `work-focus` followed by a sentence is a *legal* topic with something appended, and it must be
  // refused rather than matched leniently.
  const CONFABULATION = '你现在正在专注写 Hikari';
  const outputs = [
    `work-focus\n${CONFABULATION}`,
    `${CONFABULATION}：work-focus`,
    `work-focus ${CONFABULATION}`,
    CONFABULATION,
    `work-focus${ESC}[31m${CONFABULATION}`,
  ];

  for (const output of outputs) {
    const h = harness({ topic: output });
    const reply = await h.answerer.answer('我现在关注什么？');
    const printed = reply.lines.join('\n');

    assert.equal(reply.outcome, 'refused', `应拒绝：${JSON.stringify(output)}`);
    assert.ok(!printed.includes(CONFABULATION), `模型的话不得出现在回答里：${JSON.stringify(output)}`);
    // Not even a byte of it. A control character that survived would let a model move the cursor on
    // the terminal that prints the answer.
    assert.ok(!printed.includes(ESC), '回答里不得有 ESC');
  }
});

test('模型把问题原样抄回来时，那也不是一个主题', async () => {
  // The model is asked to answer with one of four words. If it echoes the question instead, the answer
  // is a refusal rather than a sentence in the reply — the lookup is on the whole string, so the
  // question itself is not `desktop-state` no matter how close it looks.
  const h = harness({ topic: '光，你现在看到什么？' });

  const reply = await h.answerer.answer('光，你现在看到什么？');

  assert.equal(reply.outcome, 'refused');
  assert.ok(!reply.lines.join('\n').includes('光，你现在看到什么？'));
});

// ---------------------------------------------------------------------------------------------
// Express: what is said back is the domain's own material, transcribed.
// ---------------------------------------------------------------------------------------------

test('关于工作焦点的问题只读工作焦点，不读桌面', async () => {
  const h = harness({ topic: 'work-focus', focus: Object.freeze(['hikari-new', '另一件事']) });

  const reply = await h.answerer.answer('我现在关注什么？');

  assert.equal(reply.outcome, 'answered');
  const printed = reply.lines.join('\n');
  assert.ok(printed.includes('hikari-new'));
  assert.ok(printed.includes('另一件事'));
  // `work-focus` is the common question and it costs no acquisition. The obvious implementation reads
  // both sources unconditionally, and nothing would notice until somebody wondered why asking about
  // the focus launched a subprocess.
  assert.equal(h.calls.peek, 0, '关于工作焦点的问题不该读桌面');
  assert.equal(h.calls.focus, 1);
});

test('关于桌面的问题是 renderAssessment 的原样转写，一个字都不加', async () => {
  const assessment = assessmentFixture();
  const h = harness({ topic: 'desktop-state', assessment });

  const reply = await h.answerer.answer('光，你现在看到什么？');

  assert.equal(reply.outcome, 'answered');
  // The strongest available statement that this surface invents nothing: the block a human gets from
  // `hikari ask` is byte-identical to the block `hikari observe desktop-session status` prints, because
  // it is the same call to the same function. A second renderer would drift from the first and both
  // would still look right.
  const block = renderAssessment(assessment);
  const start = reply.lines.indexOf(block[0]);
  assert.notEqual(start, -1, '回答里应有桌面观察块');
  assert.deepEqual(reply.lines.slice(start, start + block.length), block);
  assert.equal(h.calls.focus, 0, '关于桌面的问题不该读工作焦点');
  assert.equal(h.calls.peek, 1);
});

test('桌面块里的控制字符不会被第二次转义', async () => {
  // The answer as a whole goes through `oneLine`, and the desktop block inside it went through the same
  // rule on its own way out of `desktop-session-observe`. That composition is only harmless if applying
  // the rule twice does the same thing as applying it once, and the title here carries an escape
  // sequence and a newline so that this is a claim about a line with something to escape rather than
  // about a line that happens to be plain text.
  const assessment = assessmentFixture(`${ESC}[2J判词：stable\nPWNED`);
  const h = harness({ topic: 'desktop-state', assessment });

  const reply = await h.answerer.answer('光，你现在看到什么？');

  assert.equal(reply.outcome, 'answered');
  const block = renderAssessment(assessment);
  // Byte-identical to what `hikari observe desktop-session status` prints means the second pass changed
  // nothing — a `\\u001b` that came back as `\\\\u001b` would break this, and so would one that came
  // back unescaped.
  const start = reply.lines.indexOf(block[0]);
  assert.notEqual(start, -1);
  assert.deepEqual(reply.lines.slice(start, start + block.length), block);
  // And the title still did not become a verdict: the only line on this surface that starts with the
  // verdict label is Hikari's own.
  assert.deepEqual(
    block.filter((line) => line.startsWith('判词：')),
    ['判词：baseline'],
  );
});

test('current-context 把两者并排放，不产生新的判断', async () => {
  const assessment = assessmentFixture();
  const h = harness({ topic: 'current-context', focus: Object.freeze(['hikari-new']), assessment });

  const reply = await h.answerer.answer('我现在看到什么？');

  assert.equal(reply.outcome, 'answered');
  const printed = reply.lines.join('\n');
  assert.ok(printed.includes('hikari-new'), '应包含工作焦点');
  assert.ok(printed.includes(renderAssessment(assessment)[0]), '应包含桌面观察块');

  // Both blocks are present whole. What must not happen is a sentence *about* them — that a window is
  // an editor, that the two together mean the person is coding. Nothing in this answer says anything
  // that is not a field of one of the two readings.
  const block = renderAssessment(assessment);
  const start = reply.lines.indexOf(block[0]);
  assert.notEqual(start, -1);
  assert.deepEqual(reply.lines.slice(start, start + block.length), block);
  assert.equal(h.calls.focus, 1);
  assert.equal(h.calls.peek, 1);
});

test('工作焦点里的换行和控制字符进不了终端', async () => {
  // Work focus designations are free text a human typed, and Language is the second surface that
  // prints them — which is why the rule moved out of the observation renderer instead of being copied
  // into this one.
  const h = harness({
    topic: 'work-focus',
    focus: Object.freeze(['hikari-new\n判词：stable', `${ESC}[2J被抹掉的屏幕`]),
  });

  const reply = await h.answerer.answer('我现在关注什么？');

  assert.equal(reply.outcome, 'answered');
  for (const line of reply.lines) {
    assert.ok(!line.includes('\n'), '一个元素必须是一行');
    assert.ok(!line.includes(ESC), '回答里不得有 ESC');
    assert.ok(!hasTerminalControl(line), '回答里不得有控制字符');
  }
  // The text is still carried — escaped, not dropped. A human can still read what they typed, and the
  // second line can no longer impersonate a verdict of Hikari's.
  assert.ok(reply.lines.join('\n').includes('判词：stable'));
});

// ---------------------------------------------------------------------------------------------
// Dialogue: the smallest thing a follow-up needs, and nothing more than that.
// ---------------------------------------------------------------------------------------------

test('后续问题按上一轮的主题理解，并说明是按哪一轮理解的', async () => {
  const h = harness({ topic: 'work-focus' });
  await h.answerer.answer('我现在关注什么？');

  h.say('desktop-state');
  const reply = await h.answerer.answer('那现在呢？');

  assert.equal(reply.outcome, 'answered');
  assert.equal(offeredPrevious(h.prompts[1]), 'work-focus', '第二轮提示词应带上上一轮的主题');
  assert.equal(offeredPrevious(h.prompts[0]), null, '第一轮没有上一轮可用');
  assert.ok(reply.lines.join('\n').includes('work-focus'), '回答应说明是按上一轮的主题理解的');
});

test('refused 和 failed 都不会成为下一轮理解的依据', async () => {
  const refused = harness({ topic: '听不懂' });
  await refused.answerer.answer('嗯');
  refused.say('desktop-state');
  await refused.answerer.answer('那现在呢？');
  assert.equal(offeredPrevious(refused.prompts[1]), null, 'refused 的一轮不是一次理解');

  const failed = harness({ throws: new Error('模型端点不可达') });
  await failed.answerer.answer('嗯');
  failed.say('desktop-state');
  await failed.answerer.answer('那现在呢？');
  assert.equal(offeredPrevious(failed.prompts[1]), null, '失败的调用没有理解任何主题');
});

test('对话上下文会过期，过期后不再被当成依据', async () => {
  const h = harness({ topic: 'work-focus' });
  await h.answerer.answer('我现在关注什么？');

  h.advance(5 * 60 * 1000 + 1000);
  h.say('desktop-state');
  const reply = await h.answerer.answer('那现在呢？');

  assert.equal(reply.outcome, 'answered');
  assert.equal(offeredPrevious(h.prompts[1]), null, '过期后不该再带上上一轮的主题');
  assert.ok(!reply.lines.join('\n').includes('按上一轮'), '过期后不该声称按上一轮理解');
});

test('重启（新的激活）不带任何上一轮的上下文', async () => {
  const first = harness({ topic: 'work-focus' });
  await first.answerer.answer('我现在关注什么？');

  // A new answerer is a new activation: it has never been asked anything, and there is nowhere for the
  // turn to have been kept. This is the constructor's behaviour rather than a cleanup path, which is
  // why it cannot be forgotten by a later edit.
  const restarted = harness({ topic: 'desktop-state' });
  await restarted.answerer.answer('那现在呢？');

  assert.equal(offeredPrevious(restarted.prompts[0]), null);
});

// ---------------------------------------------------------------------------------------------
// Request bounds: what this build refuses to answer, and what it refuses to call a question.
// ---------------------------------------------------------------------------------------------

test('空问题和超长问题是 refused，而且不会去问模型', async () => {
  for (const text of ['', '   \n ']) {
    const h = harness();
    assert.equal((await h.answerer.answer(text)).outcome, 'refused');
    assert.equal(h.prompts.length, 0, '空问题不该产生一次模型调用');
  }

  const tooLong = harness();
  const long = await tooLong.answerer.answer('x'.repeat(MAX_LANGUAGE_TEXT_LENGTH + 1));
  assert.equal(long.outcome, 'refused');
  assert.equal(tooLong.prompts.length, 0, '超长问题不该产生一次模型调用');

  // Exactly at the bound is a question, not a refusal. A bound that rejected its own limit would make
  // the number in the message a lie.
  const atLimit = harness();
  const accepted = await atLimit.answerer.answer('x'.repeat(MAX_LANGUAGE_TEXT_LENGTH));
  assert.equal(accepted.outcome, 'answered');
  assert.equal(atLimit.prompts.length, 1);
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

  // Structural and semantic are two questions and this is where the line is drawn. An empty question
  // is a well-formed ask, so it decodes and the plugin refuses it — "this build will not answer that"
  // is a statement about the question, not about the envelope.
  const empty = decodeLanguageRequest(
    JSON.stringify({ protocol: LANGUAGE_PROTOCOL_VERSION, request: 'ask', text: '' }),
  );
  assert.equal(empty.kind, 'request');
  assert.equal(empty.request.text, '');
});

test('应答里出现未知的结果词时，客户端读不懂而不是猜一个', () => {
  const unknown = JSON.stringify({
    protocol: LANGUAGE_PROTOCOL_VERSION,
    outcome: 'ok',
    lines: ['x'],
  });
  assert.equal(decodeLanguageReply(unknown).kind, 'unreadable');
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

  // The claim is about what is *absent*, so it is checked against the whole set rather than by looking
  // for one name: nothing this plugin is handed comes from the CI chain, and nothing in the chain is
  // required for it to activate. That is what makes a default resident — the one with no repository
  // scope at all — able to load it.
  for (const key of keys) {
    assert.ok(!key.includes('repository-ci'), `${key} 不该来自 Repository CI`);
    assert.ok(!key.startsWith('git-'), `${key} 不该来自 Git`);
    assert.ok(!key.startsWith('github'), `${key} 不该来自 GitHub`);
  }
  // And `current()`, which would let a question move the timeline it is asking about, is not here
  // either. This single assertion is what makes "asking does not participate in judgement" a property
  // of what the plugin was given rather than a rule it follows.
  assert.ok(!keys.includes('desktop-session-awareness.current@1'));
});

// ---------------------------------------------------------------------------------------------
// What this plugin is willing to offer, and why the list is short and written down.
//
// Nothing below reaches a model in this slice. The list is built so the slice that brings the
// selection loop has something to select from, and it is checked here because every claim it makes is
// a claim about the owners' objects and about `requires` — neither of which needs a pipe.
// ---------------------------------------------------------------------------------------------

test('Language 允许的 exposure 就是两个 owner 自己的导出，不是复制来的字符串', () => {
  // Identity rather than equality, and the difference is the whole test. A copy that matches today
  // matches by coincidence tomorrow; the claim is that these words have exactly one author, and the
  // only way to check that is against the author's own object.
  assert.equal(LANGUAGE_EXPOSURES.length, 2);
  assert.equal(LANGUAGE_EXPOSURES[0], workFocusReadExposure);
  assert.equal(LANGUAGE_EXPOSURES[1], desktopContextReadExposure);
  assert.deepEqual(
    LANGUAGE_EXPOSURES.map((exposure) => exposure.name),
    ['work_focus.read', 'desktop_context.read'],
  );
});

test('每个 exposure 都指向 Language 已经持有契约的既有 Service', () => {
  // The mapping between an offer and the thing that would execute it, and the whole of it: an exposure
  // names a contract, and that contract has to be in this plugin's `requires`, which is the only list
  // that decides what the Runtime will hand it. There is no second table and no lookup by name, so the
  // two cannot drift — the exposure carries the contract object itself rather than its id.
  const required = languagePlugin.requires ?? [];
  for (const exposure of LANGUAGE_EXPOSURES) {
    assert.ok(
      required.includes(exposure.service),
      `${exposure.name} 指向的 ${exposure.service.id} 必须在 Language 的 requires 里`,
    );
  }

  assert.equal(LANGUAGE_EXPOSURES[0].service, workFocusCurrentService);
  assert.equal(LANGUAGE_EXPOSURES[1].service, desktopSessionAwarenessPeekService);

  // The discriminating half. Language provides and requires the *peek* contract, so an offer pointing
  // at `current()` would be the one bug this whole shape is arranged to make impossible: a model whose
  // question moved the judgement timeline it was asking about. This slice added no dependency either —
  // the `requires` test above pins the list exactly, and both entries here were already on it.
  assert.ok(!required.includes(desktopSessionAwarenessService));
  assert.notEqual(LANGUAGE_EXPOSURES[1].service, desktopSessionAwarenessService);
});

test('current-context 仍然留在 v1 的主题闭集里，没有被搬进 capability 词汇', () => {
  // The ruling this pins: "what were we just talking about" is Language's own dialogue concern and not
  // an external capability. It reads no provider's facts — it reads the turn this plugin kept — so
  // there is no owner who could write a description of it, and asking a model to call a tool to
  // remember its own last question would be the vocabulary being made tidy at the expense of the only
  // thing it was describing. `LANGUAGE_TOPICS` is untouched by this slice and stays where it is.
  assert.ok(LANGUAGE_TOPICS.includes('current-context'));
  assert.ok(!LANGUAGE_EXPOSURES.some((exposure) => exposure.name === 'current-context'));
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

async function compose(t, { topic = 'work-focus', throws, focus, assessment } = {}) {
  const root = createRoot(t);
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  const calls = { classify: 0 };
  const connections = [];
  const plugin = createLanguagePlugin((connection) => {
    connections.push(connection);
    return {
      async classify() {
        calls.classify += 1;
        if (throws !== undefined) throw throws;
        return topic;
      },
      dispose() {},
    };
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

  return { root, calls, connections };
}

function connectRaw(path) {
  return new Promise((settle) => {
    const socket = connect(path, () => settle(socket));
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

test('一次提问经过真实管道得到回答，且与 renderAssessment 一致', { skip: NO_PIPES }, async (t) => {
  const assessment = assessmentFixture();
  const { root } = await compose(t, { topic: 'desktop-state', assessment });

  const answer = await requestLanguageAsk(root, '光，你现在看到什么？');

  assert.equal(answer.kind, 'replied');
  assert.equal(answer.reply.outcome, 'answered');
  const block = renderAssessment(assessment);
  const start = answer.reply.lines.indexOf(block[0]);
  assert.notEqual(start, -1);
  assert.deepEqual(answer.reply.lines.slice(start, start + block.length), block);
});

test('同一个激活里的两次提问共享那一轮的上下文', { skip: NO_PIPES }, async (t) => {
  const { root } = await compose(t, { topic: 'work-focus' });

  const first = await requestLanguageAsk(root, '我现在关注什么？');
  assert.equal(first.reply.outcome, 'answered');
  assert.ok(!first.reply.lines.join('\n').includes('按上一轮'));

  const second = await requestLanguageAsk(root, '那现在呢？');
  assert.equal(second.reply.outcome, 'answered');
  assert.ok(second.reply.lines.join('\n').includes('work-focus'), '第二轮应带上上一轮的主题');
});

test('模型不可达时，管道里回来的是 failed 而不是 refused', { skip: NO_PIPES }, async (t) => {
  const { root } = await compose(t, { throws: new Error('模型端点不可达') });

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
  // Whoever is on the other end is not speaking this protocol, so there is no question to refuse.
  // `failed` is the honest word: this build never received a question to have an opinion about.
  assert.equal(decoded.reply.outcome, 'failed');
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
    // The name is shown, because an operator checking their own configuration needs to know which
    // variable was pointed at. The value is not, and could not be: this file never held it — the plugin
    // reads it at activation — so there is nothing here that could print it even by mistake.
    assert.ok(status.includes('HIKARI_LANGUAGE_TEST_SECRET'));
    assert.ok(!status.includes(canary));
    assert.ok(!USAGE.includes(canary));
  } finally {
    delete process.env.HIKARI_LANGUAGE_TEST_SECRET;
  }
});

// The other half of the same status line, and the half a resident prints in the ordinary case: no model
// was configured, so no language plugin was loaded.
//
// This is the branch that carries the slice's promise not to invent a default. Without it, an operator
// whose questions all come back "no language endpoint here" has only the *absence* of a `language` line
// to interpret, and "the plugin did not load" and "the plugin was never configured" would read the
// same. Asserted rather than left to the manual check that first covered it, because the manual check
// is not something a later edit can fail.
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
  // It names the two flags that would have loaded it rather than an endpoint it chose for you, which is
  // the whole difference between a surface that reports its own configuration and one that supplies a
  // default: there is no endpoint this build would have gone to, so there is none to print.
  assert.ok(status.includes('--model-endpoint') && status.includes('--model'));
  assert.ok(!status.includes('http'), '未配置时不得指向任何端点');
});

// The three lines above are the only place in the status report that prints a string the operator
// typed — everything else in it is the Runtime's own state or the composition's own plugin ids — so
// this is where that is pinned.
//
// A status report is read to find out what a resident is doing, which makes "it cannot say something
// the resident did not say" the one property it may not lose. Endpoint, model name and variable name
// all arrive from a command line, so a line break in any of them would be printed verbatim and forge
// a line of its own, and an `ESC [ 2 J` would clear the screen the report is being read on. Escaped
// instead, the value keeps its own line and reads as what it is: a value with something odd in it.
test('状态行里的端点、模型与变量名各占一行，值里的控制字符被转义', { skip: NO_PIPES }, async () => {
  const { residentCommand } = await import('../dist/cli/resident.js');
  const LF = String.fromCharCode(0x0a);
  const ESC = String.fromCharCode(0x1b);
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

  // Three lines for three configured values, and no fourth: the forged text is on the line of the
  // value it came in with rather than on a line that looks like the resident's own.
  assert.equal(lines.filter((line) => line.startsWith('语言插件')).length, 3);
  assert.ok(!lines.includes(FORGERY), '值里的换行不得另起一行');
  assert.ok(!lines.some((line) => line.includes(LF) || line.includes(ESC)), '一行里不得留裸控制字符');

  // Escaped rather than dropped: the text is still there, written out as its code point. A status that
  // silently removed it would hide a broken configuration instead of reporting it.
  assert.ok(status.includes('\\n'), '换行应写成它的码点');
  assert.ok(status.includes('\\u001b'), 'ESC 应写成它的码点');
  assert.ok(status.includes(FORGERY) && status.includes('模型：pwned'), '文本本身不被删掉');
});
