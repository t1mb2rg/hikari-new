import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { requestControl } from '../dist/cli/control.js';
import { launchArguments, launchProfilePath, writeLaunchProfile } from '../dist/cli/launch-profile.js';
import { parseCommandLine } from '../dist/cli/options.js';
import { HELP_LINES, readProfileView, spawnDetached } from '../dist/cli/tui.js';
import { EMPTY_EDIT, editLine, isInterrupt, parseSlashCommand, readTuiKey } from '../dist/cli/tui-input.js';
import {
  ENTER_SCREEN,
  LEAVE_SCREEN,
  bodyRows,
  deliveryLabel,
  displayWidth,
  inputLine,
  renderAskScreen,
  renderFrame,
  renderScreen,
  transcriptLines,
  windowTranscript,
} from '../dist/cli/tui-render.js';
import {
  MEMORY_MARKER,
  TRANSCRIPT_LIMIT,
  afterClear,
  appendEntry,
  decideSubmit,
  initialState,
  memoryMarkerNeeded,
  nextView,
  toneLabel,
  toneOfReplied,
} from '../dist/cli/tui-state.js';

const CLI = join(import.meta.dirname, '..', 'dist', 'cli', 'main.js');

// `color: false` unless a test is specifically about colour. Almost every assertion below is about
// *what* is on screen, and escape sequences in the middle of a string turn a readable expectation into
// a string of hex — so colour is opted into rather than filtered out.
const PLAIN = { columns: 80, rows: 24, color: false };

function createRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'hikari-tui-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function runCli(...args) {
  // `spawnSync` gives the child pipes, so `process.stdout.isTTY` is false inside it — which is exactly
  // the condition the TUI refuses on. That makes every call below a test of the refusal path, and it is
  // the only part of `tuiCommand` this machine can drive end to end.
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  assert.equal(result.error, undefined);
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

const strip = (text) => text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

