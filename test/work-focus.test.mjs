import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createServer, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

import { Runtime, defineEvent, defineService } from '../dist/index.js';
import { controlEndpointPath, requestControl } from '../dist/cli/control.js';
import { focusFailureLines, requestWorkFocus } from '../dist/cli/focus.js';
import {
  ChroniclePersistenceError,
  chroniclePlugin,
  chronicleService,
  initializeChronicle,
  openChronicle,
} from '../dist/chronicle/index.js';
import { continuityPlugin, initializeHikari, restoreHikari } from '../dist/continuity/index.js';
import { workFocusFactDraft } from '../dist/work-focus/facts.js';
import { createWorkFocusSession } from '../dist/work-focus/session.js';
import {
  MAX_WORK_FOCUS_REQUEST_LINE,
  WORK_FOCUS_PROTOCOL_VERSION,
  WorkFocusLineReader,
  decodeWorkFocusReply,
  decodeWorkFocusRequest,
  encodeWorkFocusReply,
  encodeWorkFocusRequest,
  workFocusCurrentService,
  workFocusEndpointPath,
  workFocusPlugin,
  workFocusReadExposure,
} from '../dist/work-focus/index.js';

const CLI = join(import.meta.dirname, '..', 'dist', 'cli', 'main.js');

// Named pipes are the whole of this surface, so everything that has to reach a real endpoint is
// Windows-only. What is left ungated is the protocol, which is pure text and has no host.
const NO_PIPES = process.platform === 'win32' ? false : '命名管道只在 Windows 上存在';

const HEADER = '当前工作焦点：';
const NONE = '（当前没有任何工作焦点。）';

// The whole of the visible difference between a change whose record is confirmed and one whose is
// not, written out here for the same reason `HEADER` and `NONE` are: a test that took the wording
// from the module would agree with whatever the module happened to say, including after somebody
// reworded it into something a human would misread.
const UNCONFIRMED = '（这次变化已生效，但没有取得 Chronicle 的可靠持久化确认，可能没有被记下来。）';

// The contract this plugin is forbidden to publish, named here so its absence can be asserted. A
// test that claimed "no Event was emitted" without naming the Event it means would be asserting
// nothing at all.
//
// It used to have a companion: `work-focus.current@1` was in the same list, and there was a test
// here asserting that a plugin requiring it stayed `waiting`. That is no longer the answer, and the
// test that replaced it says why — the Contract Creation Gate turns on whether a real callable need
// exists, and one now does.
const FORBIDDEN_EVENT = defineEvent('work-focus.changed', 1);

function createRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'hikari-work-focus-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

// A data directory with both stores a Runtime that holds this plugin needs. These are the same two
// functions `hikari init` and `hikari chronicle init` call, so a test that needs a root set up does
// not pay for two child processes to get one — and the assertions about the *commands* stay where they
// belong, in the end-to-end test at the bottom of this file.
function initializedRoot(t) {
  const root = createRoot(t);
  const identity = initializeHikari({ rootDir: root });
  initializeChronicle({ rootDir: root, identity });
  return root;
}

// The composition this plugin is in now that it writes its own durable facts: a Runtime that holds
// work-focus holds the fact history it writes into, exactly as the resident's does.
//
// Every test here that used to load the plugin alone loads this instead, and not for tidiness. A
// plugin whose `requires` is unsatisfied stays `waiting` — `setup` never runs, no endpoint is ever
// bound — so a test that kept the old bare Runtime would see every request answered by nobody, and
// would be measuring the absence of a composition rather than the behaviour it is named for.
async function compose(root) {
  const runtime = new Runtime();
  await runtime.loadPlugin(continuityPlugin, { rootDir: root });
  await runtime.loadPlugin(chroniclePlugin, { rootDir: root });
  const state = await runtime.loadPlugin(workFocusPlugin, { rootDir: root });
  assert.equal(state, 'active', '工作焦点插件没有激活');
  return runtime;
}

// What the history holds, read by a reader that is not the writer: a separate service opened on the
// same directory, which parses the store out of the file on every call. Asking the Runtime's own
// service would be asking the plugin to grade its own work, and would pass just as happily if nothing
// had reached the disk.
async function readFacts(root) {
  return openChronicle({ rootDir: root, identity: restoreHikari({ rootDir: root }) }).read();
}

function factTypes(facts) {
  return facts.map((fact) => fact.type);
}

async function withPlugin(t, body) {
  const root = initializedRoot(t);
  const runtime = await compose(root);

  try {
    await body({ root, runtime });
  } finally {
    await runtime.shutdown();
  }
}

// The real client, not a hand-rolled socket: what a test asserts through should be the same code a
// human's command runs, or it is asserting about a second implementation of the same idea.
async function ask(root, request) {
  const answer = await requestWorkFocus(root, request);
  assert.equal(answer.kind, 'answered', `没有拿到应答：${JSON.stringify(answer)}`);
  return answer;
}

async function status(root) {
  return ask(root, { word: 'status' });
}

async function declare(root, designation) {
  return ask(root, { word: 'declare', designation });
}

async function replace(root, designations) {
  return ask(root, { word: 'replace', designations });
}

async function clear(root) {
  return ask(root, { word: 'clear' });
}

function designationsOf(answer) {
  assert.equal(answer.outcome, 'ok', `请求被拒绝：${answer.lines.join(' / ')}`);
  assert.equal(answer.lines[0], HEADER);
  return answer.lines.slice(1);
}

