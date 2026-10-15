// The wire, both ends of it, and the word that reaches them.
//
// What is tested here is the half of the executor that a human touches: the envelope that carries one
// sentence from `hikari act` to a running resident, and the endpoint that receives it. The deciding is
// tested next door; this file is about the trip.
//
// Two properties get most of the attention. The first is that the envelope is *strict*: a request whose
// field set is not exactly the one this protocol version names is unreadable rather than partly read, so
// a field added on one side and forgotten on the other is a loud failure instead of a silently ignored
// one. The second is that "no resident is listening" and "the listener answered badly" are different
// answers — the first is `absent` and is the ordinary state of a machine where nobody started a resident,
// and a caller that could not tell it from a real failure would report the wrong thing to the person.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  EXECUTOR_PROTOCOL,
  MAX_EXECUTOR_REQUEST_LINE,
  RepositoryChangeLineReader,
  decodeRepositoryChangeReply,
  decodeRepositoryChangeRequest,
  encodeRepositoryChangeReply,
  encodeRepositoryChangeRequest,
  listenRepositoryChangeEndpoint,
  repositoryChangeEndpointPath,
} from '../dist/repository-change-executor/index.js';
import { requestRepositoryChange } from '../dist/cli/act.js';

const REPOSITORY = 't1mb2rg/demo-repository';
const MANDATE = '把 README 里那句过时的话改掉，然后提交推上去。';

// The endpoint is a Windows named pipe, so every test that actually opens one is skipped elsewhere — the
// same guard the sibling endpoint suites use. What is *not* skipped is the half that runs everywhere: the
// envelopes, the line framing, and the client's answer when there is no pipe to connect to at all.
const NO_PIPES = process.platform === 'win32' ? false : '命名管道只在 Windows 上存在';

function dataDir() {
  return mkdtempSync(join(tmpdir(), 'hikari-act-'));
}

