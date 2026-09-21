import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { parseCommandLine } from '../dist/cli/options.js';
import { createLifetimeLease, productionComposition, residentCommand } from '../dist/cli/resident.js';
import { NotInitializedError } from '../dist/continuity/index.js';

const CLI = join(import.meta.dirname, '..', 'dist', 'cli', 'main.js');
const RESIDENT_URL = pathToFileURL(join(import.meta.dirname, '..', 'dist', 'cli', 'resident.js')).href;
const RESIDENT_SOURCE = join(import.meta.dirname, '..', 'src', 'cli', 'resident.ts');
const SRC = join(import.meta.dirname, '..', 'src');

const MEMBER_IDS = [
  'continuity',
  'chronicle',
  'foreground.windows',
  'input-activity.windows',
  'desktop-session-world',
  'desktop-session-awareness',
  'desktop-session-awareness-loop',
];

// `resident` is the point where argv becomes a number, so it is the point where the frozen boundary
// of that number has to survive the trip.
const ALL_ACTIVE = MEMBER_IDS.map(() => 'active');

function createRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'hikari-resident-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function runCli(...args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  assert.equal(result.error, undefined);
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

// The command streams, so the tests read what it wrote rather than what it returned. Lines are kept
// apart because "started" and "stopped" are claims about moments, and a test that concatenated them
// could not tell one line written twice from two lines written once.
function recordingIo() {
  const outLines = [];
  const errLines = [];
  const collect = (sink) => (text) => {
    for (const line of text.split('\n')) if (line) sink.push(line);
  };
  return {
    outLines,
    errLines,
    get errText() {
      return errLines.join('\n');
    },
    out: collect(outLines),
    err: collect(errLines),
  };
}

// The composition is the one thing the resident must not decide for itself, so every test that is not
// about the production wiring supplies its own.
function compositionOf(states) {
  return MEMBER_IDS.map((id, index) => ({
    id,
    load: async () => states[index] ?? 'active',
  }));
}

// The counterpart to `compositionOf`: a fake, and the real thing, asserted separately. Exported only
// for this test, which is the only place in the suite that reads the production roster.
test('生产组合恰好是这八个成员，按加载顺序', () => {
  const composition = productionComposition({
    dataDir: join(tmpdir(), 'hikari-resident-roster'),
    desktopAwarenessDelayMs: 1000,
  });

  // Verified before this test existed: deleting `work-focus` from `productionComposition` left the
  // entire suite green on both platforms. The tests that would have noticed end to end are the ones
  // that need a named pipe, and CI runs on a host that has none — so the member that only exists to
  // be an ingress could have disappeared from production with nothing going red.
  assert.deepEqual(
    composition.map((member) => member.id),
    [
      'continuity',
      'chronicle',
      'foreground.windows',
      'input-activity.windows',
      'desktop-session-world',
      'desktop-session-awareness',
      'desktop-session-awareness-loop',
      'work-focus',
    ],
  );
});

function fakeRuntime({ errors = {}, shutdown } = {}) {
  const calls = { shutdown: 0 };
  return {
    calls,
    getPluginError: (id) => errors[id],
    async shutdown() {
      calls.shutdown += 1;
      if (shutdown) await shutdown();
    },
  };
}

// Every test below is about the resident's own logic, so the control channel is stubbed here: the
// endpoint path is still derived and the host is still built, but nothing is listened on. That keeps
// these tests free of OS handles, of ordering between concurrently running test files, and of the
// one-resident-per-data-directory rule — none of which they are trying to say anything about. The
// real listener has its own file, and the production wiring test below runs without this stub.
const noControl = {
  listenControl: async (_host, path) => ({ path, close: async () => {} }),
};

const options = () => ({ dataDir: 'resident-test-root', desktopAwarenessDelayMs: 1000 });

// The command's startup is a chain of microtasks — nothing in a fake composition yields to the event
// loop — so one macrotask boundary is past all of it.
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function until(predicate, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(25);
  }
  assert.fail(message);
}

