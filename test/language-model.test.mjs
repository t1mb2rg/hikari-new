import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

// Internal on purpose, and taken from the module rather than from the barrel for the reason
// `github-ci-github.test.mjs` gives: the seam these tests exercise is not configuration. What is being
// pinned here is a wire shape and a credential boundary — what bytes leave this process and which of
// them the secret is in — and that is not a fact about the plugin's public surface.
import { createHttpClassifier, readModelCredential } from '../dist/language/model.js';

const PROMPT = Object.freeze({ system: '系统提示：从四个词里挑一个。', user: '光，你现在看到什么？' });
const CANARY = 'canary-credential-that-must-not-travel';

function reply(content) {
  return JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] });
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

function ok(record, response) {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(reply('work-focus'));
}

test('分类请求是一条 OpenAI 兼容的 chat completion，参数固定', async (t) => {
  const { endpoint, seen } = await startServer(t, ok);
  const classifier = createHttpClassifier({ endpoint, model: 'local-model', credential: undefined });
  t.after(() => classifier.dispose());

  const content = await classifier.classify(PROMPT);

  assert.equal(content, 'work-focus', '返回的是模型的原文，不做解释');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, '/v1/chat/completions', '端点地址原样使用，不加查询参数');

  const body = JSON.parse(seen[0].body);
  assert.equal(body.model, 'local-model');
  assert.deepEqual(body.messages, [
    { role: 'system', content: PROMPT.system },
    { role: 'user', content: PROMPT.user },
  ]);
  // Temperature zero because this is a lookup and not a piece of writing: the same question should get
  // the same topic, and a build whose behaviour depended on a sampling draw would be undebuggable.
  assert.equal(body.temperature, 0);
  // Sixteen tokens is enough for a word and the whitespace around it. A model that ignores the
  // instruction and starts writing prose is cut off rather than allowed to decide how much this
  // process buffers.
  assert.equal(body.max_tokens, 16);
});

test('凭据只出现在 Authorization 头里，不进地址也不进请求体', async (t) => {
  const { endpoint, seen } = await startServer(t, ok);
  const classifier = createHttpClassifier({ endpoint, model: 'local-model', credential: CANARY });
  t.after(() => classifier.dispose());

  await classifier.classify(PROMPT);

  // The header is the one place it is meant to be, and this assertion is here so that "the secret
  // travels in a header" is a checked fact rather than a reading of `model.ts`.
  assert.equal(seen[0].headers.authorization, `Bearer ${CANARY}`);

  // Nowhere else. A query parameter would put the secret into every error message that ever mentions
  // an address, and a body is the part of a request that gets logged by whatever is in the middle.
  assert.ok(!seen[0].url.includes(CANARY), '地址里不得有凭据');
  assert.ok(!seen[0].body.includes(CANARY), '请求体里不得有凭据');
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
  // therefore perfectly usable. The guard still refuses a NUL for a caller that gets one from the
  // classifier's own factory; the environment is simply not a way to hand it one.
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

test('没有凭据时，请求里根本不存在 Authorization 头', async (t) => {
  const { endpoint, seen } = await startServer(t, ok);
  const classifier = createHttpClassifier({ endpoint, model: 'local-model', credential: undefined });
  t.after(() => classifier.dispose());

  await classifier.classify(PROMPT);

  // Not an empty header, not `Bearer undefined` — a local endpoint that wants no credential is
  // reached by a request that has no such header at all.
  assert.equal(seen[0].headers.authorization, undefined);
});

test('端点返回错误状态时，错误只说状态码，不说响应体', async (t) => {
  const { endpoint } = await startServer(t, (_record, response) => {
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: `bad key ${CANARY}` } }));
  });
  const classifier = createHttpClassifier({ endpoint, model: 'local-model', credential: CANARY });
  t.after(() => classifier.dispose());

  const error = await classifier.classify(PROMPT).then(
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
  const shapes = [
    '{}',
    '{"choices":[]}',
    '{"choices":[{"message":{}}]}',
    '{"choices":[{"message":{"content":42}}]}',
    '{"choices":"work-focus"}',
    'null',
  ];

  for (const shape of shapes) {
    const { endpoint } = await startServer(t, (_record, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(shape);
    });
    const classifier = createHttpClassifier({ endpoint, model: 'local-model', credential: undefined });
    t.after(() => classifier.dispose());

    const error = await classifier.classify(PROMPT).then(
      () => undefined,
      (thrown) => thrown,
    );

    // `''` would be a legitimate thing for a model to answer with, so substituting it for content that
    // was not found would turn a broken endpoint into a refusal and blame the human's sentence.
    assert.ok(error instanceof Error, `应失败：${shape}`);
    assert.ok(!(error instanceof TypeError), '应是这个插件自己的错误，不是解引用崩溃');
  }
});

test('应答不是 JSON 时是失败', async (t) => {
  const { endpoint } = await startServer(t, (_record, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('<html>gateway</html>');
  });
  const classifier = createHttpClassifier({ endpoint, model: 'local-model', credential: undefined });
  t.after(() => classifier.dispose());

  const error = await classifier.classify(PROMPT).then(
    () => undefined,
    (thrown) => thrown,
  );

  assert.ok(error instanceof Error);
  assert.ok(!error.message.includes('<html>'), '错误里不得有对端的响应体');
});

test('端点不可达时是失败，且错误里没有凭据', async (t) => {
  const classifier = createHttpClassifier({
    endpoint: await unusedEndpoint(),
    model: 'local-model',
    credential: CANARY,
  });
  t.after(() => classifier.dispose());

  const error = await classifier.classify(PROMPT).then(
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
  const classifier = createHttpClassifier({ endpoint, model: 'local-model', credential: undefined });

  const pending = classifier.classify(PROMPT);
  classifier.dispose();

  const error = await pending.then(
    () => undefined,
    (thrown) => thrown,
  );
  assert.ok(error instanceof Error, '中断的请求应是失败，而不是一个回答');
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
