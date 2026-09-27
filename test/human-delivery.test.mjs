import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { subscribeToHumanDelivery } from '../dist/cli/subscribe.js';
import { Runtime } from '../dist/index.js';
import {
  DeliveryLineReader,
  HumanDeliveryError,
  MAX_DELIVERY_MESSAGE_LINE,
  decodeDelivery,
  encodeDelivery,
  humanDeliveryEndpointPath,
  humanDeliveryPlugin,
  humanDeliveryService,
  listenDeliveryEndpoint,
} from '../dist/human-delivery/index.js';

// Two halves in one file, and the split is the one `language.test.mjs` describes — with a third part
// this repository has not had before.
//
// The framing and the reader are pure, and they run everywhere: `encodeDelivery`/`decodeDelivery` are a
// round trip over a string, and the reader is a state machine over chunks. CI checks both on
// `ubuntu-latest`.
//
// The endpoint's *behaviour* is the second part, and it also runs everywhere — because `net` on a POSIX
// host is the same module with the same three-valued contract, it simply listens on a filesystem path
// instead of a pipe name. So "nobody connected is `unavailable`", "a second client is refused while the
// first is kept", "a client that stops reading ends as `failed` rather than never", "transport trouble
// is a value and never a throw" and "close really closes" are all checked in CI rather than only on the
// one machine the product ships to.
//
// The derivation is the exception, and saying so precisely is the point of this paragraph. On POSIX
// `humanDeliveryEndpointPath` returns `undefined` and computes no hash at all, so the only half of it CI
// can check is the negative one — that a host with no pipe namespace is given no endpoint name. The
// pattern, the case folding and the separators are Windows' and are asserted on Windows.
//
// The third part is the one that needs the real thing, and it is skipped rather than approximated — but
// the set of what lives there is wider than "an end-to-end delivery", and a CI count would otherwise
// imply more coverage than there is. Everything that goes through the *Service* is Windows-only, because
// `plugin.ts` refuses at its platform gate before `context.services.provide` is reached: so the
// `deliver` delegation itself, "loaded with no client and still active", and a human running
// `hikari subscribe` receiving a message Hikari decided to send are all in that set. On Linux this
// plugin can only ever be observed as `failed`. Those claims are reported separately from a green CI
// run, and this file says so rather than letting a test count stand in for them.

const WINDOWS = process.platform === 'win32';
const NO_PIPES = WINDOWS ? false : '命名管道只在 Windows 上存在';

const CLI = join(import.meta.dirname, '..', 'dist', 'cli', 'main.js');

function createRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'hikari-delivery-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

// A path this process may listen on, on either platform. On Windows it is the derivation under test; on
// POSIX it is an ordinary filesystem path, which is what makes the behavioural half of this file
// runnable in CI rather than only on the product's own host.
let socketCounter = 0;
function endpointPath(root) {
  if (WINDOWS) return humanDeliveryEndpointPath(root);
  socketCounter += 1;
  return join(root, `delivery-${socketCounter}.sock`);
}

// The client's `connect` fires when the operating system has completed the handshake; the server's
// `connection` event fires when its own event loop gets to the accepted socket, which is a turn later.
// So "the client thinks it is connected" is not "the endpoint has a client", and a test that delivered
// on the strength of the former would be racing the accept rather than observing the transport.
//
// There is no `connected` query to ask instead — a connection is deliberately not a fact this transport
// reports — so the probe is the connection: `write` answering `delivered` is the only proof from outside,
// and it is the same proof the resident's decider has. The probe is a real message and therefore arrives
// first; every assertion about received bytes below accounts for it by name.
const PROBE = ['订阅已建立'];

async function awaitClient(endpoint) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if ((await endpoint.write(PROBE)).outcome === 'delivered') return;
    await nextTurn();
  }
  assert.fail('endpoint 上始终没有 client');
}

// The same instrument in the other direction. A client seeing its own close is not the endpoint having
// released the slot, and "a disconnected client frees the place" is a claim about the endpoint.
async function awaitNoClient(endpoint) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if ((await endpoint.write(PROBE)).outcome === 'unavailable') return;
    await nextTurn();
  }
  assert.fail('client 断开之后 endpoint 上始终还有人');
}