async function within(promise, timeoutMs, message) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

function collect(stream) {
  const chunks = [];
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => chunks.push(chunk));
  return { get text() { return chunks.join(''); } };
}

// Each probe needs a data directory of its own, and not for tidiness: the data directory *is* the
// control endpoint — the pipe name is derived from it — so two probes sharing one path would derive
// one name, and the second would refuse to start rather than run unaddressable. Distinctness here is
// what keeps these probes measuring the lease and nothing else.
let probeSequence = 0;

function spawnResidentProbe({ lease = true, signalAfterMs = null } = {}) {
  probeSequence += 1;
  const leaseOverride = lease
    ? ''
    : 'createLease: () => ({ isHolding: () => false, release() {} }),';
  // The self-emitted signal is scheduled before the resident exists, and its timer is spent by the
  // time it fires — so it cannot be what keeps an otherwise unheld process alive.
  const schedule = signalAfterMs === null ? '' : `setTimeout(() => process.emit('SIGINT'), ${signalAfterMs});`;
  const script = `
import { residentCommand } from ${JSON.stringify(RESIDENT_URL)};

const ids = ${JSON.stringify(MEMBER_IDS)};

${schedule}

const outcome = await residentCommand(
  { dataDir: ${JSON.stringify(`lease-probe-${probeSequence}`)}, desktopAwarenessDelayMs: 1000 },
  {
    composition: ids.map((id) => ({ id, load: async () => 'active' })),
    runtime: { getPluginError: () => undefined, shutdown: async () => {} },
    io: { out: (text) => process.stdout.write(text), err: (text) => process.stderr.write(text) },
    ${leaseOverride}
  },
);

process.exitCode = outcome.exitCode;
`;

  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = collect(child.stdout);
  const err = collect(child.stderr);
  return {
    child,
    out,
    err,
    exited: new Promise((resolve) => child.on('exit', (code) => resolve(code))),
  };
}

function sourceFiles(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (entry.name.endsWith('.ts')) found.push(full);
  }
  return found;
}

test('resident 加载组合、报告就绪，并一直等到终止请求', async () => {
  const io = recordingIo();
  const lease = createLifetimeLease();
  const runtime = fakeRuntime();

  const pending = residentCommand(options(), {
    composition: compositionOf(ALL_ACTIVE),
    io,
    runtime,
    ...noControl,
    createLease: () => lease,
  });

  await tick();
  assert.deepEqual(io.outLines, ['Hikari 常驻已启动。']);
  assert.equal(lease.isHolding(), true);

  process.emit('SIGINT');
  const outcome = await pending;

  assert.equal(outcome.exitCode, 0);
  assert.deepEqual(io.outLines, ['Hikari 常驻已启动。', 'Hikari 常驻已停止。']);
  assert.equal(io.errText, '');
  assert.equal(runtime.calls.shutdown, 1);
});

test('就绪不是对后台链路健康的断言：一个只能报告状态的组合也足以宣布启动', async () => {
  const io = recordingIo();
  const runtime = fakeRuntime();
  const members = [];

  const pending = residentCommand(options(), {
    composition: compositionOf(ALL_ACTIVE).map((member) => {
      members.push(member.id);
      return member;
    }),
    io,
    runtime,
    ...noControl,
    createLease: () => createLifetimeLease(),
  });

  await tick();
  process.emit('SIGTERM');
  const outcome = await pending;

  // The composition supplied above is walked in order and nothing is appended to it: the resident has
  // no capability of its own to load, and adds no subscriber to observe the loop's output. What this
  // says nothing about is the production composition — `MEMBER_IDS` is the roster of the fake this
  // file hands in, which is deliberately shorter than what a resident actually loads. The production
  // roster is pinned by its own test below.
  assert.deepEqual(members, MEMBER_IDS);
  assert.equal(outcome.exitCode, 0);
  assert.deepEqual(io.outLines, ['Hikari 常驻已启动。', 'Hikari 常驻已停止。']);
});

