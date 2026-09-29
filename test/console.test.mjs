import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

import {
  appendTyped,
  readAskingChunk,
  renderConsole,
  renderFrame,
  residentTone,
  spawnDetached,
  watchingAction,
} from '../dist/cli/console.js';
import { requestControl } from '../dist/cli/control.js';
import { launchArguments, writeLaunchProfile } from '../dist/cli/launch-profile.js';

const CLI = join(import.meta.dirname, '..', 'dist', 'cli', 'main.js');

// Every escape these tests strip is an SGR (colour) sequence, which is `\x1b[…m`. The frame's other
// escapes — home, clear-line, erase-below — are not `m` and are deliberately left alone: they are the
// redraw mechanism, not decoration, so a test that stripped them would be hiding the thing it is
// supposed to be checking.
const stripSgr = (text) => text.replace(/\x1b\[[0-9;]*m/g, '');

// Whether a line ends with a style still open. The frame appends `\x1b[K` to every line, so a colour
// left open at the end of a line is the colour that line gets erased in.
function styleLeftOpen(line) {
  let open = false;
  for (const match of line.matchAll(/\x1b\[([0-9;]*)m/g)) open = match[1] !== '0';
  return open;
}

// The escape that opens the resident verdict, read off the *rendered frame* rather than off
// `residentTone`. The difference is the point: the tone mapping is what an operator actually sees, and
// a test that stops at the return value lets the mapping be inverted without noticing. This returns the
// opening escape only, never the words after it, so two frames whose residents say different things can
// still be compared on their tone.
//
// It is also a shape assertion in passing: if the label stops being dimmed, or the verdict stops being
// wrapped in exactly one escape, this stops matching and the tests below fail rather than silently
// comparing two empty strings.
const TONE_SPAN = /^\x1b\[2m常驻\x1b\[0m  (\x1b\[[0-9;]*m)/;

function toneSpanPrefix(frame) {
  for (const line of frame.split('\n')) {
    const match = TONE_SPAN.exec(line);
    if (match) return match[1];
  }
  assert.fail(`帧里找不到上色的常驻那一行：\n${frame.replace(/\x1b/g, '\\e')}`);
}

// The console's launch path ends at a named pipe, so the end-to-end half of this file is Windows-only
// for the same reason `resident-control.test.mjs` is. What is left ungated below is the refusal, which
// is pure argument handling and has no host.
const NO_PIPES = process.platform === 'win32' ? false : '命名管道只在 Windows 上存在';

function runCli(...args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  assert.equal(result.error, undefined);
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

async function waitFor(dataDir, predicate, ms) {
  const deadline = Date.now() + ms;
  let last = await requestControl(dataDir, 'status');
  while (!predicate(last) && Date.now() < deadline) {
    await delay(300);
    last = await requestControl(dataDir, 'status');
  }
  return last;
}

// The console cannot be driven from a test — it wants a terminal, and every path through it beyond
// this one is a keypress. So the test drives the two mechanisms it is built from, using the shipped
// functions and not copies of them: the detached spawn it hands its profile to, and the same control
// client it polls with. What is left uncovered by this is the redraw and the key handling, which is
// stated in the coverage note rather than implied.

test('操作台的启动路径真的能把常驻拉起来，而且它不持有那个进程', { skip: NO_PIPES, timeout: 60000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'hikari-console-'));
  t.after(async () => {
    await requestControl(root, 'stop');
    await waitFor(root, (a) => a.kind === 'absent', 15000);
    rmSync(root, { recursive: true, force: true });
  });

  assert.equal(runCli('init', '--data-dir', root).code, 0);
  assert.equal(runCli('chronicle', 'init', '--data-dir', root).code, 0);

  const profile = { desktopAwarenessDelayMs: 1000 };
  writeLaunchProfile(root, profile);

  // What the console does when the operator presses Start: hand the profile's own argument list to a
  // detached process and stop caring. `undefined` is the whole of what it learns from this call — the
  // launch is not known to have failed, and it is not known to have succeeded either.
  assert.equal(spawnDetached(launchArguments(root, profile)), undefined);

  const answered = await waitFor(root, (a) => a.kind === 'answered', 30000);
  assert.equal(answered.kind, 'answered', '端点始终没有应答；常驻没有起来');
  assert.equal(answered.outcome, 'ok');
  // The lines are the resident's own, carried whole. This file asserts that they arrived and that they
  // are non-empty; it deliberately does not assert what they say, because a console that promised a
  // shape for these sentences is exactly what §3.3 of the freeze refuses to build.
  assert.ok(answered.lines.length > 0);
  assert.match(answered.lines.join('\n'), /Hikari 常驻状态：/);

  // Stop goes through the same client the console uses, and it is the resident that decides.
  const stopped = await requestControl(root, 'stop');
  assert.equal(stopped.kind, 'answered');

  const gone = await waitFor(root, (a) => a.kind === 'absent', 20000);
  assert.equal(gone.kind, 'absent');
});

test('操作台要一个终端：被重定向时拒绝，而不是把控制码写进管道', () => {
  const result = runCli();
  assert.equal(result.code, 1);
  assert.match(result.stderr, /操作台需要一个终端/);
  // Nothing was drawn. A refusal that had already emitted the alternate-screen sequence would have
  // corrupted whatever file the operator redirected into.
  assert.equal(result.stdout, '');
});

test('操作台在没有 --data-dir 时也是同一个回答：它自己会问，不在这里发明一个目录', () => {
  const result = runCli('--data-dir', 'D:\\data');
  assert.equal(result.code, 1);
  assert.match(result.stderr, /操作台需要一个终端/);
});

// ---------------------------------------------------------------------------------------------
// The display discipline (§5.3), which is pure and therefore checkable without a terminal
// ---------------------------------------------------------------------------------------------

const STATUS_LINES = [
  'Hikari 常驻状态：',
  '  continuity 状态：active',
  '  desktop-session-awareness 状态：failed',
  '  work-focus 状态：waiting',
];

test('status 行原样显示：不解析、不排序、不摘要、不加一个字', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'hikari-console-render-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const lines = renderConsole(
    { kind: 'watching', dataDir: root },
    { answer: { kind: 'answered', outcome: 'ok', lines: STATUS_LINES }, launching: false, notice: '', polled: true },
  );

  // Each line appears whole and in the order it arrived. Nothing is dropped for being dull, nothing is
  // reordered to put `failed` first, and no indicator, count or colour code is attached to it.
  const joined = lines.join('\n');
  let cursor = -1;
  for (const line of STATUS_LINES) {
    const at = joined.indexOf(line);
    assert.notEqual(at, -1, `没有原样出现：${line}`);
    assert.ok(at > cursor, `顺序被打乱：${line}`);
    cursor = at;
  }

  // The console does not summarise, and this is the assertion that keeps it that way. A resident that
  // reported `failed` gets the failure sentence and the lines it sent; nothing is counted, ranked, or
  // rewritten. What the console adds is a tone, and that tone comes from the protocol's `outcome`
  // field — never from reading these lines. The test below holds that line; this one holds the words.
  const failing = renderConsole(
    { kind: 'watching', dataDir: root },
    { answer: { kind: 'answered', outcome: 'failed', lines: STATUS_LINES }, launching: false, notice: '', polled: true },
  );
  const failingText = stripSgr(failing.join('\n'));
  assert.match(failingText, /常驻  ● 正在运行，但它报告了失败。/);
  // And every line still arrives whole, even though the frame around them is now coloured.
  for (const line of STATUS_LINES) assert.equal(failingText.includes(line), true, `colour ate a line: ${line}`);
});

test('一个陌生的状态行不会被当成未知而丢掉', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'hikari-console-render-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  // The wire carries sentences, not an enumeration. A console that only knew how to print the states
  // it had been taught would silently drop the one line that mattered the day a plugin was added.
  const novel = ['某个还没有被发明的状态：quiescent'];
  const lines = renderConsole(
    { kind: 'watching', dataDir: root },
    { answer: { kind: 'answered', outcome: 'ok', lines: novel }, launching: false, notice: '', polled: true },
  );
  assert.equal(lines.includes('某个还没有被发明的状态：quiescent'), true);
});

test('问数据目录的那一屏不发明任何目录', () => {
  const lines = renderConsole({ kind: 'asking', typed: '', notice: '' }, { answer: undefined, launching: false, notice: '', polled: false });
  const joined = lines.join('\n');

  assert.match(joined, /输入一个数据目录后按 Enter/);
  // No default, no search path, no remembered last-used. The screen says so and then asks.
  assert.match(joined, /没有默认目录，也没有记住的上一次/);
  // It shows what was typed and nothing else; an empty prompt is an empty prompt.
  assert.equal(joined.includes('数据目录：'), true);
});

test('已发出但还没有应答的那一屏，把「看不到输出」这件事说出来', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'hikari-console-render-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const lines = renderConsole(
    { kind: 'watching', dataDir: root },
    { answer: { kind: 'absent' }, launching: true, notice: '', polled: true },
  );
  const joined = lines.join('\n');

  assert.match(joined, /正在等它应答/);
  // The measured fact from §5.2.1: a resident that fails at bring-up never arms the endpoint, so the
  // only honest thing to say is that the reason is not visible here -- and where it is.
  assert.match(joined, /看不到它的输出/);
  assert.match(joined, /在终端里直接运行下面那条等价命令/);
  // It does not claim the resident died: it cannot know that, having kept no handle on it.
  assert.equal(joined.includes('已经退出'), false);
});

