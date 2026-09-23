import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

// Internal on purpose, and taken from the module rather than from the barrel for the reason
// `github-ci-github.test.mjs` gives: the seam these tests exercise is not configuration. What is being
// pinned here is a wire shape and a credential boundary — what bytes leave this process and which of
// them the secret is in — and that is not a fact about the plugin's public surface.
import { createHttpModel, readModelCredential } from '../dist/language/model.js';

const CANARY = 'canary-credential-that-must-not-travel';

// A frozen tool list, written here rather than taken from `LANGUAGE_EXPOSURES`, because what this file
// checks is that the transport passes its caller's list through — not that the caller's list is right.
// `language.test.mjs` owns the second question.
const TOOLS = Object.freeze([
  Object.freeze({
    type: 'function',
    function: Object.freeze({
      name: 'desktop_context.read',
      description: '读取桌面当前状态。',
      parameters: Object.freeze({
        type: 'object',
        properties: Object.freeze({}),
        additionalProperties: false,
      }),
    }),
  }),
]);

/** A first-turn request: the system prompt and the human's sentence. */
const REQUEST = Object.freeze({
  messages: Object.freeze([
    Object.freeze({ role: 'system', content: '系统提示：你不知道这台机器上发生了什么。' }),
    Object.freeze({ role: 'user', content: '光，你现在看到什么？' }),
  ]),
  tools: TOOLS,
});

/**
 * A second-turn request: the same conversation with one round of tool use already behind it.
 *
 * This is the shape the endpoint actually has to accept, and the one an OpenAI-compatible API rejects
 * outright if it is wrong — every `tool_call_id` in an assistant message must be answered by a tool
 * message. Writing it down here is what makes "the echo is the wire's own" checkable rather than
 * asserted.
 */
const TOOL_REQUEST = Object.freeze({
  messages: Object.freeze([
    Object.freeze({ role: 'system', content: '系统提示：你不知道这台机器上发生了什么。' }),
    Object.freeze({ role: 'user', content: '我现在在干嘛？' }),
    Object.freeze({
      role: 'assistant',
      toolCalls: Object.freeze([
        Object.freeze({ id: 'call_1', name: 'work_focus.read', arguments: '' }),
        Object.freeze({ id: 'call_2', name: 'desktop_context.read', arguments: '{}' }),
      ]),
    }),
    Object.freeze({ role: 'tool', toolCallId: 'call_1', content: '你当前明确关注：\n  hikari-new' }),
    Object.freeze({ role: 'tool', toolCallId: 'call_2', content: '判词：stable' }),
  ]),
  tools: TOOLS,
});

/** One model response, as the wire carries it. */
function reply(message, finishReason) {
  const choice = { message };
  if (finishReason !== undefined) choice.finish_reason = finishReason;
  return JSON.stringify({ choices: [choice] });
}

/** An ordinary conversational answer, which is what a model returns when it decides not to read. */
function ok(_record, response) {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(reply({ role: 'assistant', content: '在的。' }));
}

/**
 * A real HTTP server on the loopback interface, so that what is asserted is what actually left the
 * process — a request recorded by a stubbed `fetch` would be a recording of this test's own idea of
 * the wire, which is the thing under test.
 */
async function startServer(t, respond) {
  const seen = [];
  const server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      const record = { url: request.url, headers: request.headers, body };
      seen.push(record);
      respond(record, response);
    });
  });

  await new Promise((settle) => server.listen(0, '127.0.0.1', settle));
  t.after(() => {
    // A request that was deliberately left hanging still holds a socket; without this the close below
    // would wait for it and the suite would end on the timeout rather than on the test.
    server.closeAllConnections();
    return new Promise((settle) => server.close(settle));
  });

  const { port } = server.address();
  return { endpoint: `http://127.0.0.1:${port}/v1/chat/completions`, seen };
}

/**
 * An address on the loopback interface that nothing is listening on.
 *
 * Bound and released rather than guessed at, so that the test says "a real address with no server"
 * rather than "a port number that is probably free on this machine".
 */
async function unusedEndpoint() {
  const probe = createServer();
  await new Promise((settle) => probe.listen(0, '127.0.0.1', settle));
  const { port } = probe.address();
  await new Promise((settle) => probe.close(settle));
  return `http://127.0.0.1:${port}/v1/chat/completions`;
}