// A client that reads whatever arrives, as text, and says nothing. Used where a test is about the bytes
// on the wire rather than about what the subscriber makes of them — and used in preference to
// `subscribeToHumanDelivery`, which reports nothing at all until the connection ends.
function rawClient(path, t) {
  const socket = connect(path);
  const chunks = [];
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => chunks.push(chunk));
  socket.on('error', () => {});

  const client = {
    chunks,
    text: () => chunks.join(''),
    connected: new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    }),
    closed: new Promise((resolve) => socket.once('close', resolve)),
    destroy: () => socket.destroy(),
  };
  if (t) t.after(() => client.destroy());
  return client;
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function elapsed(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(condition, message, deadlineMs = 2000) {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > deadlineMs) assert.fail(message);
    await nextTurn();
  }
}

// Fails a promise that has not settled, so that a test about a delivery that should end a subscription
// reports the absence rather than hanging the file.
function settleWithin(promise, ms, message) {
  return Promise.race([
    promise,
    elapsed(ms).then(() => assert.fail(message)),
  ]);
}

// ---------------------------------------------------------------------------------------------
// The framing. One message, one line, and a rule about what an unreadable one is.
// ---------------------------------------------------------------------------------------------

test('一条消息是一行 JSON 数组，换行是帧而不是内容', () => {
  const lines = ['Repository CI attention：', '  运行：41', '  结论：failure'];

  const framed = encodeDelivery(lines);
  assert.equal(framed.endsWith('\n'), true, '帧尾必须有一个换行');
  assert.equal(framed.trimEnd().includes('\n'), false, '帧内不得再有换行');
  assert.deepEqual(decodeDelivery(framed.trimEnd()), lines);
});

test('一条消息里的换行、引号和空行都还能原样回来', () => {
  // The transport carries whatever an owner rendered, and it does not get to have an opinion about the
  // characters in it. The JSON framing is what makes that true; a transport that joined lines itself
  // would have met the boundary problem on the first multi-line message.
  const lines = ['a\nb', '"quoted"', '', '\\', '中文'];
  assert.deepEqual(decodeDelivery(encodeDelivery(lines).trimEnd()), lines);
});

test('读不出来的行是 undefined，而不是一条空消息', () => {
  // The distinction a client's wording depends on. A client that printed nothing for an unreadable
  // frame would be reporting that Hikari said nothing, when what happened is that something wrote to
  // this pipe without speaking this protocol.
  for (const line of ['', 'not json', '{"a":1}', '["a",1]', '[null]', '["a"] trailing', '"a"', '42', 'null']) {
    assert.equal(decodeDelivery(line), undefined, `${JSON.stringify(line)} 不该被读成一条消息`);
  }

  // And an empty message is a message: it decodes to zero lines, which is not the same value.
  assert.deepEqual(decodeDelivery('[]'), []);
});

test('读一行：半行是 pending，一行是 line，超过上限就 overflow', () => {
  const reader = new DeliveryLineReader(16);

  assert.deepEqual(reader.push('half'), { kind: 'pending' });
  assert.deepEqual(reader.push(' a line\n'), { kind: 'line', line: 'half a line' });

  // Once a line has been handed over, what follows it is the next line's problem: the reader holds the
  // remainder, not the whole buffer.
  assert.deepEqual(reader.push('next\nmore'), { kind: 'line', line: 'next' });
  assert.deepEqual(reader.push('\n'), { kind: 'line', line: 'more' });
});

test('上限是「这一行的长度」，不是「一个 chunk 的大小」', () => {
  const reader = new DeliveryLineReader(8);

  // Exactly at the limit is a line; one character past it is not. Asserted on both sides, because a
  // bound that was off by one in either direction would still look like a bound.
  assert.deepEqual(reader.push('12345678\n'), { kind: 'line', line: '12345678' });
  assert.deepEqual(reader.push('123456789\n'), { kind: 'overflow' });

  // And the accumulated partial line is what is bounded, so a far end that never sends a newline cannot
  // choose how much this process buffers.
  const patient = new DeliveryLineReader(8);
  assert.deepEqual(patient.push('1234'), { kind: 'pending' });
  assert.deepEqual(patient.push('5678'), { kind: 'pending' });
  assert.deepEqual(patient.push('9'), { kind: 'overflow' });
});

