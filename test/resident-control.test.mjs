import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import {
  CONTROL_PROTOCOL_VERSION,
  ControlLineReader,
  MAX_CONTROL_REQUEST_LINE,
  controlEndpointPath,
  decodeControlReply,
  decodeControlRequest,
  encodeControlReply,
  encodeControlRequest,
  requestControl,
} from '../dist/cli/control.js';
import { createLifetimeLease, residentCommand } from '../dist/cli/resident.js';

const CLI = join(import.meta.dirname, '..', 'dist', 'cli', 'main.js');
const RESIDENT_URL = pathToFileURL(join(import.meta.dirname, '..', 'dist', 'cli', 'resident.js')).href;

// A roster shaped like the resident's default one, and deliberately its own copy: this file states
// what it expects to find on a pipe instead of agreeing with whatever the other file happens to hold.
// It is the fake these tests hand in, not the production list — the production rosters are pinned in
// `resident-cli.test.mjs`, and this one is free to stay shorter than they are.
const MEMBER_IDS = [
  'continuity',
  'chronicle',
  'foreground.windows',
  'input-activity.windows',
  'desktop-session-world',
  'desktop-session-awareness',
  'desktop-session-awareness-loop',
  'work-focus',
];

const ALL_ACTIVE = MEMBER_IDS.map(() => 'active');

// Named pipes are the whole of this surface, so everything that has to reach a real endpoint is
// Windows-only. What is left ungated below is the protocol, which is pure text and has no host.
const NO_PIPES = process.platform === 'win32' ? false : '命名管道只在 Windows 上存在';

function createRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'hikari-control-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function runCli(...args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  assert.equal(result.error, undefined);
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function residentIo() {
  const out = [];
  const err = [];
  const collect = (sink) => (text) => {
    for (const line of text.split('\n')) if (line) sink.push(line);
  };
  return {
    outLines: out,
    get errText() {
      return err.join('\n');
    },
    out: collect(out),
    err: collect(err),
  };
}

function compositionOf(states) {
  return MEMBER_IDS.map((id, index) => ({ id, load: async () => states[index] ?? 'active' }));
}

function fakeRuntime({ states = {}, errors = {}, shutdown } = {}) {
  const calls = { shutdown: 0 };
  return {
    calls,
    getPluginState: (id) => states[id] ?? 'active',
    getPluginError: (id) => errors[id],
    async shutdown() {
      calls.shutdown += 1;
      if (shutdown) await shutdown();
    },
  };
}

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
  return {
    get text() {
      return chunks.join('');
    },
  };
}

const idPattern = (id) => new RegExp(id.replaceAll('.', '\\.'));

// ---------------------------------------------------------------------------------------------
// The protocol. Text, no host, no pipes.
// ---------------------------------------------------------------------------------------------

test('协议只有一个版本、两个词，多出任何一个字段都被拒绝而不是宽容读取', () => {
  assert.equal(CONTROL_PROTOCOL_VERSION, 1);
  assert.deepEqual(decodeControlRequest(encodeControlRequest('status')), {
    kind: 'request',
    request: 'status',
  });
  assert.deepEqual(decodeControlRequest(encodeControlRequest('stop')), {
    kind: 'request',
    request: 'stop',
  });

  // An envelope that shrugged at unknown fields would already be an extensible schema, and "no
  // payload, no routing, no plugin id" would stop being a property of this build. These cases are
  // how that claim is held: not by leaving room unused, but by refusing room.
  assert.equal(decodeControlRequest('{"protocol":1,"request":"status","payload":{}}').kind, 'refused');
  assert.equal(decodeControlRequest('{"protocol":1,"request":"status","pluginId":"x"}').kind, 'refused');
  assert.equal(decodeControlRequest('{"protocol":1,"request":"status","routing":[]}').kind, 'refused');
  assert.equal(decodeControlRequest('{"protocol":1,"request":"ping"}').kind, 'refused');
  assert.equal(decodeControlRequest('{"protocol":2,"request":"status"}').kind, 'refused');
  assert.equal(decodeControlRequest('{"protocol":1}').kind, 'refused');
  assert.equal(decodeControlRequest('["status"]').kind, 'refused');
  assert.equal(decodeControlRequest('null').kind, 'refused');
  assert.equal(decodeControlRequest('not json').kind, 'refused');
});

