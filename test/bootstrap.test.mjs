import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import {
  bootstrap,
  defaultResidentDataDir,
  launchAndAwait,
  productionBootstrap,
} from '../dist/cli/bootstrap.js';
import { requestControl } from '../dist/cli/control.js';
import { launchArguments, launchProfilePath, readLaunchProfile } from '../dist/cli/launch-profile.js';
import { parseCommandLine } from '../dist/cli/options.js';
import { spawnDetached } from '../dist/cli/tui.js';

const CLI = join(import.meta.dirname, '..', 'dist', 'cli', 'main.js');

// The production composition needs the win32 perception capabilities, so a resident cannot come up on
// another host at all. Note what is *not* gated: everything that decides and reports — the default
// directory, the profile branches, the spawn-failure branch, the bound — runs everywhere.
const NO_WIN32_RESIDENT = {
  skip: process.platform !== 'win32' ? '生产组合需要 win32 感知能力' : false,
};

/**
 * A temporary data directory, and the two things that have to happen to it afterwards, in one hook.
 *
 * Node runs `after` hooks in the order they were registered, so a directory removed by one hook and a
 * resident stopped by another would be removed first — leaving a resident running that nothing in this
 * file can address. The stop is first and costs nothing when nothing is running: `stop` against a data
 * directory with no resident answers `absent` immediately.
 */
function tempRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'hikari-bootstrap-'));
  t.after(async () => {
    await requestControl(root, 'stop');
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}

/** A data directory a resident can actually come up in, with a launch profile already written. */
function configuredRoot(t) {
  return configure(tempRoot(t));
}

function configure(root) {
  assert.equal(runCli('init', '--data-dir', root).code, 0);
  assert.equal(runCli('chronicle', 'init', '--data-dir', root).code, 0);
  assert.equal(
    runCli('profile', 'set', '--data-dir', root, '--desktop-awareness-delay-ms', '500').code,
    0,
  );
  return root;
}

/**
 * One environment variable, for the duration of one test, put back exactly as it was found.
 *
 * `process.env.X = undefined` writes the string `"undefined"` rather than removing the variable, so
 * "was not set" and "was set to something" have to stay two different restores.
 */
function withEnv(t, name, value) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;

  t.after(() => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  });
}

/**
 * This host's default layout, made somewhere disposable: an application directory with `Hikari\resident`
 * under it, pointed at by `LOCALAPPDATA`, and configured so a resident could come up there.
 *
 * It exists because a test of the bare word `hikari` is only a test when the default directory resolves
 * somewhere the test can see. Left unset, the bare word means the operator's real
 * `%LOCALAPPDATA%\Hikari\resident` — a directory a test has no business starting a resident in, and one
 * whose emptiness would prove nothing about the code under test.
 *
 * Returns the resident directory. The application directory above it is never named by the test.
 */
function defaultLayoutRoot(t) {
  const appData = mkdtempSync(join(tmpdir(), 'hikari-bootstrap-appdata-'));
  const root = join(appData, 'Hikari', 'resident');
  mkdirSync(root, { recursive: true });
  // One hook for the directory, stop before remove, for the reason `tempRoot` gives; the environment
  // goes back in its own.
  t.after(async () => {
    await requestControl(root, 'stop');
    rmSync(appData, { recursive: true, force: true });
  });
  withEnv(t, 'LOCALAPPDATA', appData);

  return configure(root);
}