// Raw framing, for the cases the real client cannot produce: a malformed line, an unknown word, a
// field the vocabulary does not have.
function rawAsk(path, text) {
  return new Promise((resolve, reject) => {
    const socket = connect(path);
    const chunks = [];
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${text}\n`));
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('end', () => resolve(chunks.join('')));
    socket.on('error', reject);
  });
}

async function refusalFor(path, text) {
  const reply = decodeWorkFocusReply((await rawAsk(path, text)).trim());
  assert.equal(reply.kind, 'reply', `应答不可读：${JSON.stringify(reply)}`);
  assert.equal(reply.outcome, 'failed', `本该被拒绝，却成功了：${text}`);
  assert.ok(reply.lines.length > 0 && reply.lines.join('').trim(), `拒绝没有给出理由：${text}`);
  return reply.lines.join(' ');
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

async function until(predicate, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(25);
  }
  assert.fail(message);
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

// ---------------------------------------------------------------------------------------------
// The protocol. Text, no host, no pipes.
// ---------------------------------------------------------------------------------------------

test('协议只有一个版本、四个词，字段集合逐词精确', () => {
  assert.equal(WORK_FOCUS_PROTOCOL_VERSION, 1);

  // A round trip is the claim being made here: what the client encodes is what the owner can read
  // back. A spread that put the type's own field name on the wire would fail every line below.
  const requests = [
    { word: 'status' },
    { word: 'clear' },
    { word: 'declare', designation: 't1mb2rg/hikari-new' },
    { word: 'replace', designations: ['DesktopAgent', 'hikari-new'] },
  ];
  for (const request of requests) {
    assert.deepEqual(decodeWorkFocusRequest(encodeWorkFocusRequest(request)), {
      kind: 'request',
      request,
    });
  }

  // An envelope that shrugged at unknown fields would already be an extensible schema, and the next
  // person to want a field would find the room already reserved for them.
  assert.equal(decodeWorkFocusRequest('{"protocol":1,"request":"status","designation":"x"}').kind, 'refused');
  assert.equal(decodeWorkFocusRequest('{"protocol":1,"request":"declare"}').kind, 'refused');
  assert.equal(decodeWorkFocusRequest('{"protocol":1,"request":"declare","designation":"x","extra":1}').kind, 'refused');
  assert.equal(decodeWorkFocusRequest('{"protocol":1,"request":"replace"}').kind, 'refused');
  assert.equal(decodeWorkFocusRequest('{"protocol":1,"request":"erase"}').kind, 'refused');
  assert.equal(decodeWorkFocusRequest('{"protocol":2,"request":"status"}').kind, 'refused');
  assert.equal(decodeWorkFocusRequest('["status"]').kind, 'refused');
  assert.equal(decodeWorkFocusRequest('null').kind, 'refused');
  assert.equal(decodeWorkFocusRequest('not json').kind, 'refused');
});

test('请求的 payload 被检查类型，而不是被相信', () => {
  assert.equal(decodeWorkFocusRequest('{"protocol":1,"request":"declare","designation":7}').kind, 'refused');
  assert.equal(decodeWorkFocusRequest('{"protocol":1,"request":"declare","designation":null}').kind, 'refused');
  assert.equal(decodeWorkFocusRequest('{"protocol":1,"request":"replace","designations":"x"}').kind, 'refused');
  assert.equal(decodeWorkFocusRequest('{"protocol":1,"request":"replace","designations":["ok",1]}').kind, 'refused');

  // An empty list is structurally fine and semantically refused. The split matters: whether the
  // empty set may be expressed by `replace` is a statement about the focus, not about the envelope,
  // and the decoder is not where that is decided.
  assert.deepEqual(decodeWorkFocusRequest('{"protocol":1,"request":"replace","designations":[]}'), {
    kind: 'request',
    request: { word: 'replace', designations: [] },
  });
});

test('应答被检查而不是被相信', () => {
  const encoded = encodeWorkFocusReply({ outcome: 'ok', lines: ['一', '二'] });
  assert.deepEqual(decodeWorkFocusReply(encoded), { kind: 'reply', outcome: 'ok', lines: ['一', '二'] });
  assert.equal(decodeWorkFocusReply('{"protocol":1,"outcome":"ok","lines":[1]}').kind, 'unreadable');
  assert.equal(decodeWorkFocusReply('{"protocol":1,"outcome":"maybe","lines":[]}').kind, 'unreadable');
  assert.equal(decodeWorkFocusReply('{"protocol":1,"outcome":"ok"}').kind, 'unreadable');
  assert.equal(decodeWorkFocusReply('{"protocol":1,"outcome":"ok","lines":[],"extra":1}').kind, 'unreadable');
});

test('行框定把管道当字节流：跨块的行被拼回，超限的流被拒绝而不是继续缓冲', () => {
  const reader = new WorkFocusLineReader(MAX_WORK_FOCUS_REQUEST_LINE);
  assert.deepEqual(reader.push('{"pro'), { kind: 'pending' });
  assert.deepEqual(reader.push('tocol":1}\n'), { kind: 'line', line: '{"protocol":1}' });

  const bound = new WorkFocusLineReader(8);
  assert.equal(bound.push('x'.repeat(9)).kind, 'overflow');
  // And it stays refused. The reader does remember that it overflowed, but the memory is not what
  // does the work: `#pending` is never reset, so whatever line arrives next is necessarily longer
  // than the limit and the length check refuses it too. The guard states the intent; the arithmetic
  // is what enforces it, and this assertion holds with the guard deleted.
  assert.equal(bound.push('x\n').kind, 'overflow');
});

// Ungated on purpose, and it is the only test of the failure wording that is. Everything else that
// exercises `focusFailureLines` goes through a real endpoint and is therefore skipped on the machine
// CI runs on — which would leave the artifact under review here covered only where nobody looks.
test('三种失败各有自己的措辞，且"有东西但坏了"不会被说成"什么都没有"', () => {
  const absent = focusFailureLines({ kind: 'absent' });
  const unavailable = focusFailureLines({ kind: 'unavailable', detail: '连接被拒绝。' });

  // `/没有正在运行/` rather than the whole control-channel sentence: the forbidden claim is
  // "nothing is running", and the wording this replaced — `没有正在运行、且已加载工作焦点入口的
  // Hikari 常驻。` — carried it without being that exact sentence, so an equality check would have
  // waved it through.
  assert.ok(!/没有正在运行/.test(absent.join('\n')));
  assert.match(absent[0], /没有正在提供工作焦点入口/);
  assert.match(absent[1], /若常驻尚未启动/);
  assert.match(absent[1], /正在启动或停止/);

  // The distinction between the two branches used to be unguarded: replacing the non-ENOENT branch of
  // `requestWorkFocus` with `finish({ kind: 'absent' })` broke no test in this file. This is the
  // assertion that would have caught it.
  assert.deepEqual(unavailable, ['无法访问 Hikari 工作焦点入口：连接被拒绝。']);
});

// Also ungated: every one of these is refused while argv is being read, so no endpoint and no pipe
// namespace is involved. Measured before this test existed — deleting the `replace` rule and the
// `clear`/`status` rule from `readFocusArity` left 72 tests across three files passing, and turned
// all three malformed invocations below into exit 1 with a "no resident" message.
test('CLI 的语法面在 argv 上被拒绝，而不是被送过管道', () => {
  const root = join(tmpdir(), 'hikari-focus-arity');
  const cases = [
    [['focus', 'erase', '--data-dir', root], /只支持 declare \/ replace \/ clear \/ status/],
    [['focus', 'replace', '--data-dir', root], /至少需要一个工作焦点/],
    [['focus', 'clear', '--data-dir', root, 'stray'], /不接受工作焦点参数/],
    [['focus', 'status', '--data-dir', root, 'stray'], /不接受工作焦点参数/],
    [['focus', 'declare', '--data-dir', root, 'A', 'B'], /恰好一个工作焦点/],
    [['focus', 'declare', '--data-dir', root, '-oops'], /未知参数：-oops/],
    [['focus', 'declare', '--data-dir', root, '--data-dir', root], /--data-dir 只能指定一次/],
  ];

  for (const [args, pattern] of cases) {
    const result = runCli(...args);
    assert.equal(result.code, 2, `不是用法错误：${args.join(' ')} → ${result.stderr}`);
    assert.match(result.stderr, pattern);
  }
});

test('端点名由数据目录确定派生，且与控制通道的端点不同名', { skip: NO_PIPES }, (t) => {
  const root = createRoot(t);
  const path = workFocusEndpointPath(root);

  assert.match(path, /^\\\\\.\\pipe\\hikari-work-focus-[0-9a-f]{16}$/);
  assert.equal(workFocusEndpointPath(root), path);
  assert.equal(workFocusEndpointPath(`${root}\\`), path);
  assert.equal(workFocusEndpointPath(root.toUpperCase()), path);
  assert.equal(workFocusEndpointPath(`${root}\\not-a-subdirectory\\..`), path);
  assert.match(workFocusEndpointPath(join(root, 'not-created-yet')), /^\\\\\.\\pipe\\/);
  assert.notEqual(workFocusEndpointPath(join(root, 'somewhere-else')), path);

  // Every case assertion above is answered by `realpathSync.native`, which returns the on-disk
  // spelling for a directory that exists — so none of them constrains the lowercasing at all. The
  // lexical fallback is the branch a directory that does NOT exist takes, which is exactly the
  // state `hikari init` has not been run in yet, and there the lowercasing is the only thing making
  // two spellings one pipe. Without it, a client and a resident that spell a not-yet-created data
  // directory differently would derive different endpoints and never meet.
  const missing = join(root, 'not-created-yet');
  assert.equal(workFocusEndpointPath(missing.toUpperCase()), workFocusEndpointPath(missing));

  // Two surfaces, one data directory, and no way for one to be mistaken for the other. A shared name
  // would make a work focus write land on the Resident's control endpoint — which would refuse it,
  // but only after the human had already been told nothing useful about why.
  assert.notEqual(path, controlEndpointPath(root));
});

// ---------------------------------------------------------------------------------------------
// The focus itself.
// ---------------------------------------------------------------------------------------------

test('初始状态为空，且空是一个合法的答案而不是一次失败', { skip: NO_PIPES }, async (t) => {
  await withPlugin(t, async ({ root }) => {
    const answer = await status(root);
    assert.equal(answer.outcome, 'ok');
    assert.deepEqual(answer.lines, [HEADER, NONE]);
  });
});

test('declare 把一个焦点加入集合，重复声明不是错误也不是变化', { skip: NO_PIPES }, async (t) => {
  await withPlugin(t, async ({ root }) => {
    assert.deepEqual(designationsOf(await declare(root, 't1mb2rg/hikari-new')), ['t1mb2rg/hikari-new']);
    assert.deepEqual(designationsOf(await declare(root, 'DesktopAgent')), [
      't1mb2rg/hikari-new',
      'DesktopAgent',
    ]);

    // A set has no room for a second copy of a member, so there is nothing to do and nothing to
    // report. Refusing would invent a rule — "one declaration per designation" — that this
    // capability has no use for.
    const again = await declare(root, 'DesktopAgent');
    assert.equal(again.outcome, 'ok');
    const lines = designationsOf(again);
    assert.equal(lines.length, 2);
    assert.deepEqual(new Set(lines), new Set(['t1mb2rg/hikari-new', 'DesktopAgent']));
  });
});

test('replace 整体替换，且请求内部的重复与跨请求的重复一样收敛', { skip: NO_PIPES }, async (t) => {
  await withPlugin(t, async ({ root }) => {
    await declare(root, '先前的焦点');

    const replaced = designationsOf(await replace(root, ['A', 'B', 'A']));
    assert.deepEqual(new Set(replaced), new Set(['A', 'B']));
    assert.equal(replaced.length, 2);

    // Nothing of the old set survives: `replace` is not a union with a new name.
    assert.ok(!replaced.includes('先前的焦点'));

    assert.deepEqual(designationsOf(await replace(root, ['只有一个'])), ['只有一个']);
  });
});

test('replace 拒绝空集：空集只有 clear 一个入口', { skip: NO_PIPES }, async (t) => {
  await withPlugin(t, async ({ root }) => {
    await declare(root, 'A');

    const answer = await replace(root, []);
    assert.equal(answer.outcome, 'failed');
    assert.match(answer.lines.join('\n'), /clear/);

    // A refusal that changed the state would be worse than either answer on its own.
    assert.deepEqual(designationsOf(await status(root)), ['A']);
  });
});

test('clear 清空集合，且重复 clear 是空操作', { skip: NO_PIPES }, async (t) => {
  await withPlugin(t, async ({ root }) => {
    await declare(root, 'A');
    await declare(root, 'B');

    assert.deepEqual(designationsOf(await clear(root)), [NONE]);

    const again = await clear(root);
    assert.equal(again.outcome, 'ok');
    assert.deepEqual(again.lines, [HEADER, NONE]);
  });
});

test('原始 designation 逐字保留：不 trim、不折叠大小写、不推断、不归并', { skip: NO_PIPES }, async (t) => {
  await withPlugin(t, async ({ root }) => {
    // Every one of these would be a different value under some transformation this module refuses to
    // perform. Whitespace inside, leading and trailing whitespace, case, a path separator, a domain
    // that looks like a repository and is not one, and a name that merely contains a repository name.
    const raw = [
      '  前后都有空白  ',
      'MiXeD CaSe',
      'G:\\work\\LAB\\code\\hikari-new',
      'https://github.com/t1mb2rg/hikari-new',
      'hikari-new',
      't1mb2rg/hikari-new',
      't1mb2rg/HIKARI-NEW',
    ];

    for (const designation of raw) {
      const lines = designationsOf(await declare(root, designation));
      assert.ok(
        lines.includes(designation),
        `原始文本没有逐字保留：${JSON.stringify(designation)} → ${JSON.stringify(lines)}`,
      );
    }

    // Read back, not just echoed: the store is what the next question is answered from.
    const readBack = designationsOf(await status(root));
    for (const designation of raw) assert.ok(readBack.includes(designation));
    assert.equal(readBack.length, raw.length);

    // And the two that differ only in case are two designations, not one — case folding here would
    // make a designation name something the human did not type. The count above is what says so:
    // folding the two into one would have left readBack shorter than raw.
  });
});

test('空白 designation 被拒绝，且拒绝不改变集合', { skip: NO_PIPES }, async (t) => {
  await withPlugin(t, async ({ root }) => {
    await declare(root, 'A');

    for (const blank of ['', '   ', '\t', '\n']) {
      const answer = await declare(root, blank);
      assert.equal(answer.outcome, 'failed', `空白焦点没有被拒绝：${JSON.stringify(blank)}`);
    }

    assert.deepEqual(designationsOf(await status(root)), ['A']);
  });
});

test('非法请求得到的是理由，不是沉默，也不是一个被改变的状态', { skip: NO_PIPES }, async (t) => {
  await withPlugin(t, async ({ root }) => {
    const path = workFocusEndpointPath(root);

    const cases = [
      'not json',
      'null',
      '{"protocol":2,"request":"status"}',
      '{"protocol":1,"request":"erase"}',
      '{"protocol":1,"request":"declare"}',
      '{"protocol":1,"request":"declare","designation":7}',
      '{"protocol":1,"request":"declare","designation":"A","extra":"x"}',
      '{"protocol":1,"request":"replace","designations":"A"}',
      '{"protocol":1,"request":"replace","designations":[]}',
    ];

    await declare(root, 'A');

    for (const line of cases) {
      await refusalFor(path, line);
      // Failure must not be compressed into absence, and it must not be compressed into a state
      // change either. After every refusal the answer to the only question that matters is the same.
      assert.deepEqual(designationsOf(await status(root)), ['A'], `拒绝之后集合被改动了：${line}`);
    }
  });
});

test('同一个端点连续服务多个请求，而不是一问即死', { skip: NO_PIPES }, async (t) => {
  await withPlugin(t, async ({ root }) => {
    await declare(root, 'A');
    await declare(root, 'B');
    await replace(root, ['C']);
    assert.deepEqual(designationsOf(await status(root)), ['C']);
    await clear(root);
    assert.deepEqual(designationsOf(await status(root)), [NONE]);
  });
});

test('读者能接受的最大请求仍然拿得到应答', { skip: NO_PIPES }, async (t) => {
  await withPlugin(t, async ({ root }) => {
    // Sized from the encoder rather than written down, so the arithmetic cannot drift away from the
    // envelope it is arithmetic about: this is the longest line the endpoint's reader will accept.
    const envelope = encodeWorkFocusRequest({ word: 'declare', designation: '' });
    const designation = 'a'.repeat(MAX_WORK_FOCUS_REQUEST_LINE - (envelope.length - 1));

    // The reply to this request is strictly larger than the request — it carries the same text plus
    // an envelope and a header — so a client bounded at the request's own limit would report this
    // successful write as a failure. That is the whole reason the two bounds are not the same number.
    assert.deepEqual(designationsOf(await declare(root, designation)), [designation]);
    assert.deepEqual(designationsOf(await status(root)), [designation]);
  });
});

// ---------------------------------------------------------------------------------------------
// What this plugin does not do.
// ---------------------------------------------------------------------------------------------

// The Contract Creation Gate, re-decided once a consumer existed. This test is the inverse of the one
// it replaced, and the inversion is the point: the gate asks whether a real cross-module interaction
// already occurs, and `repository-ci-relevance` requires exactly this contract — so it is published,
// and the production definition says so structurally rather than a probe saying it about one fixture.
//
// Nothing about the *Event* changed. The two contracts were never one decision; a service answers a
// question a caller has now, and an event announces something to subscribers who may not exist. Only
// the first found a caller.
test('work-focus.current@1 被登记，因为它有了真实的消费者', { skip: NO_PIPES }, async (t) => {
  await withPlugin(t, async ({ runtime }) => {
    assert.deepEqual(workFocusPlugin.provides, [workFocusCurrentService]);
    // This read `[]` until durable admission existed, and the freeze it enforced was re-adjudicated
    // for this plugin rather than dropped: the two reasons it named — no real ingress occurrence, no
    // admitted durable fact to write — are both false now. The whole list is pinned rather than only
    // the member that arrived, so a second hard dependency cannot appear without a line here naming
    // it; what the dependency *does* has its own test below.
    assert.deepEqual(workFocusPlugin.requires, [chronicleService]);

    const probe = {
      id: 'test.work-focus-service-probe',
      version: '1.0.0',
      requires: [workFocusCurrentService],
      provides: [],
      setup() {},
    };

    // `active` rather than `waiting`: the contract resolved, which is the only thing the gate was
    // ever asking about. A plugin left waiting here would mean the production composition had a
    // member that silently never runs.
    assert.equal(await runtime.loadPlugin(probe), 'active');
  });
});

test('work-focus.current@1 只暴露集合，而且是此刻的集合', { skip: NO_PIPES }, async (t) => {
  await withPlugin(t, async ({ root, runtime }) => {
    let focus;
    await runtime.loadPlugin({
      id: 'test.work-focus-service-reader',
      version: '1.0.0',
      requires: [workFocusCurrentService],
      provides: [],
      setup(context) {
        focus = context.services.get(workFocusCurrentService);
      },
    });

    assert.deepEqual(await focus.current(), []);

    // Declared through the endpoint, read through the contract. The two are one truth: the closure
    // reads the plugin's state when it is called rather than when it was provided, so a consumer
    // cannot be handed a snapshot taken before the human said anything.
    await declare(root, 'p4-03');
    assert.deepEqual(await focus.current(), ['p4-03']);

    // The set is the whole surface. `revision`, `changedAt` or `subscribe` are the fields a consumer
    // would reach for if it wanted a history, and this plugin keeps none — the Contract Gate admitted
    // a question about what is declared now, not a stream of how it got there.
    assert.deepEqual(Object.keys(focus), ['current']);
  });
});

test('没有 Event 被发出：一个订阅了它的插件永远收不到', { skip: NO_PIPES }, async (t) => {
  const root = initializedRoot(t);
  const runtime = new Runtime();
  const seen = [];
  const probe = {
    id: 'test.work-focus-event-probe',
    version: '1.0.0',
    requires: [],
    provides: [],
    setup(context) {
      context.events.on(FORBIDDEN_EVENT, (payload) => {
        seen.push(payload);
      });
    },
  };

  try {
    // The probe is loaded first, and the order is the whole point of the test. Loaded after the
    // plugin it would observe only request-time emissions and leave `setup` — the natural place for
    // an "I have arrived" announcement — structurally invisible. The claim is that no occurrence
    // becomes an Event, not that none does while somebody happens to be listening.
    assert.equal(await runtime.loadPlugin(probe), 'active');
    await runtime.loadPlugin(continuityPlugin, { rootDir: root });
    await runtime.loadPlugin(chroniclePlugin, { rootDir: root });
    assert.equal(await runtime.loadPlugin(workFocusPlugin, { rootDir: root }), 'active');

    await declare(root, 'A');
    await replace(root, ['B']);
    await clear(root);

    // An occurrence that only mirrors a module's own state should not become an Event no matter how
    // many subscribers it has, and this one does not even claim to be one.
    //
    // The arrival of a durable fact does not change the answer, and the two are worth keeping apart:
    // Chronicle is not an Event bus with a longer memory. An Event announces something to whoever is
    // listening now; a durable fact is a proposition the owner wrote down for a reader who may not
    // exist yet. This plugin does the second and still does not do the first.
    assert.deepEqual(seen, []);
  } finally {
    await runtime.shutdown();
  }
});

// This test used to assert that the data directory held nothing at all, before and after, and that is
// no longer a true statement about a composed Runtime: the focus it holds now writes durable facts,
// and the store those go into is one of the two a Runtime needs to exist at all.
//
// What survives from it is the half that was actually about *this plugin*: it has no store of its own.
// Nothing here persists the set — a restart re-reads none of this — so the claim being pinned is that
// three writes produce three facts in the store that was already there and no third file anywhere.
test('工作焦点没有自己的存储：写入之后数据目录里仍然只有那两个文件', { skip: NO_PIPES }, async (t) => {
  const root = initializedRoot(t);
  const before = readdirSync(root).sort();
  assert.ok(before.length > 0, '这个测试需要一个真的存在持久化介质的数据目录');

  const runtime = await compose(root);
  try {
    await declare(root, 'A');
    await replace(root, ['B']);
    await clear(root);

    // Checked first, so the file-set comparison below cannot pass by having observed a plugin that
    // never ran.
    assert.equal((await readFacts(root)).length, 3);
    assert.deepEqual(readdirSync(root).sort(), before, '工作焦点写了一个自己的文件');
  } finally {
    await runtime.shutdown();
  }
});

// Every file under `dir`, as `relative/path:size`. Sizes rather than names alone because the claim
// below is that nothing was written, and a rewrite of an existing file is a write that a listing of
// names would not show.
function snapshot(dir) {
  return readdirSync(dir, { recursive: true })
    .map((entry) => `${entry}:${statSync(join(dir, entry)).size}`)
    .sort();
}

/** The names in a `snapshot`, without their sizes. */
function fileNames(entries) {
  return entries.map((entry) => entry.slice(0, entry.lastIndexOf(':')));
}

// The guard this replaces said the opposite, and the inversion is the slice.
//
// It read: a `declare`, a `replace` and a `clear` move no byte under the data directory, "including
// Chronicle's" — the focus was in-memory, and a focus that reached a durable fact history would show
// up here as a new file, a longer file or a changed one. The freeze it enforced was written for a
// reason that no longer holds: there was no ingress, so there was no occurrence anyone could point at
// as having happened, and there was no admitted durable fact for a plugin to write. Both are now
// false. The ingress exists, the work focus is unambiguously the semantic owner of what a designation
// is, and Chronicle's contract already existed — so the human ruling that produced this code
// re-adjudicated the freeze for this plugin and no other.
//
// What replaces the guard is not the absence of one. The file set is still pinned (no third store
// appears, above), the state is still not restored from any of this (below), and the writes are pinned
// fact for fact — one per semantic transition, in order, each carrying what that transition did rather
// than a set read back afterwards.
test('三次真实写入写进 Chronicle 的正好是三条事实，顺序与载荷都对得上', { skip: NO_PIPES }, async (t) => {
  const root = initializedRoot(t);
  const before = snapshot(root);

  const runtime = await compose(root);
  try {
    await declare(root, 'A');
    await replace(root, ['B', 'C']);
    await clear(root);
  } finally {
    await runtime.shutdown();
  }

  const facts = await readFacts(root);
  assert.deepEqual(factTypes(facts), [
    'work-focus.declared',
    'work-focus.replaced',
    'work-focus.cleared',
  ]);
  assert.deepEqual(
    facts.map((fact) => fact.payload),
    [{ designation: 'A' }, { designations: ['B', 'C'] }, {}],
  );

  // And they are on the disk rather than in a service's memory: the same directory, listed again,
  // differs from what it was before the three writes only by the store's own growth. A fourth file
  // would be a second place a focus lives, and an unchanged listing would mean the facts above were
  // read from something that never reached a file.
  const after = snapshot(root);
  assert.deepEqual(fileNames(after), fileNames(before), '除了写入的存储之外，数据目录里多出了文件');
  assert.notDeepEqual(after, before, '三条事实写完了，存储却和写之前逐字节一样');
});

// ---------------------------------------------------------------------------------------------
// The durable admission rule. No host, no pipe, no Windows — the part CI can see.
//
// This group exists because of where CI runs. Everything that reaches a real endpoint is skipped on
// Linux, and the rule below is the whole of what this slice added; a version of it that only ran on
// the one machine with a pipe namespace would be a rule that nothing checks on the machine that
// merges it.
//
// It drives `createWorkFocusSession` directly, and that is the claim: the same function `plugin.ts`
// calls, so the rule asserted here is the rule a request over the pipe reaches — not a second
// implementation of it, which would be a test that agrees with itself.
//
// What it is not is the instance the plugin built. This one the test constructs; the plugin's own is
// reachable only through a bound pipe, and its wiring (`services.get(chronicleService)` above all) is
// therefore proven by the pipe-gated tests and not here. Stated rather than glossed, because "the CI
// segment covers the admission rule" and "the CI segment covers the plugin" are different claims and
// only the first one is true on Linux.
// ---------------------------------------------------------------------------------------------

// A chronicle that keeps what it was handed and can be told to fail. Deliberately not the real one:
// the failure below has no other way to be produced, because a store that only ever succeeds cannot
// show what this plugin does when its history is not there.
function fakeChronicle() {
  const drafts = [];
  const chronicle = {
    drafts,
    // Counted separately from `drafts`, and that is the point of having both: an append that throws
    // leaves no draft behind, and "was it even attempted" is a different question from "did it work".
    attempts: 0,
    fail: false,
    async append(draft) {
      chronicle.attempts += 1;
      if (chronicle.fail) throw new ChroniclePersistenceError('这个写入没有取得可靠持久化确认');
      drafts.push(draft);
      return {
        ...draft,
        factId: '00000000-0000-4000-8000-000000000000',
        recordedAt: draft.occurredAt,
      };
    },
    async get() {
      return undefined;
    },
    async read() {
      return [];
    },
  };
  return chronicle;
}

test('工作焦点要求 chronicle，而且没有它时停在 waiting', async () => {
  // The dependency is structural, and this is what "structural" means: a composition without
  // Chronicle does not get a work focus that runs anyway and writes nowhere. It gets no work focus at
  // all. Asserted on the record rather than on a returned string, because `waiting` is a state the
  // composition has to be able to find the plugin in afterwards.
  //
  // It also needs no pipe on either platform, and not by luck: a plugin waiting on an unsatisfied
  // `requires` never reaches `setup`, so the platform question this plugin asks there is never asked.
  assert.deepEqual(workFocusPlugin.requires, [chronicleService]);

  const runtime = new Runtime();
  try {
    assert.equal(await runtime.loadPlugin(workFocusPlugin, { rootDir: tmpdir() }), 'waiting');
    assert.equal(runtime.getPluginState('work-focus'), 'waiting');
  } finally {
    await runtime.shutdown();
  }
});

test('语义无操作连 append 都不调用：声明已有、清空空集、同集合替换、仅顺序不同的替换', async () => {
  const chronicle = fakeChronicle();
  const session = createWorkFocusSession(chronicle);

  // One real transition to count from, so everything after it is compared against a set that is
  // actually there.
  await session.answer({ word: 'replace', designations: ['A', 'B'] });
  assert.equal(chronicle.attempts, 1);

  // Asking changes nothing and is not an occurrence.
  await session.answer({ word: 'status' });

  // Already declared. A set has no room for a second copy, so nothing moved.
  await session.answer({ word: 'declare', designation: 'A' });

  // The same members, in the other order. Order is not part of this contract, so this is the same set
  // — which is the case that makes object identity the wrong test: this call does build a new array.
  await session.answer({ word: 'replace', designations: ['B', 'A'] });

  // And the same members with a repeat inside one request, which `replace` collapses before a set is
  // ever built from them.
  await session.answer({ word: 'replace', designations: ['A', 'B', 'A'] });

  assert.equal(chronicle.attempts, 1, '无操作调用了 append');
  assert.equal(chronicle.drafts.length, 1);

  // The empty set is a state this domain holds, and a `clear` into it is a transition; a `clear` of
  // it is not.
  await session.answer({ word: 'clear' });
  assert.equal(chronicle.attempts, 2);
  await session.answer({ word: 'clear' });
  assert.equal(chronicle.attempts, 2, 'clear 空集调用了 append');
});

test('每个真实转换恰好一条事实，且载荷来自那次转换而不是读的时候的 current()', async () => {
  const chronicle = fakeChronicle();
  const session = createWorkFocusSession(chronicle);

  await session.answer({ word: 'declare', designation: 'A' });
  await session.answer({ word: 'replace', designations: ['B', 'C'] });
  await session.answer({ word: 'clear' });

  assert.equal(chronicle.attempts, 3);
  assert.deepEqual(
    chronicle.drafts.map((draft) => draft.type),
    ['work-focus.declared', 'work-focus.replaced', 'work-focus.cleared'],
  );

  // The `replaced` payload is the one that decides this. By the time it is read here the set has been
  // cleared, so a draft derived from `current()` — or from the state whenever the fact is later read —
  // would carry the empty set instead of the two designations that actually arrived.
  assert.deepEqual(
    chronicle.drafts.map((draft) => draft.payload),
    [{ designation: 'A' }, { designations: ['B', 'C'] }, {}],
  );
  assert.deepEqual(session.current().designations, []);
});

test('事实的形状是 owner 自己声明的那一种，且来源只声称能证明的部分', async () => {
  const chronicle = fakeChronicle();
  const session = createWorkFocusSession(chronicle);

  const before = Date.now();
  await session.answer({ word: 'declare', designation: 'A' });
  const after = Date.now();

  const [draft] = chronicle.drafts;
  // Exactly the five fields `FactDraft` has. Nothing a fact might be *judged* by is here — no
  // importance, no salience, no confidence, no relation to another fact.
  assert.deepEqual(Object.keys(draft).sort(), [
    'occurredAt',
    'payload',
    'source',
    'type',
    'version',
  ]);
  assert.equal(draft.version, 1);

  // `human` would be the tempting word and it is the wrong one: the ingress has no authentication, so
  // anything on this host that can open the pipe can state a work focus. The endpoint is the whole of
  // what this plugin can prove, and this assertion is what turns a rewording to `human` red.
  assert.deepEqual(draft.source, { kind: 'work-focus.endpoint' });

  // The occurrence's clock, read when the change happened, not when the fact is read back.
  assert.match(draft.occurredAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const occurredAt = Date.parse(draft.occurredAt);
  assert.ok(
    occurredAt >= before && occurredAt <= after,
    `occurredAt 不在这次请求的窗口内：${draft.occurredAt}`,
  );
});

// The one clause of the admission rule that the session cannot observe, so it is asked directly.
//
// `facts.ts` answers `undefined` for `status`, and nothing that goes through the session can show it:
// the session's change test has already refused to build a draft for a request that moved nothing, and
// `status` never moves anything. The clause is not decoration for that reason — it is the family
// saying it has no type for a question, which is a claim about this owner's vocabulary rather than
// about one request path, and the next caller of this function will not be the session.
//
// The three types are asserted alongside it so that the first assertion cannot pass by the function
// having collapsed into returning `undefined` for everything.
test('这个家族里没有"问一句"这条事实：status 什么都不承认', () => {
  const state = Object.freeze({ designations: Object.freeze(['A']) });
  assert.equal(workFocusFactDraft({ word: 'status' }, state), undefined);

  assert.equal(workFocusFactDraft({ word: 'declare', designation: 'A' }, state).type, 'work-focus.declared');
  assert.equal(workFocusFactDraft({ word: 'replace', designations: ['B'] }, state).type, 'work-focus.replaced');
  assert.equal(workFocusFactDraft({ word: 'clear' }, state).type, 'work-focus.cleared');
});

test('持久化未确认：状态照常改变、不回滚、不重试、不抛出，而降级对调用方可见', async () => {
  const chronicle = fakeChronicle();
  const session = createWorkFocusSession(chronicle);

  await session.answer({ word: 'declare', designation: 'A' });
  chronicle.fail = true;

  // No try/catch here on purpose: the whole claim is that this resolves. A rejection would mean the
  // failure had escaped into whoever asked, and in the resident that is a process that dies because
  // its history is unavailable.
  const degraded = await session.answer({ word: 'declare', designation: 'B' });

  // The change stands. Undoing it would invent a state that never existed, on the strength of a write
  // that — this is the part that matters — may well have reached the disk anyway.
  assert.deepEqual(session.current().designations, ['A', 'B']);

  // And it is not a different outcome: the request succeeded, because it did. What the caller can
  // observe is the extra line, and nothing else.
  assert.equal(degraded.outcome, 'ok');
  assert.deepEqual(degraded.lines, [HEADER, 'A', 'B', UNCONFIRMED]);

  // One attempt, not two. A retry against a write that may already have landed is how one fact
  // becomes two, and nothing here knows which of the two it is.
  assert.equal(chronicle.attempts, 2);
  assert.equal(chronicle.drafts.length, 1);

  // The failure is not sticky either: the next write that does get a confirmation is admitted
  // normally, and the state it describes is the one that is actually held.
  chronicle.fail = false;
  const recovered = await session.answer({ word: 'declare', designation: 'C' });
  assert.deepEqual(recovered.lines, [HEADER, 'A', 'B', 'C']);
  assert.equal(chronicle.drafts.length, 2);
  assert.deepEqual(chronicle.drafts[1].payload, { designation: 'C' });
});

// ---------------------------------------------------------------------------------------------
// The agent-facing exposure: a view of the contract above, and not a second one.
//
// No pipe and no skip gate, because there is nothing here to reach over one — the exposure is three
// values and a reference, and the claims about it are claims about those.
// ---------------------------------------------------------------------------------------------

test('工作焦点的 exposure 由本插件导出，指向的仍是 work-focus.current@1', () => {
  // The name is the vocabulary of the layer that will offer it, so it is deliberately not the contract
  // id: `work-focus.current` names the Service, `work_focus_read` names the offer. What ties them
  // together is the field below rather than a convention, which is why it is asserted by identity.
  assert.equal(workFocusReadExposure.name, 'work_focus_read');
  assert.equal(workFocusReadExposure.service, workFocusCurrentService);
  assert.equal(workFocusReadExposure.service.id, 'work-focus.current');
  assert.equal(workFocusReadExposure.service.version, 1);

  // A capability is a view of a public Service (`core-architecture-v0.md` §5.3), so there is nothing
  // else to point at: a second contract carrying the same designations would be the duplicate truth
  // source that section refuses. The work focus provides exactly one Service, and this is it.
  assert.deepEqual(workFocusPlugin.provides, [workFocusCurrentService]);
  assert.ok(Object.isFrozen(workFocusReadExposure), 'exposure 应当是冻结的');
});

test('exposure 的描述既说能做什么，也说不做什么', () => {
  // Both halves are load-bearing and only one of them erodes. The offer half restates itself — a
  // capability that forgot what it was for is obvious — while the limit half is the part a later
  // reader is tempted to drop as a caveat, and dropping it is what turns "what the human declared"
  // back into "what the human is doing".
  assert.ok(workFocusReadExposure.description.length > 0);
  assert.ok(
    workFocusReadExposure.description.includes('不解释'),
    '描述必须写明不解释 designation 的含义',
  );
  assert.ok(
    workFocusReadExposure.description.includes('不推断'),
    '描述必须写明不推断优先级、重要性或用户正在做什么',
  );
});

// ---------------------------------------------------------------------------------------------
// Lifetime: the endpoint belongs to the activation and to nothing else.
// ---------------------------------------------------------------------------------------------

test('endpoint 跟随 Plugin activation：加载前没有，卸载后没有', { skip: NO_PIPES }, async (t) => {
  const root = initializedRoot(t);

  // Before any plugin exists there is nothing listening, and asking is answered rather than failed.
  assert.deepEqual(await requestWorkFocus(root, { word: 'status' }), { kind: 'absent' });

  const runtime = await compose(root);
  try {
    assert.deepEqual(designationsOf(await declare(root, 'A')), ['A']);

    await runtime.unloadPlugin('work-focus');
    assert.deepEqual(
      await requestWorkFocus(root, { word: 'status' }),
      { kind: 'absent' },
      '卸载之后端点仍然可达',
    );
  } finally {
    await runtime.shutdown();
  }
});

test('卸载时仍有活动连接不会泄漏，也不会拖住卸载', { skip: NO_PIPES }, async (t) => {
  const root = initializedRoot(t);
  const runtime = await compose(root);

  // Connecting and then saying nothing is an ordinary thing for a local process to do, and a server
  // that only stopped accepting would leave this connection as the last thing holding the plugin's
  // teardown open. What it accepted, it closes.
  //
  // Measured, not assumed: on Windows this test also passes with the endpoint's explicit destroy
  // loop deleted, because closing a named-pipe server terminates its accepted connections by itself.
  // So what the two assertions below actually pin is that unloading completes and the connection
  // ends — not that the loop is what ends it. The loop stays regardless, because `server.close()` is
  // documented to keep existing connections, and a guarantee that holds only while the platform is
  // generous is not a guarantee.
  const client = connect(workFocusEndpointPath(root));
  client.on('error', () => {});
  await new Promise((resolve) => client.once('connect', resolve));
  t.after(() => client.destroy());

  await within(runtime.unloadPlugin('work-focus'), 10_000, '一个不说话的连接拖住了卸载');
  await until(() => client.destroyed, 5_000, '不说话的连接没有被关闭');
  await runtime.shutdown();

  assert.deepEqual(await requestWorkFocus(root, { word: 'status' }), { kind: 'absent' });
});

// The two halves of "history is not state", asserted together because each one alone is satisfiable
// by the wrong implementation. A plugin that restored the set from the store would fail the first
// assertion; a plugin that wrote nothing, or wrote somewhere that did not survive, would fail the
// second. Only both at once says what this slice decided: the facts are durable, and they are not
// this plugin's memory.
test('新的 Plugin 实例从空开始，而上一轮生命周期的事实仍然读得到', { skip: NO_PIPES }, async (t) => {
  const root = initializedRoot(t);

  const first = await compose(root);
  await declare(root, 'A');
  await declare(root, 'B');
  await first.shutdown();

  const second = await compose(root);
  try {
    const answer = await status(root);
    assert.equal(answer.outcome, 'ok');
    assert.deepEqual(answer.lines, [HEADER, NONE], '重启之后集合不是空的');

    // Written by a Runtime that no longer exists, read by a reader that never held the state.
    assert.deepEqual(factTypes(await readFacts(root)), [
      'work-focus.declared',
      'work-focus.declared',
    ]);
  } finally {
    await second.shutdown();
  }
});

test('端点绑定失败 → Plugin failed，而不是一个没有入口的 active', { skip: NO_PIPES }, async (t) => {
  const root = initializedRoot(t);
  const path = workFocusEndpointPath(root);

  // The operating system enforces one listener per pipe name, so this is what a squatted name looks
  // like from the plugin's side. It has nothing to fall back to: its whole capability is the ingress.
  const squatter = createServer();
  await new Promise((resolve) => squatter.listen(path, resolve));
  t.after(() => squatter.close());

  const runtime = new Runtime();
  try {
    await runtime.loadPlugin(continuityPlugin, { rootDir: root });
    await runtime.loadPlugin(chroniclePlugin, { rootDir: root });
    assert.equal(await runtime.loadPlugin(workFocusPlugin, { rootDir: root }), 'failed');
    assert.ok(runtime.getPluginError('work-focus') instanceof Error);
    // A plugin that never got past binding wrote nothing: the failure happened before any request
    // could arrive, and a fact about a request that was never served would be a fabrication.
    assert.deepEqual(await readFacts(root), []);
  } finally {
    await runtime.shutdown();
  }
});

test('config 非法 → 加载即抛出，Runtime 里没有留下这个插件的记录', { skip: NO_PIPES }, async () => {
  const runtime = new Runtime();
  try {
    for (const config of [undefined, null, {}, { rootDir: '' }, { rootDir: '  ' }, { rootDir: 7 }]) {
      await assert.rejects(
        () => runtime.loadPlugin(workFocusPlugin, config),
        (error) => error instanceof Error,
        `非法 config 被接受了：${JSON.stringify(config)}`,
      );
      // A rejection before the record exists is not the same as a plugin in `failed` state, and the
      // difference is what tells a caller nothing was started at all.
      assert.equal(runtime.getPluginState('work-focus'), undefined);
    }
  } finally {
    await runtime.shutdown();
  }
});

test('没有入口时的措辞不假装知道是"没有常驻"，建议也是条件式的', { skip: NO_PIPES }, async (t) => {
  const root = createRoot(t);
  const answer = await requestWorkFocus(root, { word: 'status' });
  assert.deepEqual(answer, { kind: 'absent' });

  const lines = focusFailureLines(answer);
  // The endpoint belongs to a plugin and cannot outlive its activation, so ENOENT here means "no
  // process" or "a resident that is stopping right now", and every line has to be true under both.
  //
  // Asserted on meaning, not wording. The first version of this test pinned only that the control
  // channel's exact sentence was not reused — which a different sentence that still told the human
  // "no resident is running" satisfied perfectly. It did: measured against the production resident
  // 287ms into a `hikari stop`, this client said there was no resident while the control channel was
  // reporting `Hikari 常驻正在停止。`, and the remedy it offered was refused by the same product with
  // `数据目录已被另一个 Hikari 常驻占用` inside that same window.
  assert.ok(!/没有正在运行/.test(lines.join('\n')));
  assert.match(lines[0], /没有正在提供工作焦点入口/);
  assert.match(lines[1], /若常驻尚未启动/);
  assert.match(lines[1], /正在启动或停止/);
  assert.match(lines[1], /hikari resident --data-dir <path>/);
});

test('端点接了连接却不作答 → unavailable，而不是 absent', { skip: NO_PIPES }, async (t) => {
  const root = createRoot(t);
  const path = workFocusEndpointPath(root);

  // The shape of a broken or squatted endpoint: something is listening, so ENOENT never happens, and
  // it never answers. Reporting this as "no resident" would send a human off to start a resident
  // while the thing they cannot talk to is sitting right there — the one confusion this file's three
  // failure kinds exist to prevent.
  const silent = createServer((socket) => socket.destroy());
  await new Promise((resolve) => silent.listen(path, resolve));
  t.after(() => silent.close());

  const answer = await requestWorkFocus(root, { word: 'status' });
  assert.equal(answer.kind, 'unavailable');
  assert.match(focusFailureLines(answer)[0], /无法访问 Hikari 工作焦点入口/);
});

test('客户端说了一半就消失：不拖住端点，也不影响下一个请求', { skip: NO_PIPES }, async (t) => {
  await withPlugin(t, async ({ root }) => {
    const path = workFocusEndpointPath(root);
    assert.ok(path, '这个测试需要一条真实的端点路径');
    await declare(root, '还在');

    // Half a request, then gone. The line never terminates, so the endpoint is mid-frame when the
    // peer vanishes — and the thing that must not happen is the obvious one: a request that was never
    // completed being answered anyway, or the connection staying in the set and making the plugin's
    // unload wait on a peer that already left.
    const abandoned = connect(path);
    await new Promise((resolve) => abandoned.on('connect', resolve));
    abandoned.write('{"version":1,"request":{"word":"clear"');
    abandoned.destroy();

    // The endpoint is still the same endpoint, and the half-said `clear` did not happen.
    assert.deepEqual(designationsOf(await status(root)), ['还在']);
  });
});

test('工作焦点插件不占用控制通道的端点', { skip: NO_PIPES }, async (t) => {
  await withPlugin(t, async ({ root }) => {
    // The Resident's control surface is not this plugin's to speak through, and the proof that it
    // has not is that the control endpoint is exactly as unreachable as it was before.
    assert.deepEqual(await requestControl(root, 'status'), { kind: 'absent' });
  });
});

// ---------------------------------------------------------------------------------------------
// Real processes: the vertical slice as a human runs it.
// ---------------------------------------------------------------------------------------------

test('真实进程：declare / status / replace / clear 通过 CLI 走完整条链路', { skip: NO_PIPES }, async (t) => {
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

  const empty = runCli('focus', 'status', '--data-dir', root);
  assert.equal(empty.code, 0);
  assert.equal(empty.stderr, '');
  assert.equal(empty.stdout, `${HEADER}\n${NONE}\n`);

  const declared = runCli('focus', 'declare', '--data-dir', root, 't1mb2rg/hikari-new');
  assert.equal(declared.code, 0);
  assert.equal(declared.stderr, '');
  assert.equal(declared.stdout, `${HEADER}\nt1mb2rg/hikari-new\n`);

  // The store is in the resident, not in the command: a second process, started afterwards, reads
  // back what the first one wrote. This is the whole of what makes it a state rather than an echo.
  const readBack = runCli('focus', 'status', '--data-dir', root);
  assert.equal(readBack.code, 0);
  assert.equal(readBack.stdout, `${HEADER}\nt1mb2rg/hikari-new\n`);

  const replaced = runCli('focus', 'replace', '--data-dir', root, 'DesktopAgent', 'hikari-new');
  assert.equal(replaced.code, 0);
  const replacedLines = replaced.stdout.trimEnd().split('\n');
  assert.equal(replacedLines[0], HEADER);
  assert.deepEqual(new Set(replacedLines.slice(1)), new Set(['DesktopAgent', 'hikari-new']));
  assert.equal(replacedLines.length, 3);

  const cleared = runCli('focus', 'clear', '--data-dir', root);
  assert.equal(cleared.code, 0);
  assert.equal(cleared.stdout, `${HEADER}\n${NONE}\n`);

  // A refused request is Hikari answering, so the reason goes out on stderr and the exit code
  // follows what Hikari said rather than which word asked.
  const refused = runCli('focus', 'declare', '--data-dir', root, '   ');
  assert.equal(refused.code, 1);
  assert.equal(refused.stdout, '');
  assert.match(refused.stderr, /空白/);

  // Grammar is the CLI's own question and it is answered without opening a pipe at all.
  const wrongArity = runCli('focus', 'declare', '--data-dir', root);
  assert.equal(wrongArity.code, 2);
  assert.match(wrongArity.stderr, /恰好一个工作焦点/);

  const wrongWord = runCli('focus', 'erase', '--data-dir', root);
  assert.equal(wrongWord.code, 2);
  assert.match(wrongWord.stderr, /declare \/ replace \/ clear \/ status/);

  assert.equal(runCli('stop', '--data-dir', root).code, 0);
  const code = await within(exited, 30_000, 'stop 之后常驻进程没有退出');
  assert.equal(code, 0);

  // The store, read after the resident is gone. The three writes above went through two real processes
  // and a real pipe, and this is what reached the disk — so the claim being pinned is the whole chain
  // (CLI → resident → endpoint → session → Chronicle) and not two halves of it. Without this the file
  // would prove the chain reaches the socket here, and reaches the store in an in-process Runtime
  // above, and would never join the two.
  //
  // Filtered to this plugin's own family rather than counted outright: the claim is that these three
  // transitions admitted these three facts, and a future slice that writes facts of its own should not
  // turn this test red for a reason that has nothing to do with the work focus.
  const admitted = (await readFacts(root)).filter((fact) => fact.type.startsWith('work-focus.'));
  assert.deepEqual(factTypes(admitted), [
    'work-focus.declared',
    'work-focus.replaced',
    'work-focus.cleared',
  ]);
  // Exact where the contract is exact, and silent where it is not: order is not part of what a set of
  // designations promises, so the `replaced` payload is compared as members — the same way the reply
  // above is read, and for the same reason.
  assert.deepEqual(admitted[0].payload, { designation: 't1mb2rg/hikari-new' });
  assert.deepEqual(new Set(admitted[1].payload.designations), new Set(['DesktopAgent', 'hikari-new']));
  assert.deepEqual(admitted[2].payload, {});

  // And the endpoint went with the process: the same question now gets a different, equally true
  // answer instead of a failed command. The line claims only that nothing is serving this ingress —
  // not that no resident exists, which this client is in no position to say, since a resident still
  // stopping looks exactly like this from here. The remedy is conditional for the same reason.
  const after = runCli('focus', 'status', '--data-dir', root);
  assert.equal(after.code, 1);
  assert.equal(after.stdout, '');
  assert.match(after.stderr, /没有正在提供工作焦点入口/);
  assert.ok(!/没有正在运行/.test(after.stderr));
  assert.match(after.stderr, /若常驻尚未启动/);
  assert.match(after.stderr, /hikari resident --data-dir <path>/);
});

function runCli(...args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  assert.equal(result.error, undefined);
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}