test('应答的 outcome 与 lines 被检查，而不是被相信', () => {
  const encoded = encodeControlReply({ outcome: 'ok', lines: ['一', '二'] });
  assert.deepEqual(decodeControlReply(encoded), { kind: 'reply', outcome: 'ok', lines: ['一', '二'] });
  assert.equal(decodeControlReply('{"protocol":1,"outcome":"ok","lines":[1]}').kind, 'unreadable');
  assert.equal(decodeControlReply('{"protocol":1,"outcome":"maybe","lines":[]}').kind, 'unreadable');
  assert.equal(decodeControlReply('{"protocol":1,"outcome":"ok"}').kind, 'unreadable');
  assert.equal(decodeControlReply('{"protocol":1,"outcome":"ok","lines":[],"extra":1}').kind, 'unreadable');
});

test('行框定把管道当字节流：跨块的行被拼回，超限的流被拒绝而不是继续缓冲', () => {
  const reader = new ControlLineReader(MAX_CONTROL_REQUEST_LINE);
  assert.deepEqual(reader.push('{"pro'), { kind: 'pending' });
  assert.deepEqual(reader.push('tocol":1}\n'), { kind: 'line', line: '{"protocol":1}' });

  // A reader that kept buffering would let whoever is on the other end of the pipe decide how much
  // memory this process spends, so the bound is on what is held and not only on what is parsed.
  const bound = new ControlLineReader(8);
  assert.equal(bound.push('x'.repeat(9)).kind, 'overflow');
  // And it stays refused: a stream that has already broken the frame is not re-parsed on the next
  // chunk, because there is no longer a frame to parse it against.
  assert.equal(bound.push('x\n').kind, 'overflow');

  const longLine = new ControlLineReader(4);
  assert.equal(longLine.push('aaaaa\n').kind, 'overflow');
});

// ---------------------------------------------------------------------------------------------
// Discovery.
// ---------------------------------------------------------------------------------------------

test('端点名由数据目录确定派生，同一目录的不同写法给出同一个端点', { skip: NO_PIPES }, (t) => {
  const root = createRoot(t);
  const path = controlEndpointPath(root);

  assert.match(path, /^\\\\\.\\pipe\\hikari-resident-[0-9a-f]{16}$/);

  // Deterministic means both ends agree without being told: the resident derives the name from the
  // data directory it was given, and so does every client. Nothing is written down and read back.
  assert.equal(controlEndpointPath(root), path);
  assert.equal(controlEndpointPath(`${root}\\.`), path);
  assert.equal(controlEndpointPath(`${root}\\`), path);

  // The filesystem spelling and a differently-cased spelling are the same directory, so they have to
  // be the same endpoint — which is why the canonical form is lowercased rather than left as spelled.
  assert.equal(controlEndpointPath(root.toUpperCase()), path);
  // `..` after a segment that does not exist: the realpath branch cannot resolve it and the lexical
  // fallback is what runs. Both branches have to land on the same name or the two ends of this
  // protocol would disagree about which endpoint a data directory owns.
  assert.equal(controlEndpointPath(`${root}\\not-a-subdirectory\\..`), path);

  // A directory that does not exist yet is an ordinary state — it is exactly what `hikari init` has
  // not created — and it still derives an endpoint rather than raising an error this module has no
  // business raising.
  assert.match(controlEndpointPath(join(root, 'not-created-yet')), /^\\\\\.\\pipe\\/);

  assert.notEqual(controlEndpointPath(join(root, 'somewhere-else')), path);
});

test('没有常驻时，控制命令得到的是"没有常驻"而不是一个错误', { skip: NO_PIPES }, async (t) => {
  const root = createRoot(t);
  assert.deepEqual(await requestControl(root, 'status'), { kind: 'absent' });
});