function runCli(...args) {
  // `spawnSync` gives the child pipes, so `process.stdout.isTTY` is false inside it. That is the
  // condition the launch path refuses on — which is why the refusal is the only thing about the real
  // command this machine can drive, and why every test that needs the *launch* calls `bootstrap` in
  // this process with the terminal stubbed instead.
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  assert.equal(result.error, undefined);
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Pretend this process has a terminal.
 *
 * `bootstrap` refuses without one before it resolves or starts anything, and the test runner's own
 * stdin is a pipe — so without this every call below would return that refusal and nothing after it
 * would be under test. What is stubbed is the *environment*, never the code: the checks, the
 * resolution, the profile read, the real spawn and the real wait all run exactly as they do for a
 * human. The window takeover is the one member those tests replace, because a real TUI raw-modes a
 * real terminal and this machine has none to give it.
 */
function withTerminal(t) {
  const stdin = process.stdin.isTTY;
  const stdout = process.stdout.isTTY;
  process.stdin.isTTY = true;
  process.stdout.isTTY = true;
  t.after(() => {
    process.stdin.isTTY = stdin;
    process.stdout.isTTY = stdout;
  });
}

/** Records what the launch path handed the window, and answers the way a TUI that opened would. */
function windowStub() {
  const entered = [];
  return {
    entered,
    enterTui: async (options) => {
      entered.push(options);
      return { exitCode: 0, stdout: '', stderr: '' };
    },
  };
}

/** Production dependencies with exactly the named members replaced, so what stays real is obvious. */
function withOverrides(overrides) {
  return { ...productionBootstrap, ...overrides };
}

async function until(predicate, message, deadlineMs = 30_000) {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() >= deadline) assert.fail(message);
    await delay(50);
  }
}

async function controlKind(root) {
  const answer = await requestControl(root, 'status');
  return answer.kind;
}

