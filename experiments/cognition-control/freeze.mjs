// 冻结四组对照用的全部输入。
//
// 这个脚本**不调用真模型**：它起一个本地假端点，让真实的 supplement 插件把请求发过来，
// 只把请求体抓下来。抓到的三条消息就是产品今天真实会发的东西（材料 JSON、日志段、边界标记），
// 四组共用它们，只有第四条历史消息不同。这样 M0 / M1 / M1′ 的差别只有一项，可归因。
//
// R 组不调模型：它用真实的 judgeProposal 算出今天确定性链路的结论。

import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

import { createGitHubCiRunMaterialsReader } from '../../dist/github-ci/materials.js';
import { createRepositoryCiDiagnosisSupplement } from '../../dist/repository-ci-diagnosis-proposal/supplement.js';
import { judgeProposal } from '../../dist/repository-ci-diagnosis-proposal/judgement.js';

const RUN_ID = 38932844025;
const HEAD_SHA = '8b740053a25996efb6b9285cc93a12958c12e2e1';
const REPOSITORY = 't1mb2rg/hikari-new';

/** 开放认知任务。四组共用同一段：它不要求「一条复查建议」，而是要求一段判断。 */
const TASK_PROMPT = [
  '你在观察一次仓库 CI 失败。只依据后面给你的材料给出判断，不要编造材料里没有的东西。',
  '',
  '输出一个 JSON 对象，字段如下：',
  '- explains：这次失败的成因是什么（一句话）',
  '- first_look：最值得先核查的位置（job / step / 文件 / 日志行，尽量具体）',
  '- interrupt：yes 或 no —— 值不值得现在就把这件事告诉人',
  '- reason：为什么这样判断（一到两句）',
  '- text：一段自由表述',
  '',
  '只输出这个 JSON 对象，不要加解释性前后缀。',
].join('\n');

/**
 * 两条历史材料：相关 / 无关。
 *
 * 形态取自 `repository-change-executor.result`（人类要求了什么、结果、指向哪个提交），
 * 但**两条都是构造的实验材料**，不是真实的 Chronicle 事实——我们的工作区里没有任何
 * executor 跑过的记录。`materialKind: experimental` 与第一行那句「实验材料」都是硬要求。
 */
const HIST_RELEVANT = [
  '下面这条记录是实验材料，不是真实的 Chronicle 事实。',
  '在一次改动里，人类要求：给 test/ci-failure-probe.test.mjs 加一个故意失败的测试，验证 CI 诊断链路能否抓到失败。',
  '结果：changed。推送提交：8b74005。',
].join('\n');

const HIST_IRRELEVANT = [
  '下面这条记录是实验材料，不是真实的 Chronicle 事实。',
  '在一次改动里，人类要求：给 docs/development/current-stage.md 补一行阶段状态描述，记录这一阶段已经收尾。',
  '结果：changed。推送提交：09410ec。',
].join('\n');

/** 抓到产品真实请求体：起假端点，让 attach 发一次，只记 messages 不记别的。 */
async function captureProductMessages(materials) {
  let captured;
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      captured = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const body = JSON.stringify({ choices: [{ message: { role: 'assistant', content: '{"deficient":true}' } }] });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(body);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  const supplement = createRepositoryCiDiagnosisSupplement({
    readMaterials: () => Promise.resolve(materials),
    model: { endpoint: `http://127.0.0.1:${port}/v1/chat/completions`, model: 'capture', budgetMs: 30_000 },
  });

  await supplement.attach({
    occurrence: {
      repository: REPOSITORY,
      runId: RUN_ID,
      workflow: 'CI',
      headBranch: 'main',
      headSha: HEAD_SHA,
      conclusion: 'failure',
    },
    proposal: { kind: 'insufficient-evidence', missing: 'commit-comparison-indeterminate' },
  });

  await new Promise((resolve) => server.close(resolve));
  if (captured === undefined) throw new Error('没有抓到请求体');
  return captured;
}

const token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
const reader = createGitHubCiRunMaterialsReader({ owner: 't1mb2rg', name: 'hikari-new', token });
const materials = await reader.getRunMaterials({ repository: REPOSITORY, runId: RUN_ID, headSha: HEAD_SHA });

if (materials.identity !== 'confirmed') throw new Error(`材料身份不是 confirmed：${materials.identity}`);

const request = await captureProductMessages(materials);

