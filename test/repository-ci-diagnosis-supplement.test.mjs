import assert from 'node:assert/strict';
import test from 'node:test';

import { createRepositoryCiDiagnosisSupplement } from '../dist/repository-ci-diagnosis-proposal/index.js';

// The supplement module, without a runtime and without a socket.
//
// The product-level tests live in `repository-ci-attention.test.mjs`, because the claim they make is
// about a cycle: one failure, one message, one paragraph appended or not. What is left here are the
// properties of the module itself that a cycle cannot state as cleanly — above all the door, which is
// the answer to "on which arms may this module spend a model at all".

const OCCURRENCE = Object.freeze({
  repository: 't1mb2rg/hikari-new',
  runId: 41,
  headSha: 'c0ffee1234567890abcdef1234567890abcdef12',
  workflow: 'ci',
  headBranch: 'main',
  conclusion: 'failure',
});

const MATERIALS = Object.freeze({
  requestedAt: '2026-03-01T09:00:00.000Z',
  repository: 't1mb2rg/hikari-new',
  runId: 41,
  headSha: 'c0ffee1234567890abcdef1234567890abcdef12',
  identity: 'confirmed',
  jobs: Object.freeze({
    kind: 'present',
    value: Object.freeze([
      Object.freeze({
        id: 7,
        name: 'test',
        status: 'completed',
        conclusion: 'failure',
        steps: Object.freeze([Object.freeze({ name: 'Build and test', conclusion: 'failure' })]),
        runId: 41,
        headSha: 'c0ffee1234567890abcdef1234567890abcdef12',
      }),
    ]),
  }),
  changedFiles: Object.freeze({
    kind: 'present',
    value: Object.freeze({ files: Object.freeze([]), totalFiles: 0, omittedFiles: 0 }),
  }),
  log: Object.freeze({ kind: 'pending' }),
});

function countingReader() {
  const reads = [];
  return {
    reads,
    readMaterials(query) {
      reads.push(query);
      return Promise.resolve(MATERIALS);
    },
  };
}

function modelThatAnswers(content, finishReason = 'stop') {
  const seen = [];
  return {
    seen,
    fetch: (url, init) => {
      seen.push({ url, init });
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ choices: [{ message: { content }, finish_reason: finishReason }] })),
      });
    },
  };
}