/** One model connected to a throwaway server, torn down with the test. */
function connected(t, endpoint, credential) {
  const model = createHttpModel({ endpoint, model: 'local-model', credential });
  t.after(() => model.dispose());
  return model;
}

test('模型请求是一条 OpenAI 兼容的 chat completion，工具表原样带上', async (t) => {
  const { endpoint, seen } = await startServer(t, ok);
  const model = connected(t, endpoint, undefined);

  const step = await model.step(REQUEST);

  assert.equal(step.content, '在的。', '返回的是模型的原文，不做解释');
  assert.deepEqual(step.toolCalls, []);
  assert.equal(step.truncated, false);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, '/v1/chat/completions', '端点地址原样使用，不加查询参数');

  const body = JSON.parse(seen[0].body);
  assert.equal(body.model, 'local-model');
  assert.deepEqual(body.messages, [
    { role: 'system', content: '系统提示：你不知道这台机器上发生了什么。' },
    { role: 'user', content: '光，你现在看到什么？' },
  ]);
  // The tool list travels by reference from the caller. The transport writes no description of its own
  // and adds no entry: a capability a model may name is a fact about the caller's list, and a second
  // list here would be a second place that fact could be wrong.
  assert.deepEqual(body.tools, JSON.parse(JSON.stringify(TOOLS)));
  // Named rather than left to the endpoint's default. `auto` is what the default is when tools are
  // present; saying it makes "the model may talk instead of reading" a sentence in the request rather
  // than an assumption about somebody else's default.
  assert.equal(body.tool_choice, 'auto');
  // Temperature zero because this is a lookup and not a piece of writing, exactly as it was when the
  // request asked for one word: the same question should read the same things.
  assert.equal(body.temperature, 0);
  // A conversational reply is the only thing this ceiling has to fit. It was 16 when the reply was a
  // single word from a closed set; a loop that lets a model talk needs room for a sentence or two, and
  // a ceiling that cut conversations off mid-word would be a bug the operator sees and nobody owns.
  assert.equal(body.max_tokens, 512);
  // The whole body, as a closed set. This is where a second protocol would show up — a `response_format`
  // asking for JSON, a legacy `functions` array, a marker the prompt expects the model to write — and
  // every one of those was refused rather than built. The transport speaks one dialect and this asserts
  // there is nothing else in the envelope.
  assert.deepEqual(Object.keys(body).sort(), [
    'max_tokens',
    'messages',
    'model',
    'temperature',
    'tool_choice',
    'tools',
  ]);
});

test('助手消息回到线上时带 tool_calls 且 content 是 null，工具结果用 tool_call_id 对上', async (t) => {
  const { endpoint, seen } = await startServer(t, ok);
  const model = connected(t, endpoint, undefined);

  await model.step(TOOL_REQUEST);

  const body = JSON.parse(seen[0].body);
  assert.deepEqual(body.messages, [
    { role: 'system', content: '系统提示：你不知道这台机器上发生了什么。' },
    { role: 'user', content: '我现在在干嘛？' },
    {
      role: 'assistant',
      // `null` and not `''`. The model produced no prose on that step — its content was ignored, so
      // echoing an empty string would be claiming it said nothing, and echoing the prose it did write
      // would tell it a human saw something nobody did. `null` is true.
      content: null,
      tool_calls: [
        { id: 'call_1', type: 'function', function: { name: 'work_focus.read', arguments: '' } },
        { id: 'call_2', type: 'function', function: { name: 'desktop_context.read', arguments: '{}' } },
      ],
    },
    { role: 'tool', tool_call_id: 'call_1', content: '你当前明确关注：\n  hikari-new' },
    { role: 'tool', tool_call_id: 'call_2', content: '判词：stable' },
  ]);
  // Every id named by the assistant message has a tool message after it, in the same array. The
  // endpoint rejects the request outright otherwise, so this is the invariant that makes a second turn
  // possible at all — and it is asserted here against the bytes rather than against the loop's intent.
  const answered = body.messages.filter((message) => message.role === 'tool').map((m) => m.tool_call_id);
  assert.deepEqual(answered, ['call_1', 'call_2']);
});