// ---------------------------------------------------------------------------------------------
// The derivation. What an endpoint is called, and what happens where there is no pipe namespace.
// ---------------------------------------------------------------------------------------------

test('入口名由数据目录推出；本机没有管道命名空间时就没有入口', (t) => {
  const root = createRoot(t);
  const path = humanDeliveryEndpointPath(root);

  if (!WINDOWS) {
    assert.equal(path, undefined, '没有命名管道的地方不得编出一个入口名');
    return;
  }

  assert.match(path, /^\\\\\.\\pipe\\hikari-human-delivery-[0-9a-f]{16}$/);
  assert.equal(humanDeliveryEndpointPath(root), path, '同一个目录必须推出同一个名字');
  assert.notEqual(humanDeliveryEndpointPath(join(root, 'other')), path, '不同目录不得共用入口');
});

// Skipped rather than returned-early, so the Linux report says `skipped` instead of `ok`. There is no
// POSIX branch to take here — `endpoint-path.ts` never lowercases or strips anything off a non-win32
// path, because it never gets that far — so a test that announced success on Linux would be announcing
// coverage of three assertions it did not run.
test('入口名只看目录本身，大小写与尾部分隔符都不算区别', { skip: NO_PIPES }, (t) => {
  const root = createRoot(t);
  const path = humanDeliveryEndpointPath(root);

  assert.equal(humanDeliveryEndpointPath(root.toUpperCase()), path);
  assert.equal(humanDeliveryEndpointPath(root.toLowerCase()), path);
  assert.equal(humanDeliveryEndpointPath(`${root}\\`), path, '尾部的分隔符不改变它指向谁');
});

// ---------------------------------------------------------------------------------------------
// The endpoint's behaviour. Runs on both platforms: a POSIX socket is the same `net` module with the
// same three-valued contract, so the semantics below are checked in CI rather than only on Windows.
// ---------------------------------------------------------------------------------------------

test('没有 client 的时候，一条消息的答案是 unavailable，不是错误', async (t) => {
  const root = createRoot(t);
  const endpoint = await listenDeliveryEndpoint(endpointPath(root));
  t.after(() => endpoint.close());

  // The ordinary evening. A human opens their listener when they want to be told things, and Hikari
  // noticing something while nobody is listening is not a fault — it is the case this transport exists
  // to be honest about.
  assert.deepEqual(await endpoint.write(['仓库变了']), { outcome: 'unavailable' });
  // No queue: the same message is not remembered for a client that arrives later.
  assert.deepEqual(await endpoint.write(['仓库变了']), { outcome: 'unavailable' });
});

test('client 连着的时候，写下去的字节就是那一行 JSON 数组和一个换行', async (t) => {
  const root = createRoot(t);
  const path = endpointPath(root);
  const endpoint = await listenDeliveryEndpoint(path);
  t.after(() => endpoint.close());

  const client = rawClient(path, t);
  await client.connected;
  await awaitClient(endpoint);

  const lines = ['Repository CI attention：', '  结论：failure'];
  assert.deepEqual(await endpoint.write(lines), { outcome: 'delivered' });

  await until(() => client.text().includes('failure'), '客户端没有收到任何东西');
  // The probe and then the message, adjacent and whole. Exact equality rather than a `includes`, because
  // the claim is not just that the right bytes arrived but that no others did — the transport frames
  // what it was handed and adds nothing of its own.
  assert.equal(client.text(), encodeDelivery(PROBE) + encodeDelivery(lines), '线上跑的只有这两个帧');
});