test('数据目录不存在时说的是 init，而不是一句没有下文的「没有运行」', () => {
  const missing = join(tmpdir(), 'hikari-console-definitely-absent-0000');
  const lines = renderConsole(
    { kind: 'watching', dataDir: missing },
    { answer: { kind: 'absent' }, launching: false, notice: '', polled: true },
  );
  assert.match(lines.join('\n'), /hikari init --data-dir/);
});

test('屏幕上写着常驻是哪一条命令启动的：操作台启动的每次都能被照着敲', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'hikari-console-render-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeLaunchProfile(root, { desktopAwarenessDelayMs: 1000 });

  const withProfile = renderConsole(
    { kind: 'watching', dataDir: root },
    { answer: { kind: 'absent' }, launching: false, notice: '', polled: true },
  ).join('\n');
  assert.match(withProfile, /等价命令|hikari resident --data-dir/);
  assert.equal(withProfile.includes(`--data-dir ${root}`), true);

  // And with no profile it says which command writes one, rather than failing at the keypress.
  rmSync(join(root, 'launch.json'), { force: true });
  const withoutProfile = renderConsole(
    { kind: 'watching', dataDir: root },
    { answer: { kind: 'absent' }, launching: false, notice: '', polled: true },
  ).join('\n');
  assert.match(withoutProfile, /hikari profile set/);
});