test('组合未全部 active 时拒绝启动，并逐条报告状态与原因', async () => {
  const io = recordingIo();
  const lease = createLifetimeLease();
  const runtime = fakeRuntime({ errors: { chronicle: new Error('Chronicle store does not exist') } });
  const states = ['active', 'failed', 'active', 'active', 'waiting', 'waiting', 'waiting'];

  const outcome = await residentCommand(options(), {
    composition: compositionOf(states),
    io,
    runtime,
    ...noControl,
    createLease: () => lease,
  });

  assert.equal(outcome.exitCode, 1);
  assert.deepEqual(io.outLines, [], '未就绪的常驻不应宣布已启动');
  assert.match(io.errText, /Hikari 常驻未启动：感知组合未全部就绪。/);
  for (const [index, id] of MEMBER_IDS.entries()) {
    assert.match(io.errText, new RegExp(`${id.replaceAll('.', '\\.')} 状态：${states[index]}`));
  }
  // `failed` and `waiting` are different answers to "why", so both the state and the recorded reason
  // are reported — and the reason is read from the Runtime rather than guessed from the state.
  assert.match(io.errText, /chronicle：Chronicle store does not exist/);
  assert.equal(runtime.calls.shutdown, 1);
  assert.equal(lease.isHolding(), false);
});

test('未初始化时的失败仍然给出下一步该做什么', async () => {
  const io = recordingIo();
  const runtime = fakeRuntime({ errors: { continuity: new NotInitializedError() } });

  const outcome = await residentCommand(options(), {
    composition: compositionOf(['failed', 'waiting', 'waiting', 'waiting', 'waiting', 'waiting', 'waiting']),
    io,
    runtime,
    ...noControl,
    createLease: () => createLifetimeLease(),
  });

  assert.equal(outcome.exitCode, 1);
  assert.match(io.errText, /continuity：/);
  assert.match(io.errText, /请先运行：hikari init --data-dir <path>/);
  assert.doesNotMatch(io.errText, /chronicle init/);
});

test('组合加载期间抛错时报告失败，并且仍然完成清理', async () => {
  const io = recordingIo();
  const lease = createLifetimeLease();
  const runtime = fakeRuntime();

  const outcome = await residentCommand(options(), {
    composition: [
      { id: 'continuity', load: async () => 'active' },
      { id: 'chronicle', load: async () => 'active' },
      {
        id: 'desktop-session-awareness-loop',
        load: async () => {
          throw new Error('desktop-session-awareness-loop requires an integer delayMs');
        },
      },
    ],
    io,
    runtime,
    ...noControl,
    createLease: () => lease,
  });

  assert.equal(outcome.exitCode, 1);
  assert.deepEqual(io.outLines, []);
  assert.match(io.errText, /requires an integer delayMs/);
  assert.equal(runtime.calls.shutdown, 1);
  assert.equal(lease.isHolding(), false);
});

test('终止请求发生在启动期间时，这一次启动不再宣布已就绪', async () => {
  const io = recordingIo();
  const runtime = fakeRuntime();

  const outcome = await residentCommand(options(), {
    composition: compositionOf(ALL_ACTIVE).map((member, index) =>
      index === MEMBER_IDS.length - 1
        ? {
            id: member.id,
            load: async () => {
              process.emit('SIGINT');
              return 'active';
            },
          }
        : member,
    ),
    io,
    runtime,
    ...noControl,
    createLease: () => createLifetimeLease(),
  });

  // Nothing hangs waiting for a signal that already arrived, and nothing claims a Hikari started
  // that was asked to stop before it ever reported in.
  assert.equal(outcome.exitCode, 0);
  assert.deepEqual(io.outLines, []);
  assert.equal(runtime.calls.shutdown, 1);
});