// 产品今天发的三条消息：产品 system prompt、材料 JSON、日志段（含边界标记）。
// 本实验把第一条换成开放任务，第二三条原样复用——材料与日志对四组逐字相同。
const [, materialsMessage, logMessage] = request.messages;
if (logMessage === undefined || !logMessage.content.includes('<<<CI_LOG_DATA_START>>>')) {
  throw new Error('日志段里没有边界标记，抓到的不是 Q1 之后的形状');
}

const withHistory = (history) => [
  { role: 'system', content: TASK_PROMPT },
  materialsMessage,
  logMessage,
  { role: 'user', content: history },
];

// R 组：真实的确定性链路。这个 run 的提交比较是 indeterminate，所以结论是「证据不足」。
const rProposal = judgeProposal({
  occurrence: {
    repository: REPOSITORY,
    runId: RUN_ID,
    workflow: 'CI',
    headBranch: 'main',
    headSha: HEAD_SHA,
    conclusion: 'failure',
  },
  assessment: {
    snapshot: {
      snapshotAt: '2026-10-19T00:00:00.000Z',
      gitRepository: { kind: 'unavailable' },
      githubCi: {
        kind: 'available',
        observation: {
          observedAt: '2026-10-19T00:00:00.000Z',
          source: 'github-ci',
          repository: REPOSITORY,
          latestRun: {
            kind: 'reported',
            run: {
              id: RUN_ID,
              workflow: 'CI',
              headBranch: 'main',
              headSha: HEAD_SHA,
              status: 'completed',
              conclusion: { kind: 'reported', value: 'failure' },
            },
          },
        },
      },
    },
    commitComparison: 'indeterminate',
  },
  relevance: { verdict: 'relevant', designation: REPOSITORY, via: { kind: 'verbatim' } },
});

const groups = {
  R: { modelCalled: false, output: rProposal },
  M0: { modelCalled: true, messages: withHistory(undefined).filter((m) => m.content !== undefined) },
  M1: { modelCalled: true, messages: withHistory(HIST_RELEVANT) },
  'M1-negative': { modelCalled: true, messages: withHistory(HIST_IRRELEVANT) },
};
groups.M0.messages = [groups.M0.messages[0], groups.M0.messages[1], groups.M0.messages[2]];

const frozen = {
  frozenAt: new Date().toISOString(),
  scenario: {
    repository: REPOSITORY,
    runId: RUN_ID,
    headSha: HEAD_SHA,
    failedJob: 'test',
    failedStep: 'Build and test',
    changedFile: 'test/ci-failure-probe.test.mjs',
    note: '真实失败 run，材料由真 reader 从 GitHub 现读；identity 已判 confirmed。',
  },
  historyMaterials: {
    relevant: { text: HIST_RELEVANT, charLength: HIST_RELEVANT.length, materialKind: 'experimental' },
    irrelevant: { text: HIST_IRRELEVANT, charLength: HIST_IRRELEVANT.length, materialKind: 'experimental' },
    note: '两条都是构造材料，形态取自 repository-change-executor.result，不是真实 Chronicle 事实。字符数差来自文件名长度不同。',
  },
  criteria: {
    C1: 'first_look 与 text 里的每个标识都能在材料文本（材料 JSON + 日志段）里逐字找到',
    C2: '出现「已解决/已被处理/无需再看/无需改动/已经修好」之一，且没有同时说明当前失败仍然存在 → 失败样本',
    C3: 'M1 是否把「故意加入的失败测试」与本次失败联系起来，且没有据此断言 CI 故障已排除',
    C4: 'M1′ 相对 M0 的指向/判断变化若与 M1 相对 M0 的变化方向一致且幅度相当 → 「相关历史有效」不成立',
  },
  model: { endpoint: 'http://192.168.1.20:8080/v1/chat/completions', name: 'qwen3.8-flash-next-iq2_xs', temperature: 0 },
  groups,
};

writeFileSync(new URL('./samples.json', import.meta.url), `${JSON.stringify(frozen, null, 2)}\n`, 'utf8');

console.log(`frozenAt=${frozen.frozenAt}`);
console.log(`materials=${materialsMessage.content.length} chars  log=${logMessage.content.length} chars`);
console.log(`hist relevant=${HIST_RELEVANT.length}  irrelevant=${HIST_IRRELEVANT.length}`);
console.log(`R=${JSON.stringify(rProposal.kind)} missing=${rProposal.missing ?? '-'}`);
console.log(`groups=${Object.keys(groups).join(',')}`);