/** The frame's lines, without the terminal control the frame itself writes. */
function frameLines(frame) {
  return frame
    .replace(/^\x1b\[H/, '')
    .replace(/\x1b\[J$/, '')
    .split('\n')
    .map((line) => strip(line.replace(/\x1b\[K$/, '')));
}

function chat(entries = [], extra = {}) {
  return { ...initialState('D:\\hikari-test'), transcript: entries, ...extra };
}

const human = (text, at = '10:00:00') => ({ kind: 'human', at, text });
const reply = (outcome, lines, at = '10:00:01') => ({ kind: 'reply', at, tone: outcome, lines });
const proactive = (lines, at = '10:00:02') => ({ kind: 'proactive', at, lines });
const notice = (text, at = '10:00:03') => ({ kind: 'notice', at, text });

// ---------------------------------------------------------------------------------------------
// The entry point
// ---------------------------------------------------------------------------------------------

test('hikari 不带命令时进入 TUI；非终端下它拒绝并说清楚', () => {
  const bare = runCli();
  assert.equal(bare.code, 1);
  assert.match(bare.stderr, /需要一个终端/);

  // The same refusal with a data directory given: `--data-dir` decides *which* Hikari, not whether
  // there is a terminal to draw on, so it must not change the answer.
  const withDir = runCli('--data-dir', 'D:\\hikari-test');
  assert.equal(withDir.code, 1);
  assert.match(withDir.stderr, /需要一个终端/);
});

test('tui 不是可以打出来的命令字，console 也不再是', () => {
  // The internal command name is this build's own. A second spelling of the default surface would be a
  // second thing to document, and `hikari console` is deliberately gone rather than kept as an alias —
  // the v0 name for this surface was "操作台", and an alias would be the only place it survived.
  assert.equal(runCli('tui').code, 2);
  assert.match(runCli('tui').stderr, /未知命令：tui/);
  assert.equal(runCli('console').code, 2);
  assert.match(runCli('console').stderr, /未知命令：console/);
});

test('--data-dir 在 TUI 里是可选的，且是这个词条里唯一可选的', () => {
  assert.deepEqual(parseCommandLine([]), { command: 'tui', options: { dataDir: undefined } });
  assert.deepEqual(parseCommandLine(['--data-dir', 'D:\\x']), {
    command: 'tui',
    options: { dataDir: 'D:\\x' },
  });
  // No default, no environment variable, no remembered last one. The absence is a question the TUI
  // asks, and the usage text has to say so or an operator reads the empty case as a broken install.
  assert.throws(() => parseCommandLine(['--data-dir']), /需要一个路径/);
});

// ---------------------------------------------------------------------------------------------
// §13: Chat input editing
// ---------------------------------------------------------------------------------------------

test('编辑一行：插入、退格、左右、Home/End、Delete、按词退格、清行', () => {
  const typed = editLine(EMPTY_EDIT, '在吗');
  assert.deepEqual(typed, { kind: 'editing', edit: { text: '在吗', cursor: 2 } });

  const at = typed.edit;
  assert.deepEqual(editLine(at, '\x7f'), { kind: 'editing', edit: { text: '在', cursor: 1 } });

  const moved = editLine(at, '\x1b[D');
  assert.deepEqual(moved, { kind: 'editing', edit: { text: '在吗', cursor: 1 } });
  assert.deepEqual(editLine(moved.edit, '\x1b[C'), { kind: 'editing', edit: { text: '在吗', cursor: 2 } });

  assert.deepEqual(editLine(at, '\x1b[H'), { kind: 'editing', edit: { text: '在吗', cursor: 0 } });
  assert.deepEqual(editLine({ text: '在吗', cursor: 0 }, '\x1b[F'), {
    kind: 'editing',
    edit: { text: '在吗', cursor: 2 },
  });

  // Delete removes the character to the right without moving the cursor; Backspace removes the one to
  // the left and moves. On CJK input the two are the same key only by accident.
  assert.deepEqual(editLine({ text: '在吗', cursor: 0 }, '\x1b[3~'), {
    kind: 'editing',
    edit: { text: '吗', cursor: 0 },
  });

  assert.deepEqual(editLine({ text: 'one two', cursor: 7 }, '\x17'), {
    kind: 'editing',
    edit: { text: 'one ', cursor: 4 },
  });
  assert.deepEqual(editLine({ text: 'abc', cursor: 3 }, '\x15'), {
    kind: 'editing',
    edit: { text: '', cursor: 0 },
  });

  // Past the beginning and past the end are both no-ops rather than errors: the key was recognised and
  // had nothing to do, which is not the same as a keystroke that vanished.
  assert.deepEqual(editLine({ text: 'a', cursor: 0 }, '\x1b[D'), { kind: 'ignored' });
  assert.deepEqual(editLine({ text: 'a', cursor: 1 }, '\x1b[C'), { kind: 'ignored' });
  assert.deepEqual(editLine({ text: 'a', cursor: 0 }, '\x7f'), { kind: 'ignored' });
  assert.deepEqual(editLine({ text: '', cursor: 0 }, '\x15'), { kind: 'ignored' });
});

test('光标按码点走，代理对不会被切一半', () => {
  // `🙂` is two UTF-16 code units. A cursor that lands between them renders a lone surrogate, which most
  // terminals draw as a replacement box — and the editor would then be showing a character that is not
  // in the string.
  const one = editLine(EMPTY_EDIT, '🙂');
  assert.deepEqual(one, { kind: 'editing', edit: { text: '🙂', cursor: 2 } });

  const back = editLine(one.edit, '\x7f');
  assert.deepEqual(back, { kind: 'editing', edit: { text: '', cursor: 0 } });

  const left = editLine(one.edit, '\x1b[D');
  assert.deepEqual(left, { kind: 'editing', edit: { text: '🙂', cursor: 0 } });
});

test('控制字符被拒而不是被塞进句子里，并且拒得看得见', () => {
  // A control character hidden inside a sentence fails later for a reason nobody can see. Refusing it
  // is not the same as ignoring it: the human gets a line back saying so.
  const refused = editLine(EMPTY_EDIT, 'a\x07b');
  assert.equal(refused.kind, 'refused');
  assert.match(refused.reason, /控制字符/);

  // A tab is refused too, and the refusal costs something worth naming: a pasted snippet with a tab in
  // it is refused whole, not silently cleaned. The alternative is worse in both directions — inserting
  // it puts a character in a one-line editor that has no column to advance to, and stripping it would be
  // this surface editing a sentence it was told to carry through unchanged. The human is told instead.
  assert.equal(editLine(EMPTY_EDIT, 'a\tb').kind, 'refused');
  assert.deepEqual(editLine(EMPTY_EDIT, 'a\x07b').reason, editLine(EMPTY_EDIT, 'a\tb').reason);
});

test('粘贴带换行时提交第一行，并把丢掉的部分说出来', () => {
  const one = editLine(EMPTY_EDIT, '第一行\n第二行');
  assert.deepEqual(one, { kind: 'submitted', text: '第一行', dropped: true });

  // A trailing newline is not a second line. Copied text very often carries one, and reporting it would
  // mean warning about a tail that has nothing in it.
  assert.deepEqual(editLine(EMPTY_EDIT, '在吗\n'), { kind: 'submitted', text: '在吗', dropped: false });

  assert.deepEqual(editLine({ text: '你好', cursor: 2 }, '\r'), {
    kind: 'submitted',
    text: '你好',
    dropped: false,
  });
});

test('粘贴的第一行是空的时候，那是剪贴板噪声，不是一次提交', () => {
  // Found by an adversarial review, reproduced here, and then fixed. "A line terminator anywhere in the
  // chunk means submit" read a *leading* blank line as "submit the line before it" — and there is no line
  // before it. `head` was empty, so the submitted text was whatever the editor already held, and with the
  // editor empty that became an empty submit, which the caller drops without a word because an empty line
  // is normally just a slipped Enter. Copied text very often begins with a blank line, so the human's
  // sentence disappeared and the screen said nothing at all: not the text, not a reply, and not even the
  // notice this file's caller shows for a paste whose *tail* it cut.
  for (const chunk of ['\n在吗', '\n\n在吗', '  \n  \n在吗', '\r\n在吗', '\n\n\n在吗']) {
    assert.deepEqual(
      editLine(EMPTY_EDIT, chunk),
      { kind: 'editing', edit: { text: '在吗', cursor: 2 } },
      `粘贴 ${JSON.stringify(chunk)} 该把正文放进编辑行，而不是当成一次空提交`,
    );
  }

  // The two shapes that must not change, because they are why the rule is about a *run of blank lines*
  // and not about a leading terminator as such. A bare Enter has nothing after the terminator, so it
  // still submits the line the human was on — that is the behaviour both prompts have always shared.
  assert.deepEqual(editLine({ text: '你好', cursor: 2 }, '\r'), { kind: 'submitted', text: '你好', dropped: false });
  assert.deepEqual(editLine(EMPTY_EDIT, '\n\n'), { kind: 'submitted', text: '', dropped: false });

  // And the combination the old reading hid is now unreachable: a chunk only reaches the submit branch
  // when its first line has something on it, so "dropped something" and "submitted nothing" cannot
  // coincide and be silently dropped together.
  for (const chunk of ['\n在吗', 'a\nb', '在吗\n', '\r', '\n\n', 'x\ny\nz']) {
    const parsed = editLine(EMPTY_EDIT, chunk);
    if (parsed.kind !== 'submitted') continue;
    assert.equal(
      parsed.dropped && decideSubmit({ asking: false }, parsed.text).kind === 'empty',
      false,
      `${JSON.stringify(chunk)} 会被无声丢掉：既没有文字，也没有提示`,
    );
  }
});

test('没绑定的转义序列被忽略，不会被当成退格也不会被插进去', () => {
  assert.deepEqual(editLine(EMPTY_EDIT, '\x1b[99~'), { kind: 'ignored' });
  assert.deepEqual(editLine(EMPTY_EDIT, ''), { kind: 'ignored' });
});

// ---------------------------------------------------------------------------------------------
// §13: normal text → Language ask; the slash vocabulary is closed; 帮我重启 is not /restart
// ---------------------------------------------------------------------------------------------

test('普通文本原样交给 Language，连前后的空格也不动', () => {
  const decision = decideSubmit({ asking: false }, '  在吗  ');
  assert.deepEqual(decision, { kind: 'ask', text: '  在吗  ' });

  // Whitespace decides *whether* there is anything to send, and nothing else.
  assert.deepEqual(decideSubmit({ asking: false }, '   '), { kind: 'empty' });
  assert.deepEqual(decideSubmit({ asking: false }, ''), { kind: 'empty' });
});

test('「帮我重启」不是 /restart，它照常是一句话', () => {
  // This is the rule the whole input policy exists to keep. The test is deliberately written as a
  // sentence that *sounds* like a command, because the failure mode is a later edit adding a keyword
  // list "so the obvious things work" — and every such list needs a judgement about which sentences
  // are really instructions.
  assert.deepEqual(decideSubmit({ asking: false }, '帮我重启'), { kind: 'ask', text: '帮我重启' });
  assert.deepEqual(decideSubmit({ asking: false }, '看看状态'), { kind: 'ask', text: '看看状态' });
  assert.deepEqual(decideSubmit({ asking: false }, 'stop'), { kind: 'ask', text: 'stop' });
  assert.deepEqual(decideSubmit({ asking: false }, '退出'), { kind: 'ask', text: '退出' });

  // And a leading space is enough to make `/help` a sentence rather than a command: the test is the
  // first character, not the first non-space character.
  assert.deepEqual(decideSubmit({ asking: false }, ' /help'), { kind: 'ask', text: ' /help' });
});

test('slash 词表是闭集：八个命令、大小写敏感、认识第一个词为止', () => {
  const expected = {
    '/help': 'help',
    '/clear': 'clear',
    '/status': 'status',
    '/start': 'start',
    '/stop': 'stop',
    '/restart': 'restart',
    '/profile': 'profile',
    '/quit': 'quit',
  };
  for (const [word, kind] of Object.entries(expected)) {
    assert.deepEqual(parseSlashCommand(word), { kind: 'command', command: { kind } });
    assert.deepEqual(decideSubmit({ asking: false }, word), {
      kind: 'command',
      command: { kind },
    });
  }

  // A typo is reported rather than forwarded. The `/` already said the human meant an instruction, so
  // sending `/hlep` to a model would spend a call to answer nothing — and the human would be reading
  // Hikari's prose wondering why their command was ignored.
  assert.deepEqual(parseSlashCommand('/hlep'), { kind: 'unknown', word: '/hlep' });
  assert.equal(decideSubmit({ asking: false }, '/hlep').kind, 'refused');
  assert.match(decideSubmit({ asking: false }, '/hlep').reason, /没有这个命令/);

  // Case is not folded. `/Help` is not `/help`, and a reader that folded it would have a normalisation
  // rule — one step short of the intent-guessing this split exists to prevent.
  assert.deepEqual(parseSlashCommand('/Help'), { kind: 'unknown', word: '/Help' });
  assert.deepEqual(parseSlashCommand('/HELP'), { kind: 'unknown', word: '/HELP' });

  // Only the first token is consulted, and the argument is dropped rather than forwarded: none of the
  // eight takes one, and an argument grammar would be the routing table this file exists not to have.
  assert.deepEqual(parseSlashCommand('/status 一下'), { kind: 'command', command: { kind: 'status' } });
  assert.deepEqual(parseSlashCommand('普通文本'), { kind: 'none' });
});

// ---------------------------------------------------------------------------------------------
// §13: one ask in-flight; pending does not stop delivery or the System view
// ---------------------------------------------------------------------------------------------

test('一次最多一个 ask in-flight，但本地命令不排队', () => {
  assert.deepEqual(decideSubmit({ asking: true }, '在吗'), { kind: 'busy' });
  // A command is not an ask. `/stop` while a question is in flight is a thing an operator may well
  // need, and refusing it would make the one screen that can stop a runaway resident unavailable
  // exactly when it is wanted.
  assert.deepEqual(decideSubmit({ asking: true }, '/stop'), {
    kind: 'command',
    command: { kind: 'stop' },
  });
  assert.deepEqual(decideSubmit({ asking: true }, '/status'), {
    kind: 'command',
    command: { kind: 'status' },
  });
  // An unknown command is still refused rather than reported as busy: the vocabulary is consulted
  // before the in-flight rule, so the human hears about the typo immediately.
  assert.equal(decideSubmit({ asking: true }, '/nope').kind, 'refused');
});

test('一个 ask 在飞时，主动投递照样进 transcript，并和 pending 标记同时存在', () => {
  let state = chat([human('在吗')], { asking: true });
  state = { ...state, transcript: appendEntry(state.transcript, proactive(['构建失败了'])) };

  const frame = renderScreen(state, PLAIN).join('\n');
  assert.match(frame, /在吗/);
  assert.match(frame, /构建失败了/);
  assert.match(frame, /Hikari 在想…/);
  // The question is still on screen. The pending marker holds a row back for exactly this reason: a
  // marker that evicted its own prompt would be the surface hiding what it is waiting on.
  assert.match(strip(frame), /◌ Hikari 在想…/);
});

test('一个 ask 在飞时，System view 的内容与不在飞时逐字节相同', () => {
  const control = {
    kind: 'answered',
    outcome: 'ok',
    lines: ['continuity 状态：active', 'language 状态：active'],
  };
  const idle = renderScreen(chat([], { view: 'system', control }), PLAIN);
  const asking = renderScreen(chat([], { view: 'system', control, asking: true }), PLAIN);

  // Everything except the input row is identical, and the input row is the one line that *should*
  // differ: §5.3's pending state has to be visible somewhere, and the prompt is where this surface says
  // it without adding a row that would move the view under the human's cursor.
  assert.deepEqual(asking.slice(0, -2), idle.slice(0, -2));
  assert.equal(idle[idle.length - 2].startsWith('> '), true);
  assert.equal(asking[asking.length - 2].startsWith('… '), true);
});

// ---------------------------------------------------------------------------------------------
// §13: the Language outcomes, and the colour rule
// ---------------------------------------------------------------------------------------------

test('Language 的每个结局各自有名字，不合并', () => {
  assert.equal(toneLabel('chatted'), 'Hikari');
  assert.equal(toneLabel('answered'), 'Hikari');
  assert.match(toneLabel('refused'), /没有回答/);
  assert.match(toneLabel('failed'), /失败/);
  assert.match(toneLabel('absent'), /语言入口/);
  assert.match(toneLabel('unreachable'), /联系不上/);

  // refused and failed are different words for different events, and the type has no member that three
  // of them could be collapsed into.
  assert.notEqual(toneLabel('refused'), toneLabel('failed'));

  // `recorded` is the fifth protocol outcome and the one that must not share a label with the other
  // two successes, because it is the only one under which something was *kept*. What a person reads is
  // already different — the plugin's own three lines rather than an answer — and what this pins is the
  // mark beside it: a window that rendered it as `answered` would say Hikari looked something up where
  // what happened is that Hikari wrote down what the person said.
  assert.equal(toneLabel('recorded'), 'Hikari');
  assert.notEqual(toneOfReplied({ outcome: 'recorded' }), toneOfReplied({ outcome: 'answered' }));
  assert.notEqual(toneOfReplied({ outcome: 'recorded' }), toneOfReplied({ outcome: 'chatted' }));

  // §9/§12, and the assertion that would have caught the mislabelling: a resident that is running with
  // no model loaded returns `absent` from the ask client, which is a real observed pair — a probe against
  // a live resident printed `status answered` and `ask absent` one after the other. So the label for
  // `absent` must not name the resident, or the window contradicts its own header two lines above.
  for (const tone of ['absent', 'unreachable']) {
    assert.equal(
      /常驻|resident|停止|stopped|离线|offline/.test(toneLabel(tone)),
      false,
      `${tone} 的标签不得提到常驻，否则会和 header 里「正在运行」自相矛盾：${toneLabel(tone)}`,
    );
  }

  // The tone comes off the protocol's own field, unchanged. This function exists so that a rename of
  // the protocol's vocabulary stops compiling rather than silently rendering the wrong word.
  assert.equal(toneOfReplied({ outcome: 'answered' }), 'answered');
  assert.equal(toneOfReplied({ outcome: 'failed' }), 'failed');
  assert.equal(toneOfReplied({ outcome: 'recorded' }), 'recorded');
});

test('颜色只来自协议字段，不来自任何一行文字', () => {
  const colored = { columns: 80, rows: 24, color: true };

  const failed = renderScreen(chat([reply('failed', ['回答失败了'])]), colored).join('\n');
  assert.match(failed, /\x1b\[31m/);

  const refused = renderScreen(chat([reply('refused', ['我不会回答这个'])]), colored).join('\n');
  assert.match(refused, /\x1b\[33m/);

  const chatted = renderScreen(chat([reply('chatted', ['在的'])]), colored).join('\n');
  assert.match(chatted, /\x1b\[36m/);

  // The line this rule must not cross. A status line that *contains* the word 失败 is still a sentence
  // the resident wrote for a person, and the outcome beside it is `ok` — so the resident's own line
  // takes its colour from the outcome field, and the status sentence goes out with no styling at all.
  const state = chat([], { view: 'system', control: { kind: 'answered', outcome: 'ok', lines: ['上一步失败了，但常驻在运行'] } });
  const coloredFrame = renderScreen(state, colored).join('\n');
  assert.ok(coloredFrame.includes('\x1b[32m'), '常驻这一行应当按 outcome=ok 上绿色');

  const statusRow = renderScreen(state, colored).find((line) => strip(line).includes('上一步失败了'));
  assert.equal(strip(statusRow), '上一步失败了，但常驻在运行');
  assert.equal(statusRow.includes('\x1b[31m'), false, 'status 行里的「失败」两个字不允许决定颜色');
  assert.equal(statusRow.includes('\x1b'), false, 'status 行原样，连样式都不加');
});

test('关掉颜色之后，屏幕正文里没有任何 SGR 序列', () => {
  const frame = renderScreen(
    chat([human('在吗'), reply('failed', ['不行'])], {
      control: { kind: 'answered', outcome: 'failed', lines: ['x'] },
      delivery: { kind: 'stopped', tone: 'unreachable', detail: 'pipe busy' },
    }),
    PLAIN,
  );
  for (const line of frame) assert.equal(line.includes('\x1b'), false, line);
});

// ---------------------------------------------------------------------------------------------
// §13: proactive lines verbatim; Language lines verbatim; transcript bound
// ---------------------------------------------------------------------------------------------

test('主动投递的 lines 逐字进窗口，只加标记与本地时间', () => {
  const lines = ['CI 失败：owner/name', 'a\\b  路径原样'];
  const frame = frameLines(renderFrame(chat([proactive(lines, '09:15:00')]), PLAIN)).join('\n');

  for (const line of lines) assert.ok(frame.includes(line), `少了这一行：${line}`);
  assert.match(frame, /PROACTIVE/);
  assert.match(frame, /09:15:00/);
});

test('投递的 lines 在条目里一个字节都不改；只有排版把制表符放成一个空格', () => {
  // These are two different claims about two different places, and keeping them in one test is the point
  // — a reader who finds a tab turned into a space in the frame should be able to see, right here, that
  // the entry itself still holds the tab.
  //
  // The entry is what §8's "lines 原样" is about, and it is untouched: what went into `transcript` is what
  // came off the pipe. The frame is a grid, and a grid has to decide which cell every character occupies.
  // A tab occupies "however many columns carry you to the next multiple of eight", which this renderer
  // cannot compute and — because rows are separated with a bare `\n` and the carriage never returns — the
  // terminal cannot agree on either. Emitting one hands the row's height to the terminal, and a row the
  // terminal wraps pushes the input line off the bottom. `clip` already drops the tail of a line that
  // does not fit, so the grid is permitted to make text fit; a space is the smallest thing that does.
  const lines = ['制表\t符保留'];
  const state = chat([proactive(lines, '09:15:00')]);

  assert.equal(state.transcript[0].lines[0], '制表\t符保留', '条目本身必须原样留着制表符');
  assert.equal(state.transcript[0].lines[0].includes('\t'), true);

  const frame = frameLines(renderFrame(state, PLAIN)).join('\n');
  assert.ok(frame.includes('制表 符保留'), '排版里应当是一个空格');
  assert.equal(frame.includes('\t'), false, '整帧不得含制表符');
});

test('Language 的 reply lines 逐字进屏幕，不被二次转义也不被改写', () => {
  const lines = ['第一行', 'C:\\Users\\x\\a.txt'];
  const frame = frameLines(renderFrame(chat([reply('answered', lines)]), PLAIN)).join('\n');

  for (const line of lines) assert.ok(frame.includes(line), `少了这一行：${line}`);
  // Escaped twice would show a human backslashes the resident never sent; the resident already ran
  // every line it emits through `oneLine`, and this surface is not allowed to do it again.
  assert.ok(frame.includes('C:\\Users\\x\\a.txt'));
});

test('status lines 原样、按顺序、不排序不摘要', () => {
  const lines = ['zzz 状态：active', 'aaa 状态：active', 'continuity 状态：active'];
  const screen = renderScreen(chat([], { view: 'system', control: { kind: 'answered', outcome: 'ok', lines } }), PLAIN);
  const text = screen.join('\n');
  for (const line of lines) assert.ok(text.includes(line), `少了这一行：${line}`);

  // The order is the order they arrived, not alphabetical: §6 forbids reading these sentences into
  // fields, and sorting them would be the first half of doing exactly that.
  assert.ok(text.indexOf('zzz') < text.indexOf('aaa'));
});

test('transcript 有界，最早的一条被挤掉', () => {
  let transcript = [];
  for (let index = 0; index < TRANSCRIPT_LIMIT; index += 1) {
    transcript = appendEntry(transcript, human(`第 ${index} 条`));
  }
  assert.equal(transcript.length, TRANSCRIPT_LIMIT);
  assert.equal(transcript[0].text, '第 0 条');

  transcript = appendEntry(transcript, human('最后一次'));
  assert.equal(transcript.length, TRANSCRIPT_LIMIT);
  assert.equal(transcript[0].text, '第 1 条');
  assert.equal(transcript[transcript.length - 1].text, '最后一次');
});

test('/clear 只清这个窗口，别的状态一个字段都不动', () => {
  const before = chat([human('在吗'), reply('answered', ['在的']), notice('提示')], {
    scroll: 3,
    asking: true,
    launching: true,
    control: { kind: 'answered', outcome: 'ok', lines: ['x'] },
    delivery: { kind: 'stopped', tone: 'ended', detail: '' },
  });

  const after = afterClear(before);
  assert.deepEqual(after.transcript, []);
  assert.equal(after.scroll, 0);

  // Everything that is not the window is untouched, and the list is the point: the dialogue context
  // and the chronicle belong to the resident, memory belongs to nobody this process can reach, and the
  // control answer is a fact about another process. A `/clear` that reset `control` would be this
  // surface forgetting something it did not own.
  const { transcript, scroll, ...unchanged } = before;
  const { transcript: clearedTranscript, scroll: clearedScroll, ...alsoUnchanged } = after;
  assert.deepEqual(alsoUnchanged, unchanged);
  assert.equal(clearedTranscript.length, 0);
  assert.equal(clearedScroll, 0);
});

// ---------------------------------------------------------------------------------------------
// §13: view switching; System and Profile views
// ---------------------------------------------------------------------------------------------

test('Tab 依次切过三个 view 并绕回', () => {
  assert.equal(nextView('chat'), 'system');
  assert.equal(nextView('system'), 'profile');
  assert.equal(nextView('profile'), 'chat');
  assert.deepEqual([...new Set(['chat', 'system', 'profile'].map(nextView))].sort(), [
    'chat',
    'profile',
    'system',
  ]);
});

test('Profile view 从 typed profile 渲染，不从等价命令行反解析', (t) => {
  const root = createRoot(t);
  writeLaunchProfile(root, {
    desktopAwarenessDelayMs: 1000,
    model: { endpoint: 'http://127.0.0.1:11434/v1/chat/completions', model: 'local-model' },
    repositoryCi: { rootDir: 'G:\\work\\LAB\\code\\hikari-new', repository: 'owner/name' },
    proactiveCiDelayMs: 5000,
  });

  const view = readProfileView(root);
  assert.equal(view.kind, 'profile');
  assert.equal(view.path, launchProfilePath(root));

  const field = (label) => view.fields.find((entry) => entry.label === label);
  assert.deepEqual(field('模型入口'), {
    label: '模型入口',
    value: 'http://127.0.0.1:11434/v1/chat/completions',
    set: true,
  });
  assert.deepEqual(field('模型'), { label: '模型', value: 'local-model', set: true });
  assert.deepEqual(field('仓库'), { label: '仓库', value: 'owner/name', set: true });
  assert.deepEqual(field('proactive CI 延迟'), { label: 'proactive CI 延迟', value: '5000 ms', set: true });
  assert.deepEqual(field('desktop-awareness 延迟'), {
    label: 'desktop-awareness 延迟',
    value: '1000 ms',
    set: true,
  });

  // Not set is `set: false` and an empty value, never a rendered sentence. A field the profile simply
  // does not have must not be shown as some value a reader would take for a setting.
  for (const label of ['推理强度', '凭据环境变量', 'proactive 回归延迟', 'proactive 回归窗口']) {
    assert.deepEqual(field(label), { label, value: '', set: false });
  }
});

test('profile 的凭据只显示环境变量的名字，不显示值', (t) => {
  const root = createRoot(t);
  writeLaunchProfile(root, {
    desktopAwarenessDelayMs: 1000,
    model: {
      endpoint: 'http://127.0.0.1:1/v1/chat/completions',
      model: 'm',
      credentialEnv: 'HIKARI_TEST_MODEL_CREDENTIAL',
    },
  });

  const view = readProfileView(root);
  const credential = view.fields.find((entry) => entry.label === '凭据环境变量');
  assert.deepEqual(credential, {
    label: '凭据环境变量',
    value: 'HIKARI_TEST_MODEL_CREDENTIAL',
    set: true,
  });

  // The value itself is not on this side of the boundary and never was: the process that holds it reads
  // it at bring-up, in another process.
  const rendered = renderScreen(chat([], { view: 'profile', profile: view }), PLAIN).join('\n');
  assert.match(rendered, /HIKARI_TEST_MODEL_CREDENTIAL/);
  assert.equal(process.env.HIKARI_TEST_MODEL_CREDENTIAL, undefined);
});

test('没有启动配置与读不动的启动配置是两件不同的事', (t) => {
  const root = createRoot(t);
  assert.deepEqual(readProfileView(root), { kind: 'none' });

  writeFileSync(launchProfilePath(root), '{ 这不是 JSON', 'utf8');
  const unreadable = readProfileView(root);
  assert.equal(unreadable.kind, 'unreadable');
  assert.ok(unreadable.reason.length > 0);

  // The two are not collapsed: "nothing configured" is a state an operator fixes with `profile set`,
  // and "the file is broken" is a different fix. Both render, and neither renders as a field list.
  const none = renderScreen(chat([], { view: 'profile' }), PLAIN).join('\n');
  assert.match(none, /正在读取启动配置/);
  const broken = renderScreen(chat([], { view: 'profile', profile: unreadable }), PLAIN).join('\n');
  assert.match(broken, /启动配置无法读取/);
});

test('常驻的三种控制结局各有各的说法，不合并成一句「离线」', () => {
  const describe = (control) => renderScreen(chat([], { view: 'system', control }), PLAIN).join('\n');

  assert.match(describe({ kind: 'answered', outcome: 'ok', lines: [] }), /正在运行。/);
  assert.match(describe({ kind: 'answered', outcome: 'failed', lines: [] }), /报告了失败/);
  assert.match(describe({ kind: 'absent' }), /没有运行。/);
  assert.match(describe({ kind: 'unreachable', detail: 'EPIPE' }), /无法访问控制通道/);
});

// ---------------------------------------------------------------------------------------------
// §13: delivery unavailable does not break chat
// ---------------------------------------------------------------------------------------------

test('投递拿不到时 Chat 照常工作，header 如实说', () => {
  const ended = { kind: 'stopped', tone: 'ended', detail: '' };
  const absent = { kind: 'stopped', tone: 'absent', detail: '' };
  const unreachable = { kind: 'stopped', tone: 'unreachable', detail: 'pipe busy' };

  assert.equal(deliveryLabel({ kind: 'listening' }), '主动投递 监听中');
  assert.match(deliveryLabel(ended), /已断开/);
  assert.match(deliveryLabel(absent), /不可用（没有端点在提供它）/);
  assert.match(deliveryLabel(unreachable), /pipe busy/);

  // Three endings, three sentences. `ended` is not a fault (the resident stopped, or another listener
  // had the endpoint), `absent` says nothing about whether Hikari is running, and neither of those is
  // "Hikari 离线" — which would be the one word that is wrong about all three.
  assert.notEqual(deliveryLabel(ended), deliveryLabel(absent));
  assert.notEqual(deliveryLabel(absent), deliveryLabel(unreachable));

  // The claim in that comment is checked rather than asserted in prose, because the string above used to
  // break it: `absent` used to read `没有常驻在提供它`, and a resident *can* be running while this endpoint
  // is unserved — it only loads the delivery transport when a decider was configured for it. A probe
  // against a resident started with no proactive flags reported `status answered` and a subscription
  // `absent`, so a label naming the resident would have been false on a screen whose header said
  // `正在运行。`. None of the three endings may name the resident.
  for (const delivery of [ended, absent, unreachable]) {
    assert.equal(
      /常驻|resident|离线|offline|停止|stopped/.test(deliveryLabel(delivery)),
      false,
      `投递的标签不得提到常驻：${deliveryLabel(delivery)}`,
    );
  }

  // And the chat itself is untouched by any of it: the transcript renders, the input row renders, and
  // the human can still type. A surface that stopped working because it could not be spoken to would be
  // one that made its own listening condition a precondition for being used.
  for (const delivery of [ended, absent, unreachable]) {
    const frame = renderScreen(chat([human('在吗'), reply('answered', ['在的'])], { delivery }), PLAIN).join('\n');
    assert.match(frame, /在吗/);
    assert.match(frame, /在的/);
    // The prompt and the cursor are still there: a surface that stopped accepting input because it could
    // not be spoken to would have made its own listening condition a precondition for being used.
    const idle = renderScreen(chat([], { delivery }), PLAIN);
    assert.ok(idle.some((line) => line.startsWith('> ')), idle.join('\n'));
  }
});

// ---------------------------------------------------------------------------------------------
// §13: frame geometry, ANSI width accounting, shrinking, resize
// ---------------------------------------------------------------------------------------------

test('帧高不超过窗口，正文的每一行都不超过窗口宽度', () => {
  const sizes = [
    { columns: 80, rows: 24 },
    { columns: 44, rows: 14 },
    { columns: 30, rows: 10 },
    { columns: 20, rows: 8 },
    { columns: 12, rows: 7 },
    { columns: 8, rows: 4 },
    { columns: 4, rows: 3 },
  ];

  const state = chat(
    [human('中文宽度测试🙂），行很长很长很长很长很长很长很长很长很长'), reply('answered', ['回答也是中文的很长的一行文字'])],
    {
      view: 'system',
      control: { kind: 'answered', outcome: 'ok', lines: ['continuity 状态：active，这一行也很长很长很长很长'] },
      delivery: { kind: 'stopped', tone: 'unreachable', detail: '一段很长的原因说明' },
      profile: { kind: 'unreadable', reason: '一段很长的理由' },
    },
  );

  for (const size of sizes) {
    for (const view of ['chat', 'system', 'profile']) {
      const screen = renderScreen({ ...state, view }, { ...size, color: true });
      assert.ok(screen.length <= size.rows, `${view} @ ${size.columns}x${size.rows} 帧高 ${screen.length}`);
      for (const line of screen) {
        // Measured after stripping the SGR the frame itself wrote: the width that matters is what the
        // terminal advances, and a line measured as narrower than it is wraps and pushes the input row
        // off the bottom of the window.
        assert.ok(
          displayWidth(strip(line)) <= size.columns,
          `${view} @ ${size.columns}x${size.rows} 这一行有 ${displayWidth(strip(line))} 列：${strip(line)}`,
        );
      }
      // The input row survives at every size where the header does. Below `CHROME_ROWS` the frame is
      // clamped from the bottom, so this is asserted from the smallest size that fits the chrome.
      if (size.rows >= 7) assert.equal(screen.length, size.rows);
    }
  }
});

test('宽字符按两列计，且不会被切一半', () => {
  assert.equal(displayWidth('a'), 1);
  assert.equal(displayWidth('中文'), 4);
  assert.equal(displayWidth('🙂'), 2);
  assert.equal(displayWidth('e\u0301'), 1); // combining acute
  assert.equal(displayWidth(''), 0);

  // A cut wide character has no half, so it is dropped rather than written — the ellipsis takes the last
  // column that fits.
  const clipped = renderScreen(chat([human('中文中文中文中文中文中文')]), { columns: 7, rows: 12, color: false });
  for (const line of clipped) assert.ok(displayWidth(line) <= 7, line);
  assert.ok(clipped.some((line) => line.includes('…')));
});

test('光标停在 emoji 上时，画出去的每一段都不是半个代理对', () => {
  // Found by an adversarial review and fixed. The row is written span by span, each wrapped in its own
  // SGR codes, so a surrogate pair split across two spans is split on the wire — and the two halves reach
  // the terminal as two replacement boxes where the human pasted one emoji. That is why this checks each
  // span rather than the finished line: joining the spans back into one string recombines the pair and
  // hides exactly the defect being looked for.
  //
  // The shape is reachable without anything unusual: paste an emoji, press Home. The cursor only ever
  // lands on an astral character whole — that is what the editor's own cursor arithmetic guarantees — so
  // the reverse-video cell and the tail on either side of it are where a code-unit cut showed up. The
  // width accounting was a cell out at the same time, because `displayWidth` was asked about half a
  // character.
  const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;

  for (const columns of [40, 12, 6, 4]) {
    for (const [text, cursor] of [['😀在吗', 0], ['😀在吗', 2], ['在😀吗', 1], ['😀', 0], ['plain', 2]]) {
      const edit = { text, cursor };
      for (const span of inputLine({ ...initialState('D:\\hikari-test'), edit }, { columns, rows: 24, color: true })) {
        assert.equal(
          LONE.test(span.text),
          false,
          `columns=${columns} text=${JSON.stringify(text)} cursor=${cursor} 这一段是半个代理对：${JSON.stringify(span.text)}`,
        );
      }
    }
  }

  // And the emoji is still one character on screen rather than two halves drawn separately.
  const shown = inputLine({ ...initialState('D:\\hikari-test'), edit: { text: '😀在吗', cursor: 0 } }, { columns: 40, rows: 24, color: false });
  assert.equal(shown.map((span) => span.text).join(''), '> 😀在吗');
});

test('投递里带制表符时，这一行仍然不超过窗口宽度', () => {
  // This is the one case `displayWidth` cannot police, and the reason it needs its own test: a tab is
  // below 0x20, so that function counts it as zero cells, and every "no line exceeds the window"
  // assertion in this file is written in terms of it. A line containing a tab therefore passes all of
  // them while a terminal draws it wider. So the check below measures the way a terminal lays the line
  // out — a tab advancing to the next multiple of eight — and the shape is the one that was found to
  // break: at 40 columns, a reply line of `'x'.repeat(32) + '\t' + '尾'` used to render 41 cells wide.
  //
  // The tab is not hypothetical. Replies and deliveries both reach the frame through the resident's
  // `oneLine`, which spells control characters out but deliberately leaves 0x09 alone — so this is the
  // one control character that arrives, and `'第二行\t带制表符'` was produced by a real resident through
  // the fake model endpoint while checking the escaping rule.
  const rendered = (line) => {
    let column = 0;
    for (const character of strip(line)) {
      const code = character.codePointAt(0) ?? 0;
      if (code === 0x09) column += 8 - (column % 8);
      else column += displayWidth(character);
    }
    return column;
  };

  for (let pad = 0; pad <= 70; pad += 1) {
    for (const columns of [40, 24, 12, 80]) {
      const state = chat([reply('chatted', [`${'x'.repeat(pad)}\t尾`]), proactive([`\t缩进${pad}`])]);
      for (const line of renderScreen(state, { columns, rows: 24, color: false })) {
        assert.ok(
          rendered(line) <= columns,
          `columns=${columns} pad=${pad} 这一行画出来有 ${rendered(line)} 列：${JSON.stringify(strip(line))}`,
        );
      }
    }
  }

  // And the standing invariant still holds for the same content, so the two measures agree rather than
  // the fix having satisfied one by breaking the other.
  for (const line of renderScreen(chat([reply('chatted', ['先\t后'])]), { columns: 40, rows: 24, color: false })) {
    assert.ok(displayWidth(strip(line)) <= 40, strip(line));
  }
});

test('新的一帧清掉旧的一帧：行尾清除，帧下擦除', () => {
  const frame = renderFrame(chat([human('在吗')]), PLAIN);
  // The three parts are separate claims. The cursor goes home so no scrolling or cursor arithmetic is
  // needed between frames; each line is cleared to its own end so nothing of the previous frame is left
  // to the right of a shorter new one; and the tail below is erased, which is what a Tab needs.
  assert.ok(frame.startsWith('\x1b[H'), '帧应当从左上角开始');
  assert.ok(frame.endsWith('\x1b[J'), '帧应当擦除下面剩下的部分');

  // Every written line is cleared to its own end, so nothing of the previous frame is left to the right
  // of a shorter new one. The last segment carries the erase-below after its clear, so it is the one that
  // does not end with `\x1b[K` — asserted rather than skipped over, because that is where the two parts
  // meet.
  const segments = frame.replace(/^\x1b\[H/, '').replace(/\x1b\[J$/, '').split('\n');
  assert.ok(segments.length > 1);
  for (const segment of segments) assert.ok(segment.endsWith('\x1b[K'), segment);
  assert.equal(frame.includes('\x1b[2J'), false, '擦除整屏是进入时的事，不是每一帧的事');
});

test('切到更短的 view 之后，帧仍然擦掉下面剩下的部分', () => {
  const long = renderScreen(
    chat([], { view: 'system', control: { kind: 'answered', outcome: 'ok', lines: ['一', '二', '三', '四', '五'] } }),
    PLAIN,
  );
  const short = renderScreen(chat([], { view: 'chat' }), PLAIN);
  assert.ok(long.some((line) => line.includes('五')));
  assert.equal(short.some((line) => line.includes('五')), false);

  // A frame shorter than the one before it leaves the old one's tail on screen, read as though it
  // belonged to the new view. The erase-below is what stops that, and it is on every frame rather than
  // only the ones that shrank.
  assert.ok(renderFrame(chat([], { view: 'chat' }), PLAIN).endsWith('\x1b[J'));
});

test('resize 只是换一个尺寸重画：transcript、当前输入、scroll 都不动', () => {
  const before = chat([human('第一句'), reply('answered', ['回答']), proactive(['主动说的'])], {
    edit: { text: '我还没发出去的话', cursor: 9 },
    scroll: 2,
  });
  const snapshot = JSON.stringify(before);

  const wide = renderScreen(before, { columns: 80, rows: 24, color: false });
  const narrow = renderScreen(before, { columns: 40, rows: 12, color: false });
  const tiny = renderScreen(before, { columns: 24, rows: 8, color: false });

  // Rendering is a function of the state and the window, and of nothing else — so a resize cannot lose
  // a transcript, cancel an ask or restart a resident, because none of those are things drawing can do.
  assert.equal(JSON.stringify(before), snapshot);
  for (const frame of [wide, narrow, tiny]) {
    const text = frame.join('\n');
    assert.ok(text.includes('我还没发出去的话') || text.includes('我还没发出'), `输入行丢了：${text}`);
  }

  // A narrow window degrades rather than crashing: it is shorter and it clips, and it is still a frame.
  assert.ok(narrow.length <= 12);
  assert.ok(tiny.length <= 8);
  assert.match(strip(tiny.join('\n')), /Hikari/);
});

test('窗口太窄时 header 仍在，并且三行各自被裁而不是互相删掉', () => {
  const state = chat([], {
    delivery: { kind: 'stopped', tone: 'absent', detail: '' },
  });
  const narrow = renderScreen(state, { columns: 16, rows: 24, color: false }).map(strip);

  // Clipping is by row, which is why the header is three rows: merged into one, a narrow window would
  // delete whichever of the three came last — and on the window where it matters most, that is the one
  // saying Hikari will not be reaching this surface at all.
  assert.ok(narrow[0].includes('Hikari'));
  assert.ok(narrow[1].includes('Chat'));
  assert.ok(narrow[2].includes('数据目录'));
  for (const line of narrow.slice(0, 3)) assert.ok(displayWidth(line) <= 16, line);
});

test('空窗口不是一片空白，它说该做什么', () => {
  const screen = renderScreen(chat(), PLAIN).map(strip);
  assert.ok(screen.some((line) => line.includes('直接输入一句话')));
  // And nothing is lost when the first line arrives: the hint sits at the bottom, where the sentence
  // will be, so the screen does not jump a row on the first keystroke.
  const withText = renderScreen(chat([human('在吗')]), PLAIN).map(strip);
  assert.equal(withText.some((line) => line.includes('直接输入一句话')), false);
  assert.ok(withText.some((line) => line.includes('在吗')));
});

test('滚动按行回退，最多退到最早的一行', () => {
  const lines = transcriptLines([human('一'), human('二'), human('三')]);
  const bottom = windowTranscript(lines, 2, 0);
  const back = windowTranscript(lines, 2, 2);
  const past = windowTranscript(lines, 2, 999);

  assert.equal(bottom.length, 2);
  assert.equal(back.length, 2);
  assert.equal(past.length, 2);
  // `scroll` counts lines back from the newest, and 0 is the live bottom. Padding goes at the top, which
  // is what keeps the input row still as the conversation grows.
  assert.notDeepEqual(bottom, back);
  assert.deepEqual(past, windowTranscript(lines, 2, lines.length));
});

// ---------------------------------------------------------------------------------------------
// §13 / §7: the transcript is this process's, and it says so
// ---------------------------------------------------------------------------------------------

test('常驻回来之后窗口会说这些内容 Hikari 并不记得', () => {
  const one = [human('在吗')];
  assert.equal(memoryMarkerNeeded(one, true), true);
  assert.equal(memoryMarkerNeeded(one, false), false);
  assert.equal(memoryMarkerNeeded([], true), false);

  const frame = renderScreen(chat([...one, notice(MEMORY_MARKER)]), PLAIN).join('\n');
  assert.match(frame, /只在这个进程里/);
  assert.match(frame, /不记得它/);
});

test('notice 是 TUI 自己的声音，和 Hikari 说的话不是同一种东西', () => {
  const lines = transcriptLines([notice('粘贴的内容里有换行，只发出了第一行。')]);
  assert.ok(lines.length >= 2);
  // Every notice line carries the dim code, so the frame's own voice is visually distinct from a reply
  // — and no notice is ever labelled as Hikari, which is the property `toneLabel` exists to keep.
  for (const part of lines[1]) assert.deepEqual(part.codes, ['\x1b[2m']);
});

// ---------------------------------------------------------------------------------------------
// §13 / §7: /help is many lines, and it stays many lines all the way to the screen
// ---------------------------------------------------------------------------------------------

// A notice is one string, and `oneLine` replaces every break in a string with the two characters `\n`.
// Escaping *before* splitting therefore left nothing to split on: `/help` arrived as a single line with
// `\n` written into it. These four tests hold the four claims that were broken or could break again —
// the lines are real lines, the frame never shows a literal `\n`, a narrow window still behaves the way
// this renderer behaves, and the arms that were not touched did not change.

test('/help 的每一行都真的是屏幕上的一行，帧里没有字面量 \\n', () => {
  // `HELP_LINES` is the copy the window hands over, so what is rendered here is the help an operator
  // actually reads rather than a copy of it written out again beside the real one.
  const text = HELP_LINES.join('\n');
  const lines = transcriptLines([notice(text)]);

  // The stamp, then one line per command: same count, same order, no line merged into another.
  assert.equal(lines.length, HELP_LINES.length + 1);
  assert.deepEqual(
    lines.slice(1).map((line) => line.map((part) => part.text).join('')),
    [...HELP_LINES],
  );

  const frame = frameLines(renderFrame(chat([notice(text)]), PLAIN)).join('\n');
  assert.equal(frame.includes('\\n'), false, '帧里不得出现字面量 \\n');
  for (const command of HELP_LINES.map((line) => line.split(' ')[0])) {
    assert.ok(frame.includes(command), `${command} 应当出现在帧里`);
  }
});

test('窄终端里 /help 仍按窗口宽度收，帧既不被撑宽也不被撑高', () => {
  const text = HELP_LINES.join('\n');
  const columns = 24;
  const size = { columns, rows: 24, color: true };
  const screen = renderScreen(chat([notice(text)]), size);

  // A line this renderer cannot fit is clipped, not wrapped — a row the terminal wraps pushes the input
  // row off the bottom of the window, which is the failure the width accounting exists to prevent. So
  // the line count comes from the transcript rather than the frame: eleven lines, each clipped on its
  // own. What must not happen at 24 columns is the help collapsing back into one line.
  assert.equal(transcriptLines([notice(text)]).length, HELP_LINES.length + 1);
  assert.equal(screen.length, size.rows);
  for (const line of screen) {
    assert.ok(displayWidth(strip(line)) <= columns, `${displayWidth(strip(line))} 列：${strip(line)}`);
  }

  const joined = screen.map(strip).join('\n');
  assert.ok(joined.includes('·  10:00:03'), '每条 notice 的本地时间戳仍在');
  assert.ok(joined.includes('/help'), '命令词在窄窗口里仍应看得见');
  assert.equal(joined.includes('\\n'), false);
});

test('帮助比窗口长时可以往回翻，翻到的是前面那些行', () => {
  const text = HELP_LINES.join('\n');
  // 12 rows leaves a 5-row body, so the ten commands do not fit and the live bottom shows the last of
  // them. Both halves matter: the first command is genuinely off-screen, and scrolling is what brings it
  // back. Asserting only the second would pass on a frame that showed everything at once.
  const size = { columns: 60, rows: 12, color: false };
  const screen = renderScreen(chat([notice(text)]), size);
  // A transcript longer than the window still fills exactly the window: the body is sliced and padded to
  // `bodyRows`, so eleven lines of help move the input row no more than one line of it did.
  assert.equal(screen.length, size.rows);
  const live = screen.map(strip).join('\n');
  assert.equal(live.includes('/help 显示这份列表'), false, '最新的 5 行里没有第一行');
  assert.ok(live.includes('/quit'));

  const back = renderScreen(chat([notice(text)], { scroll: 20 }), size).map(strip).join('\n');
  assert.ok(back.includes('/help 显示这份列表'), '往回翻应当看见第一行');
});

test('普通 Chat 与主动投递不回归：一行仍是一行，控制字符仍进不来', () => {
  // Only the notice arm changed. A human's sentence is still one line, a reply's lines are still the
  // resident's own escaped lines pushed through untouched, and a proactive delivery is still its own
  // lines — none of them gained a split they did not have.
  const state = chat([human('在吗'), reply('answered', ['第一行', '第二行']), proactive(['先说话', '再说一句'])]);
  const frame = frameLines(renderFrame(state, PLAIN)).join('\n');
  for (const text of ['在吗', '第一行', '第二行', '先说话', '再说一句']) {
    assert.ok(frame.includes(text), `${text} 应当出现在帧里`);
  }

  // And the split did not cost the escape it was moved in front of: a break this renderer does *not*
  // split on, and an escape sequence, both still arrive as text rather than as instructions. The
  // vertical tab is the interesting one — it is a line break to a terminal and not one here, so it stays
  // inside its line and is spelled out.
  const lines = transcriptLines([notice('第一行\x1b[31m红色\x07\v第二行')]);
  assert.equal(lines.length, 2, '一个都没有被当成换行');
  assert.equal(lines[1][0].text, '第一行\\u001b[31m红色\\u0007\\v第二行');
  assert.equal(transcriptLines([notice('第一行\n第二行')]).length, 3, '真正的换行才断行');
});

// ---------------------------------------------------------------------------------------------
// §13: quitting restores the terminal
// ---------------------------------------------------------------------------------------------

test('退出走的是恢复终端的那条路，而不是别的什么', () => {
  // Taking the screen and giving it back are two exact byte sequences, and the giving-back is the one
  // that matters: a process that leaves raw mode on leaves a shell that echoes nothing.
  assert.ok(ENTER_SCREEN.includes('\x1b[?1049h'), '进入备用屏');
  assert.ok(ENTER_SCREEN.includes('\x1b[?25l'), '藏起光标');
  assert.ok(ENTER_SCREEN.includes('\x1b[2J'), '清屏');
  assert.ok(LEAVE_SCREEN.includes('\x1b[?25h'), '放回光标');
  assert.ok(LEAVE_SCREEN.includes('\x1b[?1049l'), '离开备用屏');
  assert.ok(LEAVE_SCREEN.indexOf('\x1b[?25h') < LEAVE_SCREEN.indexOf('\x1b[?1049l'));

  // Ctrl+Q is the binding, and it is not a letter. Chat is the default view and its input row is a text
  // field, so `q`, `s`, `x` and `r` have to be ordinary characters — the v0 console's `[q] 退出` bar
  // cannot survive a screen where `q` is the first letter of a word someone is typing.
  assert.equal(readTuiKey('\x11'), 'quit');
  assert.equal(readTuiKey('q'), undefined);
  assert.equal(readTuiKey('s'), undefined);
  assert.equal(readTuiKey('x'), undefined);
  assert.equal(readTuiKey('r'), undefined);

  assert.equal(readTuiKey('\t'), 'next-view');
  assert.equal(readTuiKey('\x1b[5~'), 'scroll-up');
  assert.equal(readTuiKey('\x1b[6~'), 'scroll-down');

  // Ctrl+C and Ctrl+D are the terminal's, and they quit rather than being swallowed. Neither stops the
  // resident: leaving the TUI is not stopping Hikari.
  assert.equal(isInterrupt('\x03'), true);
  assert.equal(isInterrupt('\x04'), true);
  assert.equal(isInterrupt('c'), false);
  assert.equal(isInterrupt('\t'), false);
});

// ---------------------------------------------------------------------------------------------
// The screen before the TUI proper
// ---------------------------------------------------------------------------------------------

test('没有 --data-dir 时先问，问的就是在跟哪一个 Hikari 说话', () => {
  const screen = renderAskScreen({ text: 'D:\\项目\\hikari', cursor: 0 }, '', PLAIN);
  const text = screen.join('\n');
  assert.match(text, /数据目录/);
  assert.match(text, /没有默认目录/);
  assert.match(text, /Esc 退出/);
  // The path is shown as typed. This is the one place non-ASCII input cannot be dropped at the door,
  // and the editor is the same one the chat line uses.
  assert.match(text, /D:\\项目\\hikari/);

  const withNotice = renderAskScreen(EMPTY_EDIT, '请先给出一个数据目录。', PLAIN).join('\n');
  assert.match(withNotice, /请先给出一个数据目录。/);

  // And it fits the window it is drawn in, like every other frame.
  for (const size of [{ columns: 80, rows: 24 }, { columns: 24, rows: 10 }, { columns: 8, rows: 4 }]) {
    const frame = renderAskScreen(EMPTY_EDIT, '', { ...size, color: true });
    assert.ok(frame.length <= size.rows);
    for (const line of frame) assert.ok(displayWidth(strip(line)) <= size.columns);
  }
});

test('bodyRows 与帧的实际正文行数一致，窄窗口下也不会把输入行挤掉', () => {
  // These two have to agree exactly: the body is the only part of the frame whose length is derived, so
  // a disagreement is a frame one row taller than the window — and the line that falls off the bottom is
  // the input row. This file has had that bug once already.
  for (let rows = 4; rows <= 40; rows += 1) {
    const render = { columns: 60, rows, color: false };
    const screen = renderScreen(chat([human('在吗')]), render);
    assert.ok(screen.length <= rows, `rows=${rows} 帧高 ${screen.length}`);
    if (rows >= 7) assert.equal(screen.length, rows, `rows=${rows}`);
    assert.ok(bodyRows(render) >= 1);
  }
});

// ---------------------------------------------------------------------------------------------
// The launch path, against a resident that is really running
// ---------------------------------------------------------------------------------------------

// The launch path ends at a named pipe, so this half is Windows-only for the same reason
// `resident-control.test.mjs` is. It replaces the equivalent test in the deleted `console.test.mjs`:
// that file was the v0 surface's, and removing it removed the only committed check that a profile put
// through this build's launch path actually brings up a resident.
const NO_PIPES = process.platform === 'win32' ? false : '命名管道只在 Windows 上存在';

async function waitFor(dataDir, predicate, ms) {
  const deadline = Date.now() + ms;
  let last = await requestControl(dataDir, 'status');
  while (!predicate(last) && Date.now() < deadline) {
    await delay(300);
    last = await requestControl(dataDir, 'status');
  }
  return last;
}

test('启动路径真的能把常驻拉起来，而且 TUI 不持有那个进程', { skip: NO_PIPES, timeout: 60000 }, async (t) => {
  // Not `createRoot`, which registers its own removal: this test has to stop a real resident before the
  // directory it is anchored to goes away, and two `after` hooks whose order decides whether that
  // happens is a race this file should not be holding. One hook, in one order.
  const root = mkdtempSync(join(tmpdir(), 'hikari-tui-'));
  t.after(async () => {
    await requestControl(root, 'stop');
    await waitFor(root, (a) => a.kind === 'absent', 15000);
    rmSync(root, { recursive: true, force: true });
  });

  assert.equal(runCli('init', '--data-dir', root).code, 0);
  assert.equal(runCli('chronicle', 'init', '--data-dir', root).code, 0);

  const profile = { desktopAwarenessDelayMs: 1000 };
  writeLaunchProfile(root, profile);

  // What the TUI does when `/start` runs: hand the profile's own argument list to a detached process and
  // stop caring. `undefined` is the whole of what it learns from this call — the launch is not known to
  // have failed, and it is not known to have succeeded either. That second half is the point: the
  // resident's liveness is decided by the resident's own control endpoint below, never by this return.
  assert.equal(spawnDetached(launchArguments(root, profile)), undefined);

  const answered = await waitFor(root, (a) => a.kind === 'answered', 30000);
  assert.equal(answered.kind, 'answered', '端点始终没有应答；常驻没有起来');
  assert.equal(answered.outcome, 'ok');
  // The lines are the resident's own, carried whole. This asserts that they arrived and that they are
  // non-empty; it deliberately does not assert what they say, because a screen that promised a shape for
  // these sentences is exactly what §6 of the freeze refuses to build.
  assert.ok(answered.lines.length > 0);
  assert.match(answered.lines.join('\n'), /Hikari 常驻状态：/);

  // Stop goes through the same client the TUI uses, and it is the resident that decides. The TUI holds
  // no handle to the child it started — that is what `spawnDetached` gave up — so this is also the only
  // way this screen can end it.
  const stopped = await requestControl(root, 'stop');
  assert.equal(stopped.kind, 'answered');

  const gone = await waitFor(root, (a) => a.kind === 'absent', 20000);
  assert.equal(gone.kind, 'absent');
});