test('第一个终止请求之后，resident 就退出信号通道，shutdown 只发生一次', async () => {
  const baseline = process.listenerCount('SIGINT');
  const io = recordingIo();
  const lease = createLifetimeLease();
  let listenersDuringShutdown = -1;
  let holdingDuringShutdown = null;
  let shutdownsDuringShutdown = -1;

  const runtime = fakeRuntime({
    shutdown: async () => {
      // A second request arriving mid-shutdown is not a second shutdown, and it is not swallowed
      // either: the listeners are already gone, so it belongs to the host from here on.
      process.emit('SIGINT');
      listenersDuringShutdown = process.listenerCount('SIGINT');
      holdingDuringShutdown = lease.isHolding();
      shutdownsDuringShutdown = runtime.calls.shutdown;
      await tick();
    },
  });

  const pending = residentCommand(options(), {
    composition: compositionOf(ALL_ACTIVE),
    io,
    runtime,
    ...noControl,
    createLease: () => lease,
  });

  await tick();
  process.emit('SIGINT');
  const outcome = await pending;

  assert.equal(outcome.exitCode, 0);
  assert.equal(shutdownsDuringShutdown, 1);
  assert.equal(runtime.calls.shutdown, 1);
  assert.equal(listenersDuringShutdown, baseline, '终止处理必须同步摘掉监听器');
  // The lease outlives the shutdown it is paying for: disposal is never cut short by the process
  // leaving before cleanup has finished.
  assert.equal(holdingDuringShutdown, true);
  assert.equal(lease.isHolding(), false);
  assert.equal(process.listenerCount('SIGINT'), baseline);
  assert.equal(process.listenerCount('SIGTERM'), 0);
});

test('shutdown 失败时报告失败，但 lease 仍然被释放', async () => {
  const io = recordingIo();
  const lease = createLifetimeLease();

  const pending = residentCommand(options(), {
    composition: compositionOf(ALL_ACTIVE),
    io,
    runtime: fakeRuntime({
      shutdown: async () => {
        throw new Error('感知链路的清理没有完成');
      },
    }),
    ...noControl,
    createLease: () => lease,
  });

  await tick();
  process.emit('SIGTERM');
  const outcome = await pending;

  assert.equal(outcome.exitCode, 1);
  assert.match(io.errText, /感知链路的清理没有完成/);
  // A failed cleanup is a reason to report, not a reason to hold the process hostage.
  assert.equal(lease.isHolding(), false);
});

test('常驻进程的寿命来自它自己的 lease，而不是任何领域插件', async (t) => {
  // Three children, all with the same composition of members that open nothing and the same runtime
  // that holds nothing. The only thing that differs between them is the lease, which is what makes
  // this an experiment rather than a demonstration.

  const bare = spawnResidentProbe({ lease: false });
  t.after(() => bare.child.kill());

  const bareCode = await within(bare.exited, 15_000, '没有 lease 的探针进程没有自行退出');
  // Node ends a process whose top-level await never settles with exit code 13, "Unfinished Top-Level
  // Await". That is the signature of a process nothing was holding: it did not finish, it simply ran
  // out of reasons to keep going — and it was never asked to stop, so it never reported one.
  assert.notEqual(bareCode, 0);
  assert.match(bare.out.text, /Hikari 常驻已启动。/);
  assert.doesNotMatch(bare.out.text, /Hikari 常驻已停止。/);

  const leased = spawnResidentProbe();
  t.after(() => leased.child.kill());

  await until(
    () => leased.out.text.includes('Hikari 常驻已启动。'),
    15_000,
    '持有 lease 的探针进程没有报告就绪',
  );
  await delay(700);

  assert.equal(leased.child.exitCode, null, '持有 lease 的 resident 不应自行退出');
  assert.doesNotMatch(leased.out.text, /Hikari 常驻已停止。/);
  assert.equal(leased.err.text, '');

  // And a released lease gives the process back: this one is asked to stop, walks through its own
  // shutdown, and ends by itself. A lease that were merely forgotten rather than released would
  // leave this child hanging exactly like the one above.
  const released = spawnResidentProbe({ signalAfterMs: 400 });
  t.after(() => released.child.kill());

  const releasedCode = await within(released.exited, 15_000, '释放 lease 之后进程没有退出');
  assert.equal(releasedCode, 0);
  assert.match(released.out.text, /Hikari 常驻已启动。/);
  assert.match(released.out.text, /Hikari 常驻已停止。/);
  assert.equal(released.err.text, '');
});