test('client 半路走了，写下去得到的是一个值而不是一个抛出去的错误', async (t) => {
  const root = createRoot(t);
  const path = endpointPath(root);
  const endpoint = await listenDeliveryEndpoint(path);
  t.after(() => endpoint.close());

  const client = rawClient(path, t);
  await client.connected;
  await awaitClient(endpoint);

  // A client was definitely connected, and then it goes away with no wait for the endpoint to notice —
  // so this write lands either before or after the close event, and which arm it takes is a race rather
  // than a contract. Both are answers this endpoint gives and neither is an exception, which is the
  // whole of what is asserted.
  //
  // What must not happen is a rejection. The caller is a decider on a cadence, and a transport failure
  // climbing into that loop is the coupling this contract exists to prevent.
  client.destroy();

  const outcome = await endpoint.write(['一条在 client 走之后才写的消息']);
  assert.ok(
    outcome.outcome === 'unavailable' || outcome.outcome === 'failed',
    `应当是两种诚实答案之一，收到 ${outcome.outcome}`,
  );
});

// The one peer this transport cannot get rid of by any rule of its own: it is not absent, it has not
// closed, and it is not a second client. It simply stops reading, the pipe fills, and the write
// callback — the thing `delivered` is defined by — never fires.
//
// Unbounded, that is not one slow delivery. The decider awaits this call before it reschedules, so a
// peer that stops reading stops Hikari looking at CI at all; and the activation never settles, so a
// shutdown waits on a write that will not finish. Bounded, it is one `failed` delivery and a cleared
// slot — which is the second half of what this test asserts, and the half that matters more.
test('client 不再读取时，投递以 failed 结束而不是永远不结束，位置也重新腾出来', async (t) => {
  const root = createRoot(t);
  const path = endpointPath(root);
  const endpoint = await listenDeliveryEndpoint(path);
  t.after(() => endpoint.close());

  // `rawClient` reads; this one deliberately does not. No 'data' handler and no `resume()`, so the
  // stream stays paused and whatever the operating system buffered is never drained.
  const silent = connect(path);
  silent.on('error', () => {});
  t.after(() => silent.destroy());
  await new Promise((resolve, reject) => {
    silent.once('connect', resolve);
    silent.once('error', reject);
  });
  await awaitClient(endpoint);

  // Frames close to the protocol's own maximum, so a handful of writes fills whatever the buffer is on
  // this platform. How many is a platform fact and is not asserted; reaching the guard below is.
  const payload = ['x'.repeat(60_000)];
  const startedAt = Date.now();
  let outcome = { outcome: 'delivered' };
  let writes = 0;
  while (outcome.outcome === 'delivered') {
    writes += 1;
    if (writes > 64) assert.fail('缓冲区始终没有被填满，这个测试没有测到它要测的东西');
    outcome = await settleWithin(
      endpoint.write(payload),
      20_000,
      'write 二十秒之后仍未 settle：一次投递没有上界，循环会因此停摆',
    );
  }

  assert.equal(outcome.outcome, 'failed', '有 client 但写不完，这是 transport 失败，不是「没有人」');
  // The bound is seconds wide and a timer cannot fire early, so this separates "the deadline ended it"
  // from "something else rejected it" without pinning the bound's exact value.
  assert.ok(Date.now() - startedAt >= 4000, '这次 failed 应当来自那道时间界');

  // Waited for rather than assumed. The slot clears on the socket's own close event, and a client that
  // arrived before that would be turned away as a second client rather than served.
  await awaitNoClient(endpoint);

  const second = rawClient(path, t);
  await second.connected;
  await awaitClient(endpoint);
  assert.deepEqual(await endpoint.write(['超时之后的话']), { outcome: 'delivered' });
  await until(() => second.text().includes('超时之后的话'), '超时之后重新连上的 client 没有收到消息');
});

test('主动断开的 client 会腾出位置：同一个入口可以重新连上', async (t) => {
  const root = createRoot(t);
  const path = endpointPath(root);
  const endpoint = await listenDeliveryEndpoint(path);
  t.after(() => endpoint.close());

  const first = rawClient(path, t);
  await first.connected;
  await awaitClient(endpoint);
  assert.deepEqual(await endpoint.write(['第一段']), { outcome: 'delivered' });

  // The slot really is clear, observed as the endpoint's own answer rather than inferred from the
  // client's close — otherwise this would be racing the close event instead of testing the reconnect.
  first.destroy();
  await awaitNoClient(endpoint);

  const second = rawClient(path, t);
  await second.connected;
  await awaitClient(endpoint);
  assert.deepEqual(await endpoint.write(['第二段']), { outcome: 'delivered' });
  await until(() => second.text().includes('第二段'), '重连之后没有收到消息');
});

