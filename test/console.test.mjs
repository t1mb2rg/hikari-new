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
  spawnDetached,
  watchingAction,
} from '../dist/cli/console.js';
import { requestControl } from '../dist/cli/control.js';
import { launchArguments, writeLaunchProfile } from '../dist/cli/launch-profile.js';

const CLI = join(import.meta.dirname, '..', 'dist', 'cli', 'main.js');

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

  // The console does not summarise. A resident that reported `failed` and a resident that reported all
  // `active` differ on screen only in the lines the resident itself sent.
  const failing = renderConsole(
    { kind: 'watching', dataDir: root },
    { answer: { kind: 'answered', outcome: 'failed', lines: STATUS_LINES }, launching: false, notice: '', polled: true },
  );
  assert.match(failing.join('\n'), /常驻：正在运行，但它报告了失败。/);
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