test('控制命令只认自己那个数据目录的端点', { skip: NO_PIPES }, async (t) => {
  const root = createRoot(t);
  const other = createRoot(t);
  const io = residentIo();
  const lease = createLifetimeLease();

  const pending = residentCommand(
    { dataDir: root, desktopAwarenessDelayMs: 1000 },
    {
      composition: compositionOf(ALL_ACTIVE),
      io,
      runtime: fakeRuntime(),
      createLease: () => lease,
    },
  );

  await until(() => io.outLines.length > 0, 15_000, `常驻没有报告就绪：${io.errText}`);

  // A resident is reachable at the endpoint its own data directory names, and nowhere else. That is
  // the whole of the addressing model: there is no registry to list residents and no port to scan,
  // so a data directory either has a resident or it does not.
  assert.deepEqual(await requestControl(other, 'status'), { kind: 'absent' });

  await requestControl(root, 'stop');
  await within(pending, 15_000, '常驻没有退出');
});

// ---------------------------------------------------------------------------------------------
// The endpoint and the resident it reports on.
// ---------------------------------------------------------------------------------------------

test('status 转述的是 Runtime 此刻的记录，stop 走的是同一条优雅停机路径', { skip: NO_PIPES }, async (t) => {
  const root = createRoot(t);
  const io = residentIo();
  const lease = createLifetimeLease();
  const runtime = fakeRuntime({
    states: { chronicle: 'failed' },
    errors: { chronicle: new Error('Chronicle store does not exist') },
  });

  const pending = residentCommand(
    { dataDir: root, desktopAwarenessDelayMs: 1000 },
    {
      composition: compositionOf(ALL_ACTIVE),
      io,
      runtime,
      createLease: () => lease,
    },
  );

  await until(() => io.outLines.length > 0, 15_000, `常驻没有报告就绪：${io.errText}`);

  const status = await requestControl(root, 'status');
  assert.equal(status.kind, 'answered');
  assert.equal(status.outcome, 'ok');
  const text = status.lines.join('\n');

  assert.match(text, /Hikari 常驻状态：/);
  for (const id of MEMBER_IDS) assert.match(text, idPattern(id));
  assert.match(text, /continuity 状态：active/);

  // The composition loaded clean and the Runtime has since recorded something else about chronicle.
  // That is the point: status reports what the Runtime knows now, not what loading returned once.
  assert.match(text, /chronicle 状态：failed/);
  assert.match(text, /chronicle：Chronicle store does not exist/);
  assert.doesNotMatch(text, /正在停止/);

  const stop = await requestControl(root, 'stop');
  assert.equal(stop.kind, 'answered');
  assert.equal(stop.outcome, 'ok');

  const outcome = await within(pending, 15_000, 'stop 之后常驻没有退出');
  assert.equal(outcome.exitCode, 0);
  // `stop` asks for the same thing the first signal asks for, so the resident stops the way it always
  // stops: announcement, shutdown once, lease released. A second path through shutdown would be a
  // second ordering to keep honest.
  assert.deepEqual(io.outLines, ['Hikari 常驻已启动。', 'Hikari 常驻已停止。']);
  assert.equal(io.errText, '');
  assert.equal(runtime.calls.shutdown, 1);
  assert.equal(lease.isHolding(), false);

  // And the endpoint is gone with it, which is what makes the next question answerable at all.
  assert.deepEqual(await requestControl(root, 'status'), { kind: 'absent' });
});

test('shutdown 进行中 endpoint 仍然在，并且如实报告正在停止', { skip: NO_PIPES }, async (t) => {
  const root = createRoot(t);
  const io = residentIo();
  let finishShutdown;
  const shutdownDone = new Promise((resolve) => {
    finishShutdown = resolve;
  });

  const runtime = fakeRuntime({ shutdown: () => shutdownDone });

  const pending = residentCommand(
    { dataDir: root, desktopAwarenessDelayMs: 1000 },
    {
      composition: compositionOf(ALL_ACTIVE),
      io,
      runtime,
      createLease: () => createLifetimeLease(),
    },
  );

  await until(() => io.outLines.length > 0, 15_000, `常驻没有报告就绪：${io.errText}`);
  await requestControl(root, 'stop');
  await until(() => runtime.calls.shutdown === 1, 15_000, 'shutdown 没有开始');

  // The window this test holds open is the window an operator actually types `hikari status` in:
  // shutdown has begun and has no fixed duration. Closing the endpoint first would report "no
  // resident" for the whole of a teardown that is very much still happening — a client told
  // something true about timing, and something false about the world.
  const status = await requestControl(root, 'status');
  assert.equal(status.kind, 'answered');
  assert.match(status.lines.join('\n'), /Hikari 常驻正在停止。/);

  finishShutdown();
  const outcome = await within(pending, 15_000, 'shutdown 完成后常驻没有退出');
  assert.equal(outcome.exitCode, 0);

  // Gone before the process is, not after: what was awaited during shutdown is what makes this true.
  assert.deepEqual(await requestControl(root, 'status'), { kind: 'absent' });
});