test('第二个 client 被拒绝，而不是把第一个换掉', async (t) => {
  const root = createRoot(t);
  const path = endpointPath(root);
  const endpoint = await listenDeliveryEndpoint(path);
  t.after(() => endpoint.close());

  // The ruling says one client is enough, so "one" is enforced literally. Replacing would mean deciding
  // on no evidence that the newer client is the one the human meant, and it would make delivery depend
  // on the order two sockets happened to be accepted in.
  const first = rawClient(path, t);
  await first.connected;
  await awaitClient(endpoint);

  // Being refused is observed as the second connection ending, which is the refusal's own definition —
  // the endpoint destroys it rather than swapping it in. Waiting for that rather than for a fixed delay
  // is what makes the write below a statement about the first client instead of a race with the accept.
  const second = rawClient(path, t);
  await second.connected.catch(() => {});
  await settleWithin(second.closed, 2000, '第二个 client 没有被断开');
  await awaitClient(endpoint);

  assert.deepEqual(await endpoint.write(['给第一个']), { outcome: 'delivered' });
  await until(() => first.text().includes('给第一个'), '被保留的那个 client 没有收到消息');
  assert.equal(second.text(), '', '第二个 client 不得收到任何东西');
});

test('close 之后入口真的没有了，连都连不上', async (t) => {
  const root = createRoot(t);
  const path = endpointPath(root);
  const endpoint = await listenDeliveryEndpoint(path);

  await endpoint.close();
  await assert.rejects(
    () =>
      new Promise((resolve, reject) => {
        const socket = connect(path);
        socket.once('connect', () => {
          socket.destroy();
          resolve();
        });
        socket.once('error', reject);
      }),
  );

  // Idempotent, because a teardown may run more than once on a path that is failing elsewhere.
  await endpoint.close();
});

test('一个连接还开着的时候 close，也不会拖住', async (t) => {
  const root = createRoot(t);
  const path = endpointPath(root);
  const endpoint = await listenDeliveryEndpoint(path);

  const client = rawClient(path, t);
  await client.connected;

  // The await is the promise: an accepted socket that was only forgotten would still be an open handle,
  // and "closed" would then mean "closed to new connections" — which is not what `close` says. On
  // Windows this is also what keeps the process from staying alive on a handle nobody owns, which is why
  // both the listener and the accepted socket are `unref`ed.
  await settleWithin(endpoint.close(), 1000, 'close 没有在有连接时返回');
  await elapsed(20);
});

// ---------------------------------------------------------------------------------------------
// The plugin, in a real Runtime. Its activation is a platform fact and its availability is a socket
// fact, and these are the two questions that must not be answered by the same thing.
// ---------------------------------------------------------------------------------------------

test('宿主没有管道命名空间时，transport 拒绝启动而不是装作能投递', async (t) => {
  const root = createRoot(t);
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  const state = await runtime.loadPlugin(humanDeliveryPlugin, { rootDir: root });

  if (WINDOWS) {
    assert.equal(state, 'active');
    return;
  }

  // A misconfiguration, and a resident that came up anyway would be one that silently never told the
  // operator anything. The refusal is recorded where every other Windows-bound plugin's is.
  assert.equal(state, 'failed');
  const error = runtime.getPluginError('human-delivery');
  assert.ok(error instanceof HumanDeliveryError);
  assert.match(error.message, /命名管道/);
});

test('transport 没有任何 requires，所以有没有 client 都不是它的事', async (t) => {
  const root = createRoot(t);
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  // The structural half of `authorized ≠ connected`, and it is a fact about the declaration rather than
  // about a socket: readiness is decided by requirements, not by demand, so there is nothing here
  // through which a human's evening could become a composition failure.
  assert.deepEqual(humanDeliveryPlugin.requires, []);
  assert.deepEqual(humanDeliveryPlugin.provides, [humanDeliveryService]);

  const state = await runtime.loadPlugin(humanDeliveryPlugin, { rootDir: root });
  if (!WINDOWS) {
    // On POSIX the plugin fails for the other reason — the host — and that failure is about the machine
    // rather than about whether anyone is listening, which is the distinction being drawn.
    assert.equal(state, 'failed', '失败的原因是宿主，不是没人连着');
    assert.doesNotMatch(String(runtime.getPluginError('human-delivery')?.message), /client|订阅|连接/);
    return;
  }

  assert.equal(state, 'active', '没有 client 不影响激活');
});