/** Start a resident the way the product does — the launch profile, and the detached spawn. */
async function startResident(root) {
  const read = readLaunchProfile(root);
  assert.equal(read.kind, 'profile');
  assert.equal(spawnDetached(launchArguments(root, read.profile)), undefined);
  await until(async () => (await controlKind(root)) === 'answered', '常驻没有应答控制通道');
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------------------------
// §1: which data directory the bare word means
// ---------------------------------------------------------------------------------------------

test('默认数据目录是 Windows 上当前用户的 Hikari\\resident，其他平台没有这个答案', () => {
  const base = 'C:\\Users\\someone\\AppData\\Local';
  assert.equal(defaultResidentDataDir('win32', { LOCALAPPDATA: base }), join(base, 'Hikari', 'resident'));

  // Two reasons for no answer, and they are the same answer: a platform this round does not extend,
  // and a Windows host that does not provide the directory. Neither is a failure to report — it is
  // the absence `TuiOptions` allows, which is the question the TUI asks.
  assert.equal(defaultResidentDataDir('win32', {}), undefined);
  assert.equal(defaultResidentDataDir('win32', { LOCALAPPDATA: '   ' }), undefined);
  assert.equal(defaultResidentDataDir('linux', { LOCALAPPDATA: base }), undefined);
  assert.equal(defaultResidentDataDir('darwin', { LOCALAPPDATA: base }), undefined);
});

test('显式 --data-dir 永远优先，默认目录连看一眼都不会', async (t) => {
  withTerminal(t);
  const appData = tempRoot(t);
  const decoy = join(appData, 'Hikari', 'resident');
  mkdirSync(decoy, { recursive: true });
  const explicit = tempRoot(t);

  // `LOCALAPPDATA` points at a directory that exists: if anything preferred the default over what the
  // human said, this is where it would go, and the fake control below is where it would show up.
  withEnv(t, 'LOCALAPPDATA', appData);

  const asked = [];
  const window = windowStub();
  const outcome = await bootstrap(
    { dataDir: explicit },
    withOverrides({
      control: async (dataDir) => {
        asked.push(dataDir);
        return { kind: 'absent' };
      },
      enterTui: window.enterTui,
    }),
  );

  assert.deepEqual(asked, [explicit]);
  // The explicit directory has no launch profile, so the launch path reports that instead of opening
  // a window — which is the second half of the claim: the decoy was never read either.
  assert.equal(outcome.exitCode, 1);
  assert.match(outcome.stderr, new RegExp(`数据目录：${escapeRegExp(explicit)}`));
  assert.doesNotMatch(outcome.stderr, new RegExp(escapeRegExp(appData)));
  assert.deepEqual(window.entered, []);
});

// ---------------------------------------------------------------------------------------------
// §1 / §3: connect to the resident that is there, start the one that is not
// ---------------------------------------------------------------------------------------------

test('常驻已经在应答时直接进窗口，一个进程都不会启动', NO_WIN32_RESIDENT, async (t) => {
  withTerminal(t);
  const root = configuredRoot(t);
  await startResident(root);

  let launches = 0;
  const window = windowStub();
  const outcome = await bootstrap(
    { dataDir: root },
    withOverrides({
      launch: (args) => {
        launches += 1;
        return spawnDetached(args);
      },
      enterTui: window.enterTui,
    }),
  );

  assert.equal(outcome.exitCode, 0);
  assert.deepEqual(window.entered, [{ dataDir: root }]);
  // The whole of the concurrency protection is that this number is zero — and it is zero because the
  // resident answered, not because nothing was configured.
  assert.equal(launches, 0);
});

test('常驻在跑而启动配置已经不在了：不读配置、不启动，直接进窗口', NO_WIN32_RESIDENT, async (t) => {
  withTerminal(t);
  const root = configuredRoot(t);
  await startResident(root);
  // The state a human reaches by clearing the configuration after the resident came up — or by having
  // started it in the foreground from another terminal. A launch profile says how to *start* a
  // resident; it says nothing about how to talk to one that is already there.
  assert.equal(runCli('profile', 'clear', '--data-dir', root).code, 0);
  assert.equal(readLaunchProfile(root).kind, 'none');

  let launches = 0;
  const window = windowStub();
  const outcome = await bootstrap(
    { dataDir: root },
    withOverrides({
      launch: (args) => {
        launches += 1;
        return spawnDetached(args);
      },
      enterTui: window.enterTui,
    }),
  );

  assert.equal(outcome.exitCode, 0, outcome.stderr);
  assert.deepEqual(window.entered, [{ dataDir: root }]);
  assert.equal(launches, 0);
});

test('平台给不出默认目录时，absence 仍然只是一个问题：连控制通道都不问', async (t) => {
  withTerminal(t);
  // This host answers the platform question, so the way to be a host that does not is for the
  // directory the platform provides to be missing — the other half of `defaultResidentDataDir`'s two
  // reasons for having no answer.
  withEnv(t, 'LOCALAPPDATA', undefined);

  let asked = 0;
  const window = windowStub();
  const outcome = await bootstrap(
    { dataDir: undefined },
    withOverrides({
      control: async () => {
        asked += 1;
        return { kind: 'absent' };
      },
      launch: () => {
        throw new Error('没有数据目录就不该启动任何东西');
      },
      enterTui: window.enterTui,
    }),
  );

  assert.equal(outcome.exitCode, 0);
  // Nothing was resolved, nothing was probed, nothing was started: the window is entered with the
  // absence itself, which is the question it has always asked and still asks where there is no answer.
  assert.deepEqual(window.entered, [{ dataDir: undefined }]);
  assert.equal(asked, 0);
});

test('控制通道用不了时也不启动第二个常驻，仍然把窗口交出去', async (t) => {
  withTerminal(t);
  const root = tempRoot(t);
  let launches = 0;
  const window = windowStub();

  const outcome = await bootstrap(
    { dataDir: root },
    withOverrides({
      control: async () => ({ kind: 'unavailable', detail: '端点存在但不作答' }),
      launch: (args) => {
        launches += 1;
        return spawnDetached(args);
      },
      enterTui: window.enterTui,
    }),
  );

  // `unavailable` is not `absent`: something holds this data directory's channel, so starting a second
  // resident would be starting a process that cannot be addressed. What that state looks like is the
  // window's to say, and the window is where the operator goes.
  assert.equal(outcome.exitCode, 0);
  assert.equal(launches, 0);
  assert.deepEqual(window.entered, [{ dataDir: root }]);
});

test('有启动配置但没有常驻：按配置真的启动它，等到它应答，再进窗口', NO_WIN32_RESIDENT, async (t) => {
  withTerminal(t);
  const root = configuredRoot(t);
  assert.equal(await controlKind(root), 'absent');

  let launches = 0;
  const window = windowStub();
  const outcome = await bootstrap(
    { dataDir: root },
    withOverrides({
      launch: (args, onExit) => {
        launches += 1;
        return spawnDetached(args, onExit);
      },
      enterTui: window.enterTui,
    }),
  );

  assert.equal(outcome.exitCode, 0, outcome.stderr);
  assert.equal(launches, 1);
  assert.deepEqual(window.entered, [{ dataDir: root }]);
  // The window opens only after the resident answered its own channel, and this is the assertion that
  // it really is a resident: the same client `hikari status` uses, asking the same endpoint.
  assert.equal(await controlKind(root), 'answered');

  // And the launch path did not become a supervisor while the window was handed over. A second process
  // appearing here would be exactly the "start it again behind the operator's back" this slice forbids.
  await delay(500);
  assert.equal(launches, 1);
});

// ---------------------------------------------------------------------------------------------
// §1 / §3: the states that must not be papered over
// ---------------------------------------------------------------------------------------------

test('没有启动配置：说清楚、给出去哪一条命令，不启动也不进窗口', async (t) => {
  withTerminal(t);
  const root = tempRoot(t);
  let launches = 0;
  const window = windowStub();

  const outcome = await bootstrap(
    { dataDir: root },
    withOverrides({
      control: async () => ({ kind: 'absent' }),
      launch: (args) => {
        launches += 1;
        return spawnDetached(args);
      },
      enterTui: window.enterTui,
    }),
  );

  assert.equal(outcome.exitCode, 1);
  assert.match(outcome.stderr, new RegExp(`数据目录：${escapeRegExp(root)}`));
  assert.match(
    outcome.stderr,
    new RegExp(`这个数据目录还没有启动配置：${escapeRegExp(launchProfilePath(root))}`),
  );
  assert.match(outcome.stderr, /hikari init --data-dir/);
  assert.match(outcome.stderr, /hikari profile set --data-dir/);
  assert.match(outcome.stderr, /不会替你猜模型端点、模型名或凭据/);
  // No guessing and no half-started Hikari: the two things a launch path could do wrong here are both
  // counted rather than trusted.
  assert.equal(launches, 0);
  assert.deepEqual(window.entered, []);
});

test('启动配置读不出来：报告读不出来的原因与文件，不启动也不进窗口', async (t) => {
  withTerminal(t);
  const root = tempRoot(t);
  writeFileSync(launchProfilePath(root), '{\n  "desktopAwarenessDelayMs": "soon"\n}\n', 'utf8');

  let launches = 0;
  const window = windowStub();
  const outcome = await bootstrap(
    { dataDir: root },
    withOverrides({
      control: async () => ({ kind: 'absent' }),
      launch: (args) => {
        launches += 1;
        return spawnDetached(args);
      },
      enterTui: window.enterTui,
    }),
  );

  assert.equal(outcome.exitCode, 1);
  assert.match(outcome.stderr, /启动配置无法读取：\S/);
  assert.match(outcome.stderr, new RegExp(`文件：${escapeRegExp(launchProfilePath(root))}`));
  // The reason is the reader's, not a second opinion written in the launch path, so what is pinned is
  // that there is one and that it is on the same line as the claim.
  assert.equal(launches, 0);
  assert.deepEqual(window.entered, []);
});

test('spawn 本身失败时，失败原样说出来，不假装常驻就绪', async (t) => {
  withTerminal(t);
  const root = tempRoot(t);
  writeFileSync(launchProfilePath(root), JSON.stringify({ desktopAwarenessDelayMs: 500 }), 'utf8');
  const window = windowStub();

  const outcome = await bootstrap(
    { dataDir: root },
    withOverrides({
      control: async () => ({ kind: 'absent' }),
      launch: () => '无法启动常驻：EACCES',
      enterTui: window.enterTui,
    }),
  );

  assert.equal(outcome.exitCode, 1);
  assert.match(outcome.stderr, /无法启动常驻：EACCES/);
  assert.deepEqual(window.entered, []);
});

test('常驻起来了又退出：报退出码与前台看输出的命令，不进窗口', NO_WIN32_RESIDENT, async (t) => {
  withTerminal(t);
  // A valid launch profile in a data directory that was never initialized. Nothing here inspects the
  // data directory — the resident is what refuses, and this test is about the launch path reporting
  // that rather than about why it happened.
  const root = tempRoot(t);
  assert.equal(runCli('profile', 'set', '--data-dir', root, '--desktop-awareness-delay-ms', '500').code, 0);

  const window = windowStub();
  const outcome = await bootstrap({ dataDir: root }, withOverrides({ enterTui: window.enterTui }));

  assert.equal(outcome.exitCode, 1);
  assert.match(outcome.stderr, /常驻进程退出了（退出码 1）/);
  // The foreground command is the profile's own argv rather than a re-typed approximation of it.
  assert.match(outcome.stderr, /hikari resident --data-dir/);
  assert.deepEqual(window.entered, []);
  // Nothing is running, and the launch path left nothing behind that pretends otherwise.
  assert.equal(await controlKind(root), 'absent');
});

test('等待是有界的：一直不应答就不会进窗口，也不会永远等下去', async (t) => {
  const root = tempRoot(t);
  writeFileSync(launchProfilePath(root), JSON.stringify({ desktopAwarenessDelayMs: 500 }), 'utf8');
  const profile = readLaunchProfile(root).profile;

  let asked = 0;
  const started = Date.now();
  const arrival = await launchAndAwait(
    root,
    profile,
    withOverrides({
      control: async () => {
        asked += 1;
        return { kind: 'absent' };
      },
      // A child that is alive and silent for the whole of the bound. The budget is this test's own;
      // what it pins is the shape — keep asking, then give up and say how long the wait was.
      launch: () => undefined,
    }),
    { waitMs: 200, pollMs: 25 },
  );
  const elapsed = Date.now() - started;

  assert.deepEqual(arrival, { kind: 'timed-out', waitedMs: 200 });
  assert.ok(elapsed >= 200, `不应在期限之前放弃：${elapsed}ms`);
  assert.ok(asked > 1, '期限内应当反复问，而不是问一次就放弃');
});

// ---------------------------------------------------------------------------------------------
// §3: lifetime stays independent, in both directions
// ---------------------------------------------------------------------------------------------

test('一个窗口进程来去之间，常驻一直在', NO_WIN32_RESIDENT, async (t) => {
  const root = configuredRoot(t);
  await startResident(root);

  // A real `hikari` process, started the way an operator starts one. It leaves with the terminal
  // refusal because this machine has no terminal to give it — and what the test is about is what it
  // leaves behind, which is nothing.
  const window = runCli('--data-dir', root);
  assert.equal(window.code, 1);
  assert.match(window.stderr, /需要一个终端/);

  assert.equal(await controlKind(root), 'answered');
});

test('没有终端时一个进程都不会启动，配置好的数据目录也一样', NO_WIN32_RESIDENT, async (t) => {
  const root = defaultLayoutRoot(t);

  // Both spellings, and the second one is why the refusal has to come first: bare `hikari` resolves
  // the directory below through `LOCALAPPDATA`, finds a launch profile there, and would start a
  // resident in it — in a pipe, with nobody able to see the screen it was about to draw.
  for (const args of [['--data-dir', root], []]) {
    const outcome = runCli(...args);
    assert.equal(outcome.code, 1, args.join(' '));
    assert.match(outcome.stderr, /需要一个终端/);
  }

  assert.equal(await controlKind(root), 'absent');
});

test('窗口里按过停止之后，没有东西会把它拉起来', NO_WIN32_RESIDENT, async (t) => {
  const root = configuredRoot(t);
  await startResident(root);

  assert.equal(runCli('stop', '--data-dir', root).code, 0);
  // `stop` is a request the resident acknowledges and then acts on — the endpoint answers for another
  // few hundred milliseconds while the process is going away — so the states are watched rather than
  // sampled: it leaves, and then it stays gone.
  await until(
    async () => (await controlKind(root)) === 'absent',
    '被停止的常驻没有离开',
  );

  // The stopping is the resident's own word, and nothing in this build watches for it. Three seconds
  // is not a proof that nothing could ever restart it — it is the window in which a supervisor written
  // into the launch path would have acted, and there is no supervisor to act.
  const started = Date.now();
  while (Date.now() - started < 3000) {
    assert.equal(await controlKind(root), 'absent', '被停止的常驻不应该自己回来');
    await delay(500);
  }
});

// ---------------------------------------------------------------------------------------------
// §4: the commands that were there before are still there
// ---------------------------------------------------------------------------------------------

test('既有命令仍然解析到各自的 arm，默认入口没有变成漏斗', () => {
  assert.deepEqual(parseCommandLine([]), { command: 'tui', options: { dataDir: undefined } });
  assert.deepEqual(parseCommandLine(['--data-dir', 'D:\\x']), {
    command: 'tui',
    options: { dataDir: 'D:\\x' },
  });

  const at = 'D:\\x';
  const commands = [
    [['init', '--data-dir', at], 'init'],
    [['chronicle', 'init', '--data-dir', at], 'chronicle-init'],
    [['start', '--data-dir', at], 'start'],
    [['resident', '--data-dir', at, '--desktop-awareness-delay-ms', '500'], 'resident'],
    [['status', '--data-dir', at], 'status'],
    [['stop', '--data-dir', at], 'stop'],
    [['subscribe', '--data-dir', at], 'subscribe'],
    [['focus', 'status', '--data-dir', at], 'focus'],
    [['relevance', 'repository-ci', 'status', '--data-dir', at], 'relevance'],
    [['observe', 'desktop-session', 'status', '--data-dir', at], 'observe'],
    [['ask', '--data-dir', at, '在吗'], 'ask'],
    [['confirm', '--data-dir', at, '在吗'], 'confirm'],
    [['profile', 'set', '--data-dir', at, '--desktop-awareness-delay-ms', '500'], 'profile-set'],
    [['profile', 'show', '--data-dir', at], 'profile-show'],
    [['profile', 'clear', '--data-dir', at], 'profile-clear'],
  ];
  for (const [argv, command] of commands) {
    assert.equal(parseCommandLine(argv).command, command, argv.join(' '));
    // Every one of them still parses *without* the launch path being consulted: a word that resolved
    // to `tui` would have made the default surface a funnel for commands that have their own arms.
    assert.notEqual(parseCommandLine(argv).command, 'tui', argv.join(' '));
  }

  // `tui` and `console` are still not words, and the default surface is still reached by being default.
  assert.match(runCli('tui').stderr, /未知命令：tui/);
  assert.match(runCli('console').stderr, /未知命令：console/);
});

// ---------------------------------------------------------------------------------------------
// §6.12: the real launch, on this host, through the default directory
// ---------------------------------------------------------------------------------------------

test('真实启动：默认数据目录被发现、常驻被真的拉起来并应答', NO_WIN32_RESIDENT, async (t) => {
  withTerminal(t);
  const root = defaultLayoutRoot(t);

  assert.equal(await controlKind(root), 'absent');

  // Nothing is stubbed except the window itself: the directory comes from the environment through
  // `defaultResidentDataDir`, the profile is the one `hikari profile set` wrote, the spawn is
  // `spawnDetached`, and the wait is the real one against that data directory's real endpoint.
  const window = windowStub();
  const outcome = await bootstrap({ dataDir: undefined }, withOverrides({ enterTui: window.enterTui }));

  assert.equal(outcome.exitCode, 0, outcome.stderr);
  assert.deepEqual(window.entered, [{ dataDir: root }]);

  // Asked of the resident itself rather than inferred from the fact that a window opened: the same
  // client and the same endpoint `hikari status` uses, answering about the directory the default
  // resolved to.
  assert.equal(await controlKind(root), 'answered');
  const status = runCli('status', '--data-dir', root);
  assert.equal(status.code, 0);
  assert.match(status.stdout, /Hikari 常驻状态：/);
  assert.match(status.stdout, /continuity 状态：active/);
});