test('连接了却不说话的客户端不会拖住 shutdown', { skip: NO_PIPES }, async (t) => {
  const root = createRoot(t);
  const io = residentIo();

  const pending = residentCommand(
    { dataDir: root, desktopAwarenessDelayMs: 1000 },
    {
      composition: compositionOf(ALL_ACTIVE),
      io,
      runtime: fakeRuntime(),
      createLease: () => createLifetimeLease(),
    },
  );

  await until(() => io.outLines.length > 0, 15_000, `常驻没有报告就绪：${io.errText}`);

  // Connecting and then saying nothing is an ordinary thing for a local process to do, and a server
  // that only stopped accepting would leave this connection as the last thing holding the resident's
  // shutdown open. What it accepted, it closes.
  const client = connect(controlEndpointPath(root));
  // Destroying the server's half of a connection the client never wrote to can surface here as
  // ECONNRESET, which is this test's expected ending rather than a failure of it.
  client.on('error', () => {});
  await once(client, 'connect');
  t.after(() => client.destroy());

  await requestControl(root, 'stop');
  const outcome = await within(pending, 15_000, '一个不说话的连接拖住了 shutdown');
  assert.equal(outcome.exitCode, 0);
  await until(() => client.destroyed, 5_000, '不说话的连接没有被关闭');
});

// ---------------------------------------------------------------------------------------------
// Real processes.
// ---------------------------------------------------------------------------------------------

test('endpoint 不持有进程寿命：没有 lease 时，一个开着端点的常驻照样自行退出', { skip: NO_PIPES }, async (t) => {
  // A listening server is a handle, exactly like the lease is. This child is the experiment: the real
  // listener is armed on the real endpoint, the composition loads and reports ready — and the lease
  // is the one override that holds nothing. If the endpoint had been left ref'd, this process would
  // stay alive and the lease would be a decoration.
  const script = `
import { residentCommand } from ${JSON.stringify(RESIDENT_URL)};

const ids = ${JSON.stringify(MEMBER_IDS)};

const outcome = await residentCommand(
  { dataDir: 'endpoint-lifetime-probe', desktopAwarenessDelayMs: 1000 },
  {
    composition: ids.map((id) => ({ id, load: async () => 'active' })),
    runtime: { getPluginState: () => 'active', getPluginError: () => undefined, shutdown: async () => {} },
    io: { out: (text) => process.stdout.write(text), err: (text) => process.stderr.write(text) },
    createLease: () => ({ isHolding: () => false, release() {} }),
  },
);

process.exitCode = outcome.exitCode;
`;

  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  const out = collect(child.stdout);
  const err = collect(child.stderr);

  const code = await within(
    new Promise((resolve) => child.on('exit', resolve)),
    20_000,
    '开着端点的探针进程没有自行退出：端点取得了进程寿命',
  );

  // Node ends a process whose top-level await never settles with exit code 13, "Unfinished Top-Level
  // Await" — the signature of a process that ran out of reasons to keep going rather than one that
  // was stopped. It reported ready, and it was never asked to stop, so it never reported one.
  assert.notEqual(code, 0);
  assert.match(out.text, /Hikari 常驻已启动。/);
  assert.doesNotMatch(out.text, /Hikari 常驻已停止。/);
  // stderr carries Node's own "unsettled top-level await" warning, which is the expected signature of
  // this exit rather than a complaint about it. What must not be there is a failure from the resident.
  assert.doesNotMatch(err.text, /Hikari 常驻未启动/);
});