test('真实 SIGTERM 让常驻停止并让进程干净退出', { skip: process.platform === 'win32' ? 'Windows 不投递 POSIX 信号' : false }, async (t) => {
  const probe = spawnResidentProbe(true);
  t.after(() => probe.child.kill());

  await until(
    () => probe.out.text.includes('Hikari 常驻已启动。'),
    15_000,
    '常驻没有在限期内报告就绪',
  );
  probe.child.kill('SIGTERM');

  const code = await within(probe.exited, 15_000, '收到 SIGTERM 后进程没有退出');
  assert.equal(code, 0);
  assert.match(probe.out.text, /Hikari 常驻已停止。/);
  assert.equal(probe.err.text, '');
});

test('resident 以真实生产组合在这台机器上就绪，并优雅停机', { skip: process.platform !== 'win32' ? '生产组合需要 win32 感知能力' : false }, async (t) => {
  const root = createRoot(t);
  assert.equal(runCli('init', '--data-dir', root).code, 0);
  assert.equal(runCli('chronicle', 'init', '--data-dir', root).code, 0);

  const io = recordingIo();
  // No composition, no runtime, no lease override: this is the production wiring, and the point of
  // the test is that the seven real plugins reach `active` on this host.
  const pending = residentCommand({ dataDir: root, desktopAwarenessDelayMs: 500 }, { io });

  await until(() => io.outLines.length > 0, 30_000, `生产组合未在限期内就绪：\n${io.errText}`);

  process.emit('SIGINT');
  const outcome = await pending;

  assert.equal(outcome.exitCode, 0);
  assert.deepEqual(io.outLines, ['Hikari 常驻已启动。', 'Hikari 常驻已停止。']);
  assert.equal(io.errText, '');
});