test('模型返回的 tool_calls 被解析出来，arguments 原样是字符串', async (t) => {
  const { endpoint } = await startServer(t, (_record, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      reply({
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_a', type: 'function', function: { name: 'work_focus.read', arguments: '' } },
          { id: 'call_b', type: 'function', function: { name: 'desktop_context.read', arguments: '{"n":1}' } },
        ],
      }),
    );
  });
  const model = connected(t, endpoint, undefined);

  const step = await model.step(REQUEST);

  assert.equal(step.content, '');
  assert.deepEqual(step.toolCalls, [
    { id: 'call_a', name: 'work_focus.read', arguments: '' },
    { id: 'call_b', name: 'desktop_context.read', arguments: '{"n":1}' },
  ]);
  // The arguments are not parsed here, and that is the split this test pins: whether a string means a
  // legal call is a question about capabilities, and `tools.ts` owns it. A transport that parsed would
  // turn a malformed blob into a transport failure, and the human would be told the endpoint was broken
  // when the model had simply asked for something this build does not do.
  assert.equal(typeof step.toolCalls[1].arguments, 'string');
});

test('content 为 null 时读作「这次没有文字」，而不是失败', async (t) => {
  const { endpoint } = await startServer(t, (_record, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      reply({
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call_a', type: 'function', function: { name: 'work_focus.read' } }],
      }),
    );
  });
  const model = connected(t, endpoint, undefined);

  const step = await model.step(REQUEST);

  // An assistant turn that is nothing but tool calls genuinely has no text, so `null` is what the wire
  // carries for it. An omitted `arguments` is likewise read as the empty string.
  assert.equal(step.content, '');
  assert.deepEqual(step.toolCalls, [{ id: 'call_a', name: 'work_focus.read', arguments: '' }]);
});

test('finish_reason = length 被记下来，而不是被解释', async (t) => {
  const { endpoint } = await startServer(t, (_record, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(reply({ role: 'assistant', content: '这个嘛，我想想，其实是' }, 'length'));
  });
  const model = connected(t, endpoint, undefined);

  const step = await model.step(REQUEST);

  // Carried, not acted on. The transport has no opinion about what a truncated reply means; the loop
  // does, and it can only decide if it is told.
  assert.equal(step.truncated, true);
  assert.equal(step.content, '这个嘛，我想想，其实是');
});

test('finish_reason 是别的值时不算截断', async (t) => {
  for (const reason of ['stop', undefined]) {
    const { endpoint } = await startServer(t, (_record, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(reply({ role: 'assistant', content: '在的。' }, reason));
    });
    const model = connected(t, endpoint, undefined);

    const step = await model.step(REQUEST);
    assert.equal(step.truncated, false, `finish_reason=${reason} 不该算截断`);
  }
});

test('凭据只出现在 Authorization 头里，不进地址也不进请求体', async (t) => {
  const { endpoint, seen } = await startServer(t, ok);
  const model = connected(t, endpoint, CANARY);

  await model.step(REQUEST);

  // The header is the one place it is meant to be, and this assertion is here so that "the secret
  // travels in a header" is a checked fact rather than a reading of `model.ts`.
  assert.equal(seen[0].headers.authorization, `Bearer ${CANARY}`);

  // Nowhere else. A query parameter would put the secret into every error message that ever mentions
  // an address, and a body is the part of a request that gets logged by whatever is in the middle.
  assert.ok(!seen[0].url.includes(CANARY), '地址里不得有凭据');
  assert.ok(!seen[0].body.includes(CANARY), '请求体里不得有凭据');
});

test('没有凭据时，请求里根本不存在 Authorization 头', async (t) => {
  const { endpoint, seen } = await startServer(t, ok);
  const model = connected(t, endpoint, undefined);

  await model.step(REQUEST);

  // Not an empty header, not `Bearer undefined` — a local endpoint that wants no credential is
  // reached by a request that has no such header at all.
  assert.equal(seen[0].headers.authorization, undefined);
});

test('端点返回错误状态时，错误只说状态码，不说响应体', async (t) => {
  const { endpoint } = await startServer(t, (_record, response) => {
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: `bad key ${CANARY}` } }));
  });
  const model = connected(t, endpoint, CANARY);

  const error = await model.step(REQUEST).then(
    () => undefined,
    (thrown) => thrown,
  );

  assert.ok(error instanceof Error);
  assert.ok(error.message.includes('401'), '应说明状态码');
  // The body of a failed response is written by the far end, and a body that echoed back what it
  // received would put the credential into an error message on its way to a human's terminal.
  assert.ok(!error.message.includes(CANARY), '错误里不得有凭据');
});