test('config 非法 → 加载即抛出，Runtime 里没有留下这个插件的记录', async (t) => {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  for (const rootDir of [undefined, null, '', '   ', 42]) {
    await assert.rejects(
      () => runtime.loadPlugin(humanDeliveryPlugin, { rootDir }),
      /requires a non-empty rootDir/,
      `rootDir ${String(rootDir)} 应当被拒绝`,
    );
    assert.equal(runtime.getPluginState('human-delivery'), undefined);
  }
});

// ---------------------------------------------------------------------------------------------
// Windows only, from here down. A named pipe is what a resident opens and what `hikari subscribe`
// connects to, and none of what follows has a POSIX stand-in.
// ---------------------------------------------------------------------------------------------

// Reaches the delivery Service the way a consumer does: through a plugin of the test's own that declares
// it. There is no other road to a Service in this Runtime, which is the property being used — a test
// that reached into the registry directly would be testing storage rather than wiring.
async function reachDeliveryService(runtime) {
  let service;
  await runtime.loadPlugin({
    id: 'test.delivery-consumer',
    version: '1.0.0',
    requires: [humanDeliveryService],
    provides: [],
    setup(context) {
      service = context.services.get(humanDeliveryService);
    },
  });
  assert.notEqual(service, undefined, '声明了 requires 的插件应当拿得到这个 Service');
  return service;
}

// `awaitClient` is written against an endpoint, and a Service is not one; this is the same probe asked
// through the consumer-facing contract, which is the road the resident itself takes.
async function subscriptionConnected(service, received) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if ((await service.deliver(PROBE)).outcome === 'delivered') {
      await until(() => received.length >= 1, '探针没有到达订阅者');
      return;
    }
    await elapsed(10);
  }
  assert.fail('订阅者始终没有连上');
}

test('真实管道：一个订阅者真的收到了 Hikari 主动说出的那几行', { skip: NO_PIPES }, async (t) => {
  const root = createRoot(t);
  const runtime = new Runtime();
  await runtime.loadPlugin(humanDeliveryPlugin, { rootDir: root });
  const service = await reachDeliveryService(runtime);

  const received = [];
  const subscription = subscribeToHumanDelivery(root, (lines) => received.push(lines));
  await subscriptionConnected(service, received);

  const lines = ['Repository CI attention：', '  运行：41', '  结论：failure'];
  assert.deepEqual(await service.deliver(lines), { outcome: 'delivered' });
  await until(() => received.length >= 2, '订阅者没有收到消息');

  // Whole, and exactly as written, in order. The client does not join, filter or look inside, and the
  // transport adds nothing on the way — so what arrives is what the owner rendered, byte for byte.
  assert.deepEqual(received, [PROBE, lines]);

  // The subscription ends when the plugin does, and this is the other half of the same claim: a
  // subscriber is not left hanging on a pipe whose writer is gone.
  await runtime.shutdown();
  assert.deepEqual(await settleWithin(subscription, 2000, '常驻停止之后订阅没有结束'), { kind: 'ended' });
});