function requestLine(overrides = {}) {
  return encodeRepositoryChangeRequest({
    protocol: EXECUTOR_PROTOCOL,
    request: 'act',
    repository: REPOSITORY,
    mandate: MANDATE,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// 信封：逐字往返，字段集严格
// ---------------------------------------------------------------------------

test('信封：请求往返之后每个字都还在', () => {
  const decoded = decodeRepositoryChangeRequest(requestLine());

  assert.equal(decoded.kind, 'request');
  assert.equal(decoded.request.repository, REPOSITORY);
  assert.equal(decoded.request.mandate, MANDATE);
});

test('信封：多一个字段就不是这个协议的请求，而不是「多余的部分被忽略」', () => {
  const decoded = decodeRepositoryChangeRequest(
    JSON.stringify({
      protocol: EXECUTOR_PROTOCOL,
      request: 'act',
      repository: REPOSITORY,
      mandate: MANDATE,
      extra: true,
    }),
  );

  assert.equal(decoded.kind, 'refused');
});

test('信封：少一个字段同样读不懂', () => {
  const decoded = decodeRepositoryChangeRequest(
    JSON.stringify({ protocol: EXECUTOR_PROTOCOL, request: 'act', repository: REPOSITORY }),
  );

  assert.equal(decoded.kind, 'refused');
});

test('信封：协议字符串不同就是读不懂，而不是尽量兼容', () => {
  const decoded = decodeRepositoryChangeRequest(
    JSON.stringify({ protocol: 'repository-change-executor.act@2', request: 'act', repository: REPOSITORY, mandate: MANDATE }),
  );

  assert.equal(decoded.kind, 'refused');
});

test('信封：不是 JSON 对象的行读不懂', () => {
  // Two words, and the difference is which end is talking. A request that does not decode is `refused` —
  // the word belongs to the sender and the endpoint has not been asked anything yet. A reply that does not
  // decode is `unreadable` — the question was asked and this is the answer failing to be one.
  assert.equal(decodeRepositoryChangeRequest('不是 JSON').kind, 'refused');
  assert.equal(decodeRepositoryChangeRequest('[]').kind, 'refused');
  assert.equal(decodeRepositoryChangeReply('').kind, 'unreadable');
});

test('信封：应答的两个结果都能往返，第三个结果不存在', () => {
  const ok = decodeRepositoryChangeReply(
    encodeRepositoryChangeReply({ protocol: EXECUTOR_PROTOCOL, outcome: 'ok', lines: ['改了', '推了'] }),
  );
  assert.equal(ok.kind, 'reply');
  assert.deepEqual(ok.lines, ['改了', '推了']);

  const failed = decodeRepositoryChangeReply(
    encodeRepositoryChangeReply({ protocol: EXECUTOR_PROTOCOL, outcome: 'failed', lines: ['没有改动'] }),
  );
  assert.equal(failed.kind, 'reply');
  assert.equal(failed.outcome, 'failed');

  const unknownOutcome = decodeRepositoryChangeReply(
    JSON.stringify({ protocol: EXECUTOR_PROTOCOL, outcome: 'maybe', lines: [] }),
  );
  assert.equal(unknownOutcome.kind, 'unreadable');
});

// ---------------------------------------------------------------------------
// 行框定：一行就是一个完整的东西，太长的行不会把它撕裂
// ---------------------------------------------------------------------------

test('行框定：没有换行时什么都不算读到', () => {
  const reader = new RepositoryChangeLineReader(MAX_EXECUTOR_REQUEST_LINE);

  assert.deepEqual(reader.push('{"protocol":'), { kind: 'pending' });
  assert.deepEqual(reader.push('"x"}'), { kind: 'pending' });

  const line = reader.push('\n');
  assert.deepEqual(line, { kind: 'line', line: '{"protocol":"x"}' });
});

test('行框定：超长的行断开的是这一次读取，不是一个被截断的请求', () => {
  const reader = new RepositoryChangeLineReader(MAX_EXECUTOR_REQUEST_LINE);
  const tooLong = 'x'.repeat(MAX_EXECUTOR_REQUEST_LINE + 1);

  assert.deepEqual(reader.push(tooLong), { kind: 'overflow' });

  // Once it has overflowed it stays overflowed rather than half-filled: there is no version of this reader
  // in which the tail of a line it already refused becomes a shorter, valid one.
  assert.deepEqual(reader.push('\n'), { kind: 'overflow' });

  // A refused line ends one read, not the wire: the next line through a fresh reader is read normally.
  const fresh = new RepositoryChangeLineReader(MAX_EXECUTOR_REQUEST_LINE);
  assert.deepEqual(fresh.push(`${requestLine()}\n`), { kind: 'line', line: requestLine().trimEnd() });
});

// ---------------------------------------------------------------------------
// 两端：一个真的常驻，一个真的问题
// ---------------------------------------------------------------------------

test('端点：人问一句，常驻答一句，句子逐字回来', { skip: NO_PIPES }, async () => {
  const dir = dataDir();
  const endpoint = await listenRepositoryChangeEndpoint(
    {
      handle: async (request) => ({
        protocol: EXECUTOR_PROTOCOL,
        outcome: 'failed',
        lines: [`收到的是：${request.mandate}`],
      }),
    },
    repositoryChangeEndpointPath(dir),
  );

  try {
    const answer = await requestRepositoryChange(dir, REPOSITORY, MANDATE);

    assert.equal(answer.kind, 'answered');
    assert.equal(answer.outcome, 'failed');
    assert.deepEqual(answer.lines, [`收到的是：${MANDATE}`]);
  } finally {
    endpoint.close();
  }
});

test('端点：没有常驻在听是 absent，不是失败', { skip: NO_PIPES }, async () => {
  const answer = await requestRepositoryChange(dataDir(), REPOSITORY, MANDATE);

  assert.equal(answer.kind, 'absent');
});

test('端点：关掉之后就不再有人应答，且答案与「从来没起过」一样', { skip: NO_PIPES }, async () => {
  const dir = dataDir();
  const endpoint = await listenRepositoryChangeEndpoint(
    { handle: async () => ({ protocol: EXECUTOR_PROTOCOL, outcome: 'ok', lines: ['ok'] }) },
    repositoryChangeEndpointPath(dir),
  );

  const before = await requestRepositoryChange(dir, REPOSITORY, MANDATE);
  assert.equal(before.kind, 'answered');

  endpoint.close();

  const after = await requestRepositoryChange(dir, REPOSITORY, MANDATE);
  assert.equal(after.kind, 'absent');
});

test('端点：宿主自己在处理时炸了，这次对话结束，而不是替它编一句失败', { skip: NO_PIPES }, async () => {
  const dir = dataDir();
  const endpoint = await listenRepositoryChangeEndpoint(
    {
      handle: async () => {
        throw new Error('宿主的内部错误');
      },
    },
    repositoryChangeEndpointPath(dir),
  );

  try {
    const answer = await requestRepositoryChange(dir, REPOSITORY, MANDATE);

    // Deliberate, and the reason is in `endpoint.ts`: it owns framing, not meanings. A reply here would be
    // this file inventing a failure in the host's voice, so a broken promise closes the connection instead.
    // The question then reaches the person as `unavailable` — which is true: no answer arrived.
    assert.equal(answer.kind, 'unavailable');
  } finally {
    endpoint.close();
  }
});

// ---------------------------------------------------------------------------
// 管道名：同一个数据目录永远是同一个名字，不同目录不是
// ---------------------------------------------------------------------------

test('管道名：由数据目录的规范路径决定，不含用户的目录名', { skip: NO_PIPES }, () => {
  const first = repositoryChangeEndpointPath(dataDir());
  const second = repositoryChangeEndpointPath(dataDir());

  assert.equal(typeof first, 'string');
  assert.notEqual(first, second);
  assert.ok(first.startsWith('\\\\.\\pipe\\hikari-repository-change-'));
  assert.ok(!first.includes(tmpdir().toLowerCase()), '管道名里没有原样的目录');
});