test('应答形状不是这一种时是失败，而不是一个空回答', async (t) => {
  // Everything here is a *structure* this build does not recognise. Whether a tool name means anything,
  // and whether its arguments are acceptable, are deliberately not in this list: those are refused
  // rather than failed, because they are questions about capabilities and not about the endpoint.
  const shapes = [
    '{}',
    '{"choices":[]}',
    '{"choices":"work-focus"}',
    '{"choices":[{"message":{"content":42}}]}',
    '{"choices":[{"message":"在的。"}]}',
    '{"choices":[{"message":{"content":"x","tool_calls":"nope"}}]}',
    '{"choices":[{"message":{"tool_calls":[{"function":{"name":"a"}}]}}]}',
    '{"choices":[{"message":{"tool_calls":[{"id":"1","function":{}}]}}]}',
    '{"choices":[{"message":{"tool_calls":[{"id":"","function":{"name":"a"}}]}}]}',
    '{"choices":[{"message":{"tool_calls":[{"id":"1","function":{"name":"a","arguments":42}}]}}]}',
    'null',
  ];

  for (const shape of shapes) {
    const { endpoint } = await startServer(t, (_record, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(shape);
    });
    const model = connected(t, endpoint, undefined);

    const error = await model.step(REQUEST).then(
      () => undefined,
      (thrown) => thrown,
    );

    // `''` would be a legitimate thing for a model to answer with, so substituting it for content that
    // was not found would turn a broken endpoint into a refusal and blame the human's sentence. A call
    // without an id is refused here rather than skipped for the same reason: the endpoint requires every
    // call in an assistant message to be answered, so a batch that cannot be completed is unreadable
    // rather than partially usable.
    assert.ok(error instanceof Error, `应失败：${shape}`);
    assert.ok(!(error instanceof TypeError), '应是这个插件自己的错误，不是解引用崩溃');
  }
});

test('同一个批里出现重复的 tool_call id 是失败', async (t) => {
  // The one malformed shape that is a property of the *batch* rather than of a single call, and the one
  // the loop can actually reach: two different fresh capabilities in one assistant message is exactly
  // the batch this build's two exposures make possible, and none of the per-call checks above notice
  // that their ids collide. Left unread, both reads succeed and the next request goes out carrying two
  // tool results keyed by the same id — which an endpoint that indexes results by id answers with a 400,
  // telling a human the endpoint was broken about a reading that had in fact worked.
  const { endpoint } = await startServer(t, (_record, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                { id: 'call_1', type: 'function', function: { name: 'work_focus.read', arguments: '' } },
                { id: 'call_1', type: 'function', function: { name: 'desktop_context.read', arguments: '' } },
              ],
            },
            finish_reason: 'stop',
          },
        ],
      }),
    );
  });
  const model = connected(t, endpoint, undefined);

  const error = await model.step(REQUEST).then(
    () => undefined,
    (thrown) => thrown,
  );

  assert.ok(error instanceof Error);
  assert.ok(error.message.includes('重复的 tool_call id'), '应说明是 id 重复，而不是别的形状问题');
});

test('应答不是 JSON 时是失败', async (t) => {
  const { endpoint } = await startServer(t, (_record, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('<html>gateway</html>');
  });
  const model = connected(t, endpoint, undefined);

  const error = await model.step(REQUEST).then(
    () => undefined,
    (thrown) => thrown,
  );

  assert.ok(error instanceof Error);
  assert.ok(!error.message.includes('<html>'), '错误里不得有对端的响应体');
});

test('端点不可达时是失败，且错误里没有凭据', async (t) => {
  const model = connected(t, await unusedEndpoint(), CANARY);

  const error = await model.step(REQUEST).then(
    () => undefined,
    (thrown) => thrown,
  );

  assert.ok(error instanceof Error);
  assert.ok(error.message.includes('模型端点没有应答'), '应说明是联系不上，而不是别的');
  // The credential goes into a header, so an error that names a host has not named the secret — which
  // is the reason it is a header, and this is where that reasoning is checked rather than asserted.
  assert.ok(!error.message.includes(CANARY));
});

test('dispose 之后，在飞的请求不会让拆解等一个模型', async (t) => {
  // A server that accepts the request and then says nothing at all: the only way out of this call is
  // the abort, which is what `dispose` is for. The plugin's endpoint has to be able to close while a
  // question is in flight, because the question has no one left to answer.
  const { endpoint } = await startServer(t, () => {});
  const model = createHttpModel({ endpoint, model: 'local-model', credential: undefined });

  const pending = model.step(REQUEST);
  model.dispose();

  const error = await pending.then(
    () => undefined,
    (thrown) => thrown,
  );
  assert.ok(error instanceof Error, '中断的请求应是失败，而不是一个回答');
});