// Found by probe rather than by reading, and it is the one defect in this slice that a passing suite
// would not have shown. `DeliveryLineReader` hands over one line per call and keeps the remainder, so a
// chunk carrying two frames leaves the second one in the buffer. The subscriber used to call `push`
// once per chunk, which made it one message behind for the rest of the connection — and dropped the
// last message before the far end stopped entirely. Reproduced before the fix: one write carrying A and
// B delivered only A, and B surfaced when a later frame arrived.
test('真实管道：一次 read 里到达的两条投递，两条都交给订阅者', { skip: NO_PIPES }, async (t) => {
  const root = createRoot(t);

  // Our own server on the pipe name rather than `listenDeliveryEndpoint`, for one reason: the subject
  // here is what the *client* does with a chunk carrying two frames, and the endpoint writes exactly
  // one frame per `deliver`. Writing both into a single `write` reproduces a coalesced read on demand
  // instead of waiting for one.
  let peer;
  const server = createServer((socket) => {
    peer = socket;
  });
  await new Promise((resolve) => server.listen(endpointPath(root), resolve));
  t.after(async () => {
    peer?.destroy();
    await new Promise((resolve) => server.close(resolve));
  });

  const received = [];
  subscribeToHumanDelivery(root, (lines) => received.push(lines));

  await until(() => peer !== undefined, '订阅者没有连上来');

  peer.write(encodeDelivery(['A']) + encodeDelivery(['B']));
  await until(() => received.length >= 2, '一次 read 里的第二条投递没有交给订阅者');
  assert.deepEqual(received, [['A'], ['B']], '两条都要到，顺序也要对');
});

test('真实管道：没人订阅是 unavailable，连上之后同一个 Service 就送得出去', { skip: NO_PIPES }, async (t) => {
  const root = createRoot(t);
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());
  await runtime.loadPlugin(humanDeliveryPlugin, { rootDir: root });
  const service = await reachDeliveryService(runtime);

  assert.deepEqual(await service.deliver(['没人听']), { outcome: 'unavailable' });

  const received = [];
  const subscription = subscribeToHumanDelivery(root, (lines) => received.push(lines));
  await subscriptionConnected(service, received);

  assert.deepEqual(await service.deliver(['有人听了']), { outcome: 'delivered' });
  await until(() => received.length >= 2, '连上之后仍然没有收到');
  assert.deepEqual(received, [PROBE, ['有人听了']]);

  await runtime.shutdown();
  await subscription;
});

test('真实管道：数据目录上没有常驻时，订阅者是 absent', { skip: NO_PIPES }, async (t) => {
  const root = createRoot(t);

  // ENOENT is the one failure that is an answer rather than an error: nothing is serving this data
  // directory's delivery endpoint. Absence rather than a problem, and the ordinary state of a machine
  // where no resident was ever started.
  assert.deepEqual(await subscribeToHumanDelivery(root, () => {}), { kind: 'absent' });
});

test('真实管道：超过长度上限的一条投递，订阅者停下来并且说明原因', { skip: NO_PIPES }, async (t) => {
  const root = createRoot(t);
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());
  await runtime.loadPlugin(humanDeliveryPlugin, { rootDir: root });
  const service = await reachDeliveryService(runtime);

  const received = [];
  const subscription = subscribeToHumanDelivery(root, (lines) => received.push(lines));
  await subscriptionConnected(service, received);

  // Both ends take the bound from the same constant, so this is what the far end does with a message the
  // owner should never have produced. In CI the reader is exercised on the pure half above; here the
  // bound is what actually happens to a real client on a real pipe — and the honest response is to stop
  // and say so, because skipping the frame would leave a human believing they had seen everything.
  const oversized = ['x'.repeat(MAX_DELIVERY_MESSAGE_LINE + 1)];
  assert.deepEqual(await service.deliver(oversized), { outcome: 'delivered' });

  assert.deepEqual(await settleWithin(subscription, 2000, '超限的投递没有结束订阅'), {
    kind: 'unavailable',
    detail: '一个投递超过了长度上限。',
  });
  assert.deepEqual(received, [PROBE], '超限的那一条不得被当作消息交出去');
});

test('hikari subscribe：没有常驻时退出 1，并把两种可能都说出来', { skip: NO_PIPES }, async (t) => {
  const root = createRoot(t);

  const result = await runCli('subscribe', '--data-dir', root);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /没有正在投递的 Hikari 常驻/);
  // The remedy is a different command line for each of the two causes, which is why both are named
  // rather than the likelier one guessed at.
  assert.match(result.stderr, /hikari resident/);
  assert.match(result.stderr, /--proactive-ci-delay-ms/);
});

// Asynchronous, because the process under test is a listener: `spawnSync` would block this one, and the
// subscriber it starts has no exit of its own to wait for beyond the failure it is being asked about.
function runCli(...args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}