test('操作台里没有 transcript，也没有 ask', () => {
  const lines = renderConsole(
    { kind: 'watching', dataDir: tmpdir() },
    { answer: { kind: 'absent' }, launching: false, notice: '', polled: true },
  ).join('\n');

  // The keys are the whole vocabulary of the screen. No prompt, no text box, nothing that accepts a
  // sentence -- that is the Surface's and `hikari ask`'s, and §5.4 says so.
  assert.match(lines, /\[s\] 启动/);
  assert.match(lines, /\[q\] 退出/);
  assert.equal(/你[：:]/.test(lines), false);
});

// ---------------------------------------------------------------------------------------------
// The frame: what actually reaches the terminal, which is where a redraw can be wrong on its own
// ---------------------------------------------------------------------------------------------

test('每一帧都擦掉上一帧留在它下面的行：帧长是变的，光清到行尾不够', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'hikari-console-frame-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const running = renderFrame(
    { kind: 'watching', dataDir: root },
    { answer: { kind: 'answered', outcome: 'ok', lines: STATUS_LINES }, launching: false, notice: '', polled: true },
  );
  const stopped = renderFrame(
    { kind: 'watching', dataDir: root },
    { answer: { kind: 'absent' }, launching: false, notice: '', polled: true },
  );

  // The regression, stated as the thing that went wrong: stopping a resident makes the frame shorter
  // by the whole status block. Clearing each line to its own end does nothing about the lines that are
  // now below the frame, so the stopped resident's plugin lines would stay on screen under
  // "没有运行。" — and stay, because the poll loop redraws the same short frame every two seconds.
  assert.ok(stopped.length < running.length, '这一帧没有变短，回归测试就测不到东西');
  assert.equal(stopped.endsWith('\x1b[J'), true, '帧没有擦到屏尾：上一帧的行会留在下面');
  assert.equal(running.endsWith('\x1b[J'), true);

  // And it still starts by homing, so the frame lands on the same screen every time.
  assert.equal(running.startsWith('\x1b[H'), true);
  assert.equal(stopped.startsWith('\x1b[H'), true);
});