test('hikari resident 从 argv 走到生产组合，并在真实调用下保持存活', { skip: process.platform !== 'win32' ? '生产组合需要 win32 感知能力' : false }, async (t) => {
  const root = createRoot(t);
  assert.equal(runCli('init', '--data-dir', root).code, 0);
  assert.equal(runCli('chronicle', 'init', '--data-dir', root).code, 0);

  const child = spawn(
    process.execPath,
    [CLI, 'resident', '--data-dir', root, '--desktop-awareness-delay-ms', '1000'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  t.after(() => child.kill());
  const out = collect(child.stdout);
  const err = collect(child.stderr);

  await until(() => out.text.includes('Hikari 常驻已启动。'), 30_000, 'hikari resident 没有报告就绪');
  await delay(1500);

  assert.equal(child.exitCode, null, '常驻进程不应自行退出');
  assert.equal(out.text.split('Hikari 常驻已启动。').length - 1, 1, '就绪只应被宣布一次');
  assert.doesNotMatch(out.text, /Hikari 常驻已停止。/);
  assert.equal(err.text, '');
});

test('CLI 原样传递 cadence，从不 clamp、四舍五入或自行判定合法性', () => {
  const parsed = (value) =>
    parseCommandLine(['resident', '--data-dir', 'root', '--desktop-awareness-delay-ms', value])
      .options.desktopAwarenessDelayMs;

  // 2147483647 is the frozen maximum: the largest delay a Node timer executes faithfully. It must
  // arrive at the loop as itself, not rounded and not truncated on the way.
  assert.equal(parsed('2147483647'), 2_147_483_647);
  assert.equal(parsed('1'), 1);
  // Values the loop will reject still travel untouched. A CLI that repaired `0` into `1` would be
  // answering a question that belongs to the component that has to schedule the cadence.
  assert.equal(parsed('0'), 0);
  assert.equal(parsed('-1'), -1);
  assert.equal(parsed('1.5'), 1.5);

  assert.throws(() => parseCommandLine(['resident', '--data-dir', 'root']), /desktop-awareness-delay-ms/);
  assert.throws(
    () => parseCommandLine(['resident', '--data-dir', 'root', '--desktop-awareness-delay-ms', 'soon']),
    /需要一个数字/,
  );
});

test('hikari resident 用用法错误回答缺失或非数字的 cadence', (t) => {
  const root = createRoot(t);

  const missing = runCli('resident', '--data-dir', root);
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /--desktop-awareness-delay-ms/);

  const notANumber = runCli('resident', '--data-dir', root, '--desktop-awareness-delay-ms', 'abc');
  assert.equal(notANumber.code, 2);
  assert.match(notANumber.stderr, /用法：/);
});

test('CLI 不复制领域规则：非法 cadence 由 Loop 拒绝，而不是被当作用法错误', (t) => {
  const root = createRoot(t);
  assert.equal(runCli('init', '--data-dir', root).code, 0);
  assert.equal(runCli('chronicle', 'init', '--data-dir', root).code, 0);

  for (const value of ['0', '-1', '1.5', '2147483648', '9007199254740991']) {
    const result = runCli('resident', '--data-dir', root, '--desktop-awareness-delay-ms', value);

    // Exit 2 would mean the CLI had an opinion about the value. Exit 1 with the loop's own sentence
    // means the value reached the one component entitled to judge it.
    assert.equal(result.code, 1, `cadence ${value} 不应被判为用法错误`);
    assert.match(
      result.stderr,
      /desktop-session-awareness-loop requires an integer delayMs between 1 and 2147483647/,
      `cadence ${value} 应由 Loop 给出拒绝理由`,
    );
  }
});

test('hikari start 的参数面没有被 resident 拓宽', () => {
  const result = runCli('start', '--data-dir', 'ignored', '--desktop-awareness-delay-ms', '1000');

  assert.equal(result.code, 2);
  assert.match(result.stderr, /未知参数：--desktop-awareness-delay-ms/);
});

test('resident 不承担 Runtime 的职责，也不触碰领域事件', () => {
  const source = readFileSync(RESIDENT_SOURCE, 'utf8');

  for (const forbidden of [
    'unloadPlugin',
    'context.events',
    'process.platform',
    'DesktopSessionAwarenessAssessment',
  ]) {
    assert.equal(source.includes(forbidden), false, `src/cli/resident.ts 不应出现 ${forbidden}`);
  }
});

test('resident 没有把 Loop 的 cadence 边界抄进 CLI', () => {
  const source = readFileSync(RESIDENT_SOURCE, 'utf8');

  for (const literal of ['2147483647', '2_147_483_647', 'Number.isInteger']) {
    assert.equal(source.includes(literal), false, `src/cli/resident.ts 不应出现 ${literal}`);
  }
});

test('resident 不是一个新的平台抽象', () => {
  // Word boundaries matter here: `desktopSessionAwarenessLoopPlugin` is an existing identifier and
  // must not read as an introduced `LoopPlugin`.
  const forbidden = /\b(?:ResidentPlugin|HostPlugin|LoopPlugin|HikariCore|ApplicationContext|RuntimeManager|PluginManager|Scheduler|ServiceContainer)\b/;
  const offenders = sourceFiles(SRC).filter((file) => forbidden.test(readFileSync(file, 'utf8')));

  assert.deepEqual(offenders.map((file) => relative(SRC, file).replaceAll('\\', '/')), []);
});