test('真实进程：status 与 stop 通过命名管道找到常驻，并让它优雅退出', { skip: NO_PIPES }, async (t) => {
  const root = createRoot(t);
  assert.equal(runCli('init', '--data-dir', root).code, 0);
  assert.equal(runCli('chronicle', 'init', '--data-dir', root).code, 0);

  const child = spawn(
    process.execPath,
    [CLI, 'resident', '--data-dir', root, '--desktop-awareness-delay-ms', '500'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  t.after(() => child.kill());
  const out = collect(child.stdout);
  const err = collect(child.stderr);
  const exited = new Promise((resolve) => child.on('exit', resolve));

  await until(
    () => out.text.includes('Hikari 常驻已启动。'),
    30_000,
    `常驻没有在限期内就绪：${err.text}`,
  );

  const status = runCli('status', '--data-dir', root);
  assert.equal(status.code, 0);
  assert.equal(status.stderr, '');
  assert.match(status.stdout, /Hikari 常驻状态：/);
  for (const id of MEMBER_IDS) assert.match(status.stdout, idPattern(id));
  assert.doesNotMatch(status.stdout, /正在停止/);

  const stop = runCli('stop', '--data-dir', root);
  assert.equal(stop.code, 0);
  assert.equal(stop.stderr, '');
  assert.match(stop.stdout, /已请求 Hikari 常驻停止。/);

  // Windows cannot deliver a graceful termination to another process. This is that termination, and
  // it ends the way a Ctrl+C ends: the resident shuts its own Runtime down and leaves by itself.
  const code = await within(exited, 30_000, 'stop 之后常驻进程没有退出');
  assert.equal(code, 0);
  assert.match(out.text, /Hikari 常驻已停止。/);
  assert.equal(err.text, '');

  // The endpoint went with the process, so the same question now gets a different, equally true
  // answer — and the answer names what to do instead of leaving an operator with a failed command.
  const after = runCli('status', '--data-dir', root);
  assert.equal(after.code, 1);
  assert.equal(after.stdout, '');
  assert.match(after.stderr, /没有正在运行的 Hikari 常驻。/);
  assert.match(after.stderr, /hikari resident --data-dir <path>/);
});

test('一个数据目录只允许一个常驻：第二个拒绝启动，而不是共用一个端点', { skip: NO_PIPES }, async (t) => {
  const root = createRoot(t);
  assert.equal(runCli('init', '--data-dir', root).code, 0);
  assert.equal(runCli('chronicle', 'init', '--data-dir', root).code, 0);

  const child = spawn(
    process.execPath,
    [CLI, 'resident', '--data-dir', root, '--desktop-awareness-delay-ms', '500'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  t.after(() => child.kill());
  const out = collect(child.stdout);
  const err = collect(child.stderr);

  await until(
    () => out.text.includes('Hikari 常驻已启动。'),
    30_000,
    `常驻没有在限期内就绪：${err.text}`,
  );

  // Two residents on one data directory would mean two Runtimes writing the same store and one
  // endpoint answering for both — a `status` describing one process and a `stop` ending the other.
  // The endpoint is per data directory and the operating system enforces it, so the second one is
  // refused rather than allowed to run unaddressable.
  const second = runCli('resident', '--data-dir', root, '--desktop-awareness-delay-ms', '500');
  assert.equal(second.code, 1);
  assert.equal(second.stdout, '', '拒绝启动的常驻不应宣布自己已启动');
  assert.match(second.stderr, /已被另一个 Hikari 常驻占用/);
  assert.match(second.stderr, /hikari stop --data-dir <path>/);

  // The one that was already running is untouched by the attempt.
  assert.equal(runCli('status', '--data-dir', root).code, 0);

  assert.equal(runCli('stop', '--data-dir', root).code, 0);
  const code = await within(
    new Promise((resolve) => child.on('exit', resolve)),
    30_000,
    'stop 之后常驻进程没有退出',
  );
  assert.equal(code, 0);
});