test('帧的内容就是 renderConsole 的那些行，一字不改', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'hikari-console-frame-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const screen = { kind: 'watching', dataDir: root };
  const view = { answer: { kind: 'answered', outcome: 'ok', lines: STATUS_LINES }, launching: false, notice: '', polled: true };
  const frame = renderFrame(screen, view);

  // Each line is on screen whole. The escape sequences are around the lines, never inside them.
  for (const line of STATUS_LINES) assert.equal(frame.includes(line), true, `没有原样出现：${line}`);
  // And the frame is exactly the lines, escaped — not a second rendering that could drift from the one
  // the tests above pin down.
  const expected = '\x1b[H' + renderConsole(screen, view).map((line) => `${line}\x1b[K`).join('\n') + '\x1b[J';
  assert.equal(frame, expected);
});

// ---------------------------------------------------------------------------------------------
// The key vocabulary, for the same reason: it is a table of decisions, not terminal work
// ---------------------------------------------------------------------------------------------

const ABSENT = { answer: { kind: 'absent' }, launching: false, notice: '', polled: true };
const RUNNING = { answer: { kind: 'answered', outcome: 'ok', lines: [] }, launching: false, notice: '', polled: true };
const UNREACHABLE = { answer: { kind: 'unavailable', detail: '管道不见了' }, launching: false, notice: '', polled: true };

// ---------------------------------------------------------------------------------------------
// Presentation: the tone is the protocol's, and colour is only ever *around* the text
// ---------------------------------------------------------------------------------------------

test('颜色只看协议的 outcome，一个字都不看 status 行里写了什么', () => {
  // This is the line §5.3 draws, stated as something that can fail. The resident's status lines are
  // sentences written for a person and carry no promise of structure, so a tone derived from their
  // contents -- red because some line happens to contain "failed" -- would be this file parsing text
  // it was told to carry whole. It would also be wrong rather than merely impure: it would go bad
  // silently the first time the resident reworded one of those sentences.
  const tone = (lines, outcome) =>
    residentTone({ answer: { kind: 'answered', outcome, lines }, launching: false, notice: '', polled: true });

  const alarming = ['某个插件 状态：failed', '状态：failed', '灾难，一切都完蛋了'];
  const bland = ['某个插件 状态：active', '一切正常', '状态：ok'];

  // Every alarming line under an `ok` outcome still reads as ok, and every reassuring line under a
  // `failed` outcome still reads as failed. The lines had no vote in either direction.
  assert.equal(tone(alarming, 'ok'), 'ok');
  assert.equal(tone(bland, 'failed'), 'failed');

  // Stated the other way round, which is the form a regression would have to break: same outcome,
  // lines differing in every character, identical tone.
  assert.equal(tone(alarming, 'ok'), tone(bland, 'ok'));
  assert.equal(tone(alarming, 'failed'), tone(bland, 'failed'));

  // And no lines at all is an ordinary answer, not a case to fall over on.
  assert.equal(tone([], 'ok'), 'ok');
});

test('五种状态各有各的语气，「还没问过」不是「正在运行」', () => {
  // The same states `watchingAction` refuses to conflate, plus the one that has no answer at all.
  assert.equal(residentTone({ answer: undefined, launching: false, notice: '', polled: false }), 'pending');
  assert.equal(residentTone({ ...ABSENT, launching: true }), 'pending');
  assert.equal(residentTone(ABSENT), 'idle');
  assert.equal(residentTone(RUNNING), 'ok');
  assert.equal(residentTone(UNREACHABLE), 'broken');
  assert.equal(residentTone({ ...RUNNING, answer: { kind: 'answered', outcome: 'failed', lines: [] } }), 'failed');
});