// The guard that keeps the credential out of a failure message, and the hazard it closes is specific
// enough to state here — including which of its shapes are real, because the interesting part of this
// hazard is that it is narrower than it looks.
//
// A credential's one destination is the `Authorization` header, and when the HTTP layer refuses a
// header value it *quotes the value it refused*. Measured against `Headers.append`, and the three
// answers are not the same answer:
//
//   line break at the start, or in the middle   `Headers.append: "Bearer <whole secret>" is an
//                                               invalid header value` — the secret, verbatim, in a
//                                               message on its way to the terminal
//   line break at the end                       accepted, the break stripped as header whitespace
//   a non-ASCII byte                            accepted outright
//
// So the leaked shapes are the first row, and the guard has to refuse the other two rows anyway: what
// it is asking is not "would the transport reject this" but "is this a bearer token", and a class it
// can reason about completely is what makes the property hold without depending on a library's
// current opinion. The cost is a trailing newline — the shape a shell adds to `$(cat secret.txt)` —
// which would have worked and is now refused; that is a fail-closed refusal at startup with a message
// naming the variable, which is the posture the flags already take when the variable is missing.
//
// The rejection names the variable and never the value, not even the character that is wrong — a
// diagnostic pointing at the offending byte would be the leak it is reporting.
test('不能用作 HTTP 头值的凭据在读取处就被拒绝，且拒绝的话里没有凭据', () => {
  const envName = 'HIKARI_LANGUAGE_UNUSABLE_SECRET';
  // A NUL is deliberately absent from this list, and the reason is measured rather than assumed: the
  // environment cannot carry one. `process.env.X = 'a\0b'` stores `a`, because the value is held in a
  // NUL-terminated buffer — writing that case here produced a credential that had lost its tail and was
  // therefore perfectly usable. The guard still refuses a NUL for a caller that gets one from a
  // connection built by hand; the environment is simply not a way to hand it one.
  // The first two are the shapes that actually leak; the rest are the ones refused because the rule is
  // a class statement rather than a list of the transport's complaints. The distinction is in the
  // comment above and is deliberately not drawn in the assertions — every entry is refused, and a test
  // that only refused the leaking two would be pinning the transport's behaviour instead of the rule.
  const unusable = [
    `\n${CANARY}`,
    `${CANARY}\nX`,
    `${CANARY}\n`,
    `${CANARY}\r\n`,
    `${CANARY} `,
    ` ${CANARY}`,
    `café-${CANARY}`,
  ];

  for (const value of unusable) {
    process.env[envName] = value;
    try {
      assert.throws(
        () => readModelCredential(envName),
        (error) => {
          assert.ok(error.message.includes(envName), '应指出是哪个环境变量');
          assert.ok(!error.message.includes(CANARY), '拒绝的话里不得出现凭据');
          return true;
        },
        `应拒绝：${JSON.stringify(value)}`,
      );
    } finally {
      delete process.env[envName];
    }
  }

  // The complement is passed through untouched, so this is a refusal of what cannot be carried rather
  // than a normalization of what can. A credential is used exactly as the operator set it.
  process.env[envName] = CANARY;
  try {
    assert.equal(readModelCredential(envName), CANARY);
  } finally {
    delete process.env[envName];
  }
});

test('凭据变量：没指定就是没有，指定了就必须有值', async (t) => {
  const NAME = 'HIKARI_LANGUAGE_MODEL_CREDENTIAL_TEST';
  const previous = process.env[NAME];
  t.after(() => {
    if (previous === undefined) delete process.env[NAME];
    else process.env[NAME] = previous;
  });

  // No flag: no credential, and a local endpoint is reached this way.
  assert.equal(readModelCredential(undefined), undefined);

  // The flag names a variable and the variable is missing. Refused rather than treated as "no
  // credential": the operator said where the secret is, and a process that then spoke without one
  // would be ignoring a configuration it was handed, to fail later as an authentication error nobody
  // can connect to anything they typed.
  delete process.env[NAME];
  assert.throws(() => readModelCredential(NAME), /没有值/);

  process.env[NAME] = '';
  assert.throws(() => readModelCredential(NAME), /没有值/);

  process.env[NAME] = CANARY;
  assert.equal(readModelCredential(NAME), CANARY, '读的是值，不是变量名');
});