// `createRepositoryCiDiagnosisSupplement` takes its transport from the global `fetch`, exactly as the
// Language plugin's model seam does — there is one wire shape and one way to reach it. Stubbing the
// global for the duration of a test is what lets this file stay a file about the module.
async function withFetch(stub, run) {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

test('门：四个分支里只有 commit-comparison-indeterminate 这一支会被问模型', async () => {
  for (const proposal of [
    { kind: 'check-commit-alignment', evidence: {} },
    { kind: 'inspect-run-steps', evidence: {} },
    { kind: 'inspect-own-action', evidence: {} },
    { kind: 'insufficient-evidence', missing: 'no-github-ci-facet' },
    { kind: 'insufficient-evidence', missing: 'relevance-not-established' },
  ]) {
    const reader = countingReader();
    const model = modelThatAnswers('{"deficient":true}');
    const supplement = createRepositoryCiDiagnosisSupplement({
      readMaterials: reader.readMaterials,
      model: { endpoint: 'http://127.0.0.1:1/v1/chat/completions', model: 'test-model', budgetMs: 30_000 },
    });

    const attached = await withFetch(model.fetch, () => supplement.attach({ occurrence: OCCURRENCE, proposal }));

    assert.equal(attached, undefined, `${proposal.kind} 不该有补充`);
    assert.equal(reader.reads.length, 0, `${proposal.kind} 连材料都不该读`);
    assert.equal(model.seen.length, 0, `${proposal.kind} 不该问模型`);
  }
});

test('没配模型时什么都不读，也不问', async () => {
  const reader = countingReader();
  const supplement = createRepositoryCiDiagnosisSupplement({ readMaterials: reader.readMaterials });

  const attached = await supplement.attach({
    occurrence: OCCURRENCE,
    proposal: { kind: 'insufficient-evidence', missing: 'commit-comparison-indeterminate' },
  });

  assert.equal(attached, undefined);
  assert.equal(reader.reads.length, 0);
});

test('这一支上合格答案原样返回内容：不带标签、不带排版，那是投递方的固定写法', async () => {
  const model = modelThatAnswers(JSON.stringify({ text: '先看 Build and test 这一步。', cited: ['Build and test'] }));
  const supplement = createRepositoryCiDiagnosisSupplement({
    readMaterials: countingReader().readMaterials,
    model: { endpoint: 'http://127.0.0.1:1/v1/chat/completions', model: 'test-model', budgetMs: 30_000 },
  });

  const attached = await withFetch(model.fetch, () =>
    supplement.attach({
      occurrence: OCCURRENCE,
      proposal: { kind: 'insufficient-evidence', missing: 'commit-comparison-indeterminate' },
    }),
  );

  assert.deepEqual(attached, { text: '先看 Build and test 这一步。', cited: ['Build and test'] });
  assert.equal(model.seen.length, 1);
  assert.equal(model.seen[0].init.method, 'POST');
  // The model is asked with the materials and nothing else: no notification text, no human sentence,
  // no previous answer. A supplement that had seen the message it is added to could contradict it.
  const body = JSON.parse(model.seen[0].init.body);
  assert.equal(body.messages.length, 2);
  assert.ok(body.messages[1].content.includes('Build and test'));
});

test('凭据只出现在 Authorization 头里：不进请求体、不进日志行', async () => {
  const logs = [];
  const model = modelThatAnswers(
    JSON.stringify({ text: '先看 Build and test 这一步。', cited: ['Build and test'] }),
  );
  const supplement = createRepositoryCiDiagnosisSupplement({
    readMaterials: countingReader().readMaterials,
    model: {
      endpoint: 'http://127.0.0.1:1/v1/chat/completions',
      model: 'test-model',
      budgetMs: 30_000,
      credential: 'test-model-credential',
    },
    log: (line) => logs.push(line),
  });

  await withFetch(model.fetch, () =>
    supplement.attach({
      occurrence: OCCURRENCE,
      proposal: { kind: 'insufficient-evidence', missing: 'commit-comparison-indeterminate' },
    }),
  );

  assert.equal(model.seen.length, 1);
  assert.equal(model.seen[0].init.headers.authorization, 'Bearer test-model-credential');
  assert.equal(model.seen[0].init.body.includes('test-model-credential'), false);
  // No line at all on the success path, and that is the module's contract rather than an omission:
  // 「已附加」 is a claim about the message, and the message is assembled by the caller — so the line
  // that says it belongs to whoever appends. What this asserts about the credential is the absence:
  // nothing this module writes can carry it.
  assert.deepEqual(logs, []);
});

test('引用列表为空、或者引用了材料里没有的字符串，都不算合格答案', async () => {
  for (const content of [
    JSON.stringify({ text: '看看那里。', cited: [] }),
    JSON.stringify({ text: '看看那里。', cited: ['deployment.yaml'] }),
  ]) {
    const logs = [];
    const model = modelThatAnswers(content);
    const supplement = createRepositoryCiDiagnosisSupplement({
      readMaterials: countingReader().readMaterials,
      model: { endpoint: 'http://127.0.0.1:1/v1/chat/completions', model: 'test-model', budgetMs: 30_000 },
      log: (line) => logs.push(line),
    });

    const attached = await withFetch(model.fetch, () =>
      supplement.attach({
        occurrence: OCCURRENCE,
        proposal: { kind: 'insufficient-evidence', missing: 'commit-comparison-indeterminate' },
      }),
    );

    assert.equal(attached, undefined);
    assert.equal(logs.length <= 1, true);
    if (logs.length === 1) assert.match(logs[0], /^模型补充：/);
  }
});

test('诚实的弃权不写日志，形状不对才写：这两件事不能混成一件', async () => {
  const abstained = createRepositoryCiDiagnosisSupplement({
    readMaterials: countingReader().readMaterials,
    model: { endpoint: 'http://127.0.0.1:1/v1/chat/completions', model: 'test-model', budgetMs: 30_000 },
    log: (line) => assert.fail(`弃权不该写日志：${line}`),
  });
  await withFetch(modelThatAnswers('{"deficient": true}').fetch, () =>
    abstained.attach({
      occurrence: OCCURRENCE,
      proposal: { kind: 'insufficient-evidence', missing: 'commit-comparison-indeterminate' },
    }),
  );

  const logs = [];
  const malformed = createRepositoryCiDiagnosisSupplement({
    readMaterials: countingReader().readMaterials,
    model: { endpoint: 'http://127.0.0.1:1/v1/chat/completions', model: 'test-model', budgetMs: 30_000 },
    log: (line) => logs.push(line),
  });
  await withFetch(modelThatAnswers('我觉得应该看看构建那一步。').fetch, () =>
    malformed.attach({
      occurrence: OCCURRENCE,
      proposal: { kind: 'insufficient-evidence', missing: 'commit-comparison-indeterminate' },
    }),
  );

  assert.deepEqual(logs, ['模型补充：格式错误 → 未附加']);
});

test('请求里带的是严格 schema：两种形状、cited 最多五项、不许额外字段', async () => {
  const model = modelThatAnswers(JSON.stringify({ text: '先看 Build and test 这一步。', cited: ['Build and test'] }));
  const supplement = createRepositoryCiDiagnosisSupplement({
    readMaterials: countingReader().readMaterials,
    model: { endpoint: 'http://127.0.0.1:1/v1/chat/completions', model: 'test-model', budgetMs: 30_000 },
  });

  await withFetch(model.fetch, () =>
    supplement.attach({
      occurrence: OCCURRENCE,
      proposal: { kind: 'insufficient-evidence', missing: 'commit-comparison-indeterminate' },
    }),
  );

  const body = JSON.parse(model.seen[0].init.body);
  const format = body.response_format;
  assert.equal(format.type, 'json_schema');
  assert.equal(format.json_schema.strict, true);
  // Two shapes: the answer, and the abstention. A schema that only allowed the answer would push an
  // honest model into inventing citations to satisfy `required`.
  const shapes = format.json_schema.schema.anyOf;
  assert.equal(shapes.length, 2);
  const answer = shapes.find((shape) => shape.required?.includes('cited'));
  assert.equal(answer.additionalProperties, false);
  assert.equal(answer.properties.cited.maxItems, 5);
  assert.equal(answer.properties.text.maxLength, 600);
});

test('模型把 token 用在思考上、被 max_tokens 截断时，与「形状不对」分开记', async () => {
  const logs = [];
  const supplement = createRepositoryCiDiagnosisSupplement({
    readMaterials: countingReader().readMaterials,
    model: { endpoint: 'http://127.0.0.1:1/v1/chat/completions', model: 'test-model', budgetMs: 30_000 },
    log: (line) => logs.push(line),
  });

  const attached = await withFetch(modelThatAnswers(null, 'length').fetch, () =>
    supplement.attach({
      occurrence: OCCURRENCE,
      proposal: { kind: 'insufficient-evidence', missing: 'commit-comparison-indeterminate' },
    }),
  );

  assert.equal(attached, undefined);
  // 两件事对运维的含义不同：一个是预算太小、模型没来得及回答；另一个是模型答了但不在契约里。
  // 都退成 undefined，但日志必须能分辨，否则下一次调参就会调错那一格。
  assert.deepEqual(logs, ['模型补充：输出未完成（length）→ 未附加']);
});