test('哪一种结局配哪一种颜色，钉在屏幕上而不是只钉在返回的 tone 上', () => {
  // This test is here because of a gap found by breaking the code on purpose. The mapping from tone to
  // colour used to be held only by `residentTone`'s return value, and nothing pinned what the screen did
  // with it: swapping green and red for `ok`/`failed` — every healthy resident drawn in the failure
  // colour — passed the entire suite, and so did dropping the colour from that line altogether. The
  // claim §5.8 makes is about the screen, so the assertions read the screen.
  const screen = { kind: 'watching', dataDir: tmpdir() };
  const toneOf = (view) => toneSpanPrefix(renderFrame(screen, view, { columns: 80, color: true }));

  assert.equal(toneOf(RUNNING), '\x1b[32m', 'ok 不是绿的');
  assert.equal(toneOf({ ...RUNNING, answer: { kind: 'answered', outcome: 'failed', lines: [] } }), '\x1b[31m', 'failed 不是红的');
  assert.equal(toneOf(ABSENT), '\x1b[2m', '没有运行不是暗的');
  assert.equal(toneOf(UNREACHABLE), '\x1b[33m', '看不见控制通道不是黄的');
  assert.equal(toneOf({ ...ABSENT, launching: true }), '\x1b[2m', '等应答不是暗的');
  assert.equal(toneOf({ answer: undefined, launching: false, notice: '', polled: false }), '\x1b[2m', '还没问过不是暗的');

  // And §5.3 is held at the screen as well as at the return value: same outcome, status lines differing
  // in every character, identical escape opening the verdict. A colour read off the text would have to
  // differ here, and this is the assertion that would catch it if it were.
  const alarming = { answer: { kind: 'answered', outcome: 'ok', lines: ['状态：failed', '灾难，一切都完蛋了'] }, launching: false, notice: '', polled: true };
  const bland = { answer: { kind: 'answered', outcome: 'ok', lines: ['状态：active', '一切正常'] }, launching: false, notice: '', polled: true };
  assert.notEqual(alarming.answer.lines.join(), bland.answer.lines.join(), '两个 view 的行内容不该相同');
  assert.equal(toneOf(alarming), toneOf(bland));
});

test('看不见的常驻不画实心点：那是在断言它自己也不知道的事', () => {
  // The mark carries the same claim as the colour, so it is held to the same rule. Filled means
  // something is running and hollow means nothing is; `unavailable` is the control channel not
  // answering, which is not evidence either way — `absent` has already taken the cases that prove
  // nothing is there (ENOENT, ECONNREFUSED). A filled mark there would be the screen asserting what it
  // cannot see, and it would do so on every frame on a platform without named pipes, where
  // `unavailable` is permanent rather than exceptional.
  const screen = { kind: 'watching', dataDir: tmpdir() };
  const mark = (view) => {
    const line = renderConsole(screen, view, { columns: 80, color: false }).find((l) => l.startsWith('常驻'));
    assert.notEqual(line, undefined, '屏幕上没有常驻那一行');
    return line.slice('常驻  '.length, '常驻  '.length + 1);
  };

  assert.equal(mark(RUNNING), '●');
  assert.equal(mark({ ...RUNNING, answer: { kind: 'answered', outcome: 'failed', lines: [] } }), '●');
  assert.equal(mark(UNREACHABLE), '?');
  assert.equal(mark(ABSENT), '○');
  assert.equal(mark({ ...ABSENT, launching: true }), '◌');
  assert.equal(mark({ answer: undefined, launching: false, notice: '', polled: false }), '◌');
});

test('一个空的状态块不画成两条紧挨着的分隔线', () => {
  // `lines: []` is a shape the control protocol allows, and the console is not entitled to call it bad
  // data. But framing nothing puts two rules against each other with no gap, which reads as one rule
  // rendered twice rather than as an empty block. Nothing is hidden by leaving it out: the outcome is
  // still on screen, in the resident line above.
  const screen = { kind: 'watching', dataDir: tmpdir() };
  const empty = renderConsole(screen, RUNNING, { columns: 80, color: false });
  const adjacentRules = empty.some((line, i) => /^─+$/.test(line) && /^─+$/.test(empty[i + 1] ?? ''));
  assert.equal(adjacentRules, false, `空状态块画出了紧挨的两条分隔线：\n${empty.join('\n')}`);

  // And the outcome it was told about is still on screen, so skipping the block hides nothing.
  assert.equal(empty.some((line) => line.startsWith('常驻  ● 正在运行。')), true);
});

test('颜色只是套在文字外面的转义：关掉颜色，屏上的字一个不差', () => {
  const screen = { kind: 'watching', dataDir: tmpdir() };
  const view = { answer: { kind: 'answered', outcome: 'ok', lines: STATUS_LINES }, launching: false, notice: '', polled: true };

  const colored = renderFrame(screen, view, { columns: 80, color: true });
  const plain = renderFrame(screen, view, { columns: 80, color: false });

  // Two claims, and both matter. A colour that changed the characters would be decoration making a
  // claim of its own. And the plain frame is the whole screen an operator under NO_COLOR gets, not a
  // stripped one, so it has to stand on its own rather than being a degraded leftover.
  assert.equal(stripSgr(colored), plain);
  assert.equal(/\x1b\[[0-9;]*m/.test(plain), false, '关掉颜色之后仍然有颜色转义');

  // The redraw mechanism is not decoration and must survive NO_COLOR: a screen that stopped erasing
  // its tail would leave the previous frame's lines under this one.
  assert.equal(plain.endsWith('\x1b[J'), true, '关掉颜色把擦屏也一起关掉了');

  // And the resident's lines sit inside the coloured frame byte for byte, with no escape in them.
  for (const line of STATUS_LINES) assert.equal(colored.includes(line), true, `没有原样出现：${line}`);
});

test('从彩色帧里切出来的状态块，逐字节等于常驻发来的那些行', () => {
  // Stronger than "the frame contains each line", and the difference is the point: `includes` would
  // still pass if a decoration had been inserted *between* two of the resident's lines, or if the two
  // had swapped places. Comparing the slice whole does not.
  const view = { answer: { kind: 'answered', outcome: 'ok', lines: STATUS_LINES }, launching: false, notice: '', polled: true };
  const frame = renderFrame({ kind: 'watching', dataDir: tmpdir() }, view, { columns: 80, color: true });

  // Every line carries the frame's `\x1b[K`. That is the redraw mechanism rather than decoration, so
  // it comes off first — but explicitly, so it cannot also hide a difference.
  const lines = frame.split('\n').map((l) => (l.endsWith('\x1b[K') ? l.slice(0, -'\x1b[K'.length) : l));

  const at = lines.indexOf(STATUS_LINES[0]);
  assert.notEqual(at, -1, '状态块没有原样出现');
  const block = lines.slice(at, at + STATUS_LINES.length);
  assert.deepEqual(block, STATUS_LINES);

  // Nothing of this file's leaked inside: no colour, no escape of any kind.
  for (const line of block) assert.equal(/\x1b/.test(line), false, `块里混进了转义：${JSON.stringify(line)}`);

  // And the decoration is where §5.8 says it is: immediately above and below the block, as a rule.
  const isRule = (line) => /^\x1b\[2m─+\x1b\[0m$/.test(line);
  assert.equal(isRule(lines[at - 1]), true, `状态块上面不是分隔线：${JSON.stringify(lines[at - 1])}`);
  assert.equal(isRule(lines[at + STATUS_LINES.length]), true, `状态块下面不是分隔线：${JSON.stringify(lines[at + STATUS_LINES.length])}`);
});

test('每一行都在擦除之前收好了颜色，否则擦行会拿那行的颜色当底色', () => {
  const view = { answer: { kind: 'answered', outcome: 'failed', lines: STATUS_LINES }, launching: false, notice: '一条提示', polled: true };
  const frame = renderFrame({ kind: 'watching', dataDir: tmpdir() }, view, { columns: 60, color: true });

  let styled = 0;
  for (const line of frame.split('\n')) {
    const beforeErase = line.endsWith('\x1b[K') ? line.slice(0, -'\x1b[K'.length) : line;
    assert.equal(styleLeftOpen(beforeErase), false, `这一行在擦除时颜色还开着：${beforeErase}`);
    if (/\x1b\[[0-9;]*m/.test(beforeErase)) styled += 1;
  }
  // Without this the assertion above is vacuous in exactly the way a colour regression would be: every
  // span silently dropped, and every line still "closed".
  assert.ok(styled >= 4, `这一帧几乎没有上色（只有 ${styled} 行），上面那条断言等于没测`);
});

test('带换行的数据目录不会把一帧里的一行劈成两行', () => {
  // `oneLine`'s documented contract, which this file now leans on: one element of a renderer's result
  // is one line. The frame appends `\x1b[K` per *element*, so an element carrying a line break becomes
  // two physical rows of which only the second one is erased -- the first keeps whatever the previous
  // frame left to the right of it. That is the same residue §5.6 第四条 fixed, reached through the
  // other door, and `--data-dir` is checked for emptiness and nothing else, so a path can carry one.
  const view = { answer: { kind: 'absent' }, launching: false, notice: '出了点问题：\n第二行', polled: true };
  const frame = renderFrame({ kind: 'watching', dataDir: 'D:/a\nb' }, view, { columns: 80, color: true });

  // The frame ends with `\x1b[J` after the last element rather than a newline, so that comes off first.
  const body = frame.endsWith('\x1b[J') ? frame.slice(0, -'\x1b[J'.length) : frame;
  for (const line of body.split('\n')) {
    assert.equal(line.endsWith('\x1b[K'), true, `这一行不是帧元素、也就不会被擦除：${JSON.stringify(line)}`);
  }

  // And the break is *spelled out* rather than dropped, so the operator still reads the path they gave.
  // Refusing to print it would be this file deciding the operator may not see their own argument.
  assert.equal(frame.includes('D:/a\\nb'), true, '数据目录里的换行没有被写成可见的两个字符');
  assert.equal(frame.includes('出了点问题：\\n第二行'), true, '提示里的换行没有被写成可见的两个字符');
});

test('分隔线跟着终端宽度走，窄窗口拿到的是更短的分隔线而不是更长的', () => {
  const screen = { kind: 'watching', dataDir: tmpdir() };
  const view = { answer: { kind: 'absent' }, launching: false, notice: '', polled: true };
  const at = (columns) => renderFrame(screen, view, { columns, color: false });
  // Every rule in the frame, by length, with duplicates collapsed -- all of them should agree.
  const ruleWidths = (text) => [...new Set((text.match(/─+/g) ?? []).map((r) => r.length))];

  assert.deepEqual(ruleWidths(at(100)), [100]);

  // The width is followed *down*, and that is the whole assertion. There is exactly one hard failure
  // available to this line and it is wrapping: a rule wider than the window is pushed onto a second row
  // and shifts everything below it down. A floor of "20 columns looks more sensible than 4" would have
  // been that failure in miniature, on precisely the terminals least able to absorb it.
  assert.deepEqual(ruleWidths(at(4)), [4]);
  assert.deepEqual(ruleWidths(at(1)), [1]);

  // The floor that does remain is one, for a terminal that reports a width it cannot be drawn in.
  // Not zero: a zero-length rule with a `\x1b[K` after it still erases a stale rule off the screen.
  assert.deepEqual(ruleWidths(at(0)), [1]);
});

test('数据目录可以是中文路径：挡的是控制字符，不是非 ASCII', () => {
  // The rule here used to be printable ASCII, and on the platform this is built for that made
  // `D:\项目\hikari` untypable — every character dropped on arrival, the prompt staying empty, and
  // nothing on screen for the operator to act on.
  assert.equal(appendTyped('', 'D:\\'), 'D:\\');
  assert.equal(appendTyped('D:\\', '项目'), 'D:\\项目');
  assert.equal(appendTyped('D:\\项目\\', 'hikari'), 'D:\\项目\\hikari');
  assert.equal(appendTyped('', 'café'), 'café');
});

test('带控制字符的一整段被丢掉，而不是变成一条看不见的路径', () => {
  assert.equal(appendTyped('D:\\data', '\x07'), undefined);
  assert.equal(appendTyped('D:\\data', 'a\x00b'), undefined);
  // The whole chunk goes, not just the offending byte: a paste carrying a control character is a
  // paste whose contents this screen cannot vouch for.
  assert.equal(appendTyped('D:\\data', 'C:\\ok\x1f'), undefined);
});

test('粘贴一条路径：从资源管理器复制来的那个回车结尾不会被当成内容而整段丢掉', () => {
  // The shape an operator actually produces. The old rule read the whole chunk as text, so this
  // contained a control character and was dropped entire -- a silent no-op that looks like a dead
  // keyboard, which is the same complaint the ASCII-only filter had.
  assert.deepEqual(readAskingChunk('D:\\data\r'), { text: 'D:\\data', submit: true });
  assert.deepEqual(readAskingChunk('D:\\data\n'), { text: 'D:\\data', submit: true });
  assert.deepEqual(readAskingChunk('D:\\项目\\hikari\r'), { text: 'D:\\项目\\hikari', submit: true });

  // A plain Enter key is still a submit with no text, and plain typing is still not a submit.
  assert.deepEqual(readAskingChunk('\r'), { text: '', submit: true });
  assert.deepEqual(readAskingChunk('\n'), { text: '', submit: true });
  assert.deepEqual(readAskingChunk('D:\\data'), { text: 'D:\\data', submit: false });

  // Only up to the first terminator: a chunk carrying more than one line submits the first, rather
  // than entering a path with an invisible newline inside it.
  assert.deepEqual(readAskingChunk('a\nb'), { text: 'a', submit: true });
});

test('退格删掉一个字符；空串上退格还是空串', () => {
  assert.equal(appendTyped('abc', '\x7f'), 'ab');
  assert.equal(appendTyped('abc', '\b'), 'ab');
  assert.equal(appendTyped('', '\x7f'), '');
  assert.equal(appendTyped('', '\b'), '');
});

test('[s] 在五种状态下只有一种真的会启动', () => {
  // Not asked yet. The screen must not answer a question it has not put to anyone.
  assert.equal(watchingAction('s', { answer: undefined, launching: false, notice: '', polled: false }).kind, 'notice');
  // Already running, and reachable-but-broken. `absent` is the only state `[s]` starts from.
  assert.equal(watchingAction('s', RUNNING).kind, 'notice');
  assert.equal(watchingAction('s', UNREACHABLE).kind, 'notice');
  // Mid-launch. Without this the last answer is still `absent`, so a key held down starts a second
  // process rather than being refused.
  assert.equal(watchingAction('s', { ...ABSENT, launching: true }).kind, 'notice');
  assert.equal(watchingAction('s', ABSENT).kind, 'launch');
});

test('[r] 在等待启动时仍然可用，否则一次失败的启动会把 [s] 永久锁死', () => {
  const waiting = { ...ABSENT, launching: true };
  assert.equal(watchingAction('s', waiting).kind, 'notice');
  // The caller clears `launching` on `refresh`. A launch that failed at bring-up never arms the
  // endpoint, so nothing else would ever clear it and `[s]` would be dead for the rest of the session.
  assert.equal(watchingAction('r', waiting).kind, 'refresh');
  assert.equal(watchingAction('r', RUNNING).kind, 'refresh');
});

test('没有绑定的键什么也不做，也不会顺手退出', () => {
  for (const key of ['a', 'z', '1', ' ', '[', 'Q', 'S']) {
    assert.equal(watchingAction(key, ABSENT).kind, 'ignore', key);
  }
  assert.equal(watchingAction('q', ABSENT).kind, 'quit');
  assert.equal(watchingAction('x', ABSENT).kind, 'stop');
});

test('操作台不是第二个 human surface：它不接受一句话作为输入', () => {
  // `hikari "你好"` is not a command and must not become one. The console takes a directory and
  // nothing else; talking to Hikari is `hikari ask` or the Surface.
  const result = runCli('随便说点什么');
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /未知命令/);
});
