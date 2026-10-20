// 冻结本轮的四个组（最后一轮认知对照）的全部输入。
//
// 这个脚本**不调用真模型**：它起一个本地假端点，让真实的 supplement 插件把请求发过来，
// 只把请求体抓下来。抓到的「材料 JSON」与「日志段」是产品今天真实会发的两条消息，
// 四组逐字复用；四组之间唯一的差别是 system 任务说明（R 组不用模型）与最后那条历史消息。
//
// R 组不调模型：它用真实的 judgeProposal 算出今天确定性链路的结论。

import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

import { createGitHubCiRunMaterialsReader } from '../../dist/github-ci/materials.js';
import { createRepositoryCiDiagnosisSupplement } from '../../dist/repository-ci-diagnosis-proposal/supplement.js';
import { judgeProposal } from '../../dist/repository-ci-diagnosis-proposal/judgement.js';

const RUN_ID = 34752988729;
const HEAD_SHA = '2a2c0748ed5c58b5c8e91b7439cff3de51946056';
const REPOSITORY = 't1mb2rg/hikari-new';

/**
 * 开放认知任务。四组共用同一段。
 *
 * 与上一轮的区别：上一轮只要一句「先看哪里」，这一轮要它把**事实、推测、还缺什么**分开写，
 * 并要求它给出多个候选介入方向（标明未定），这样才能看出历史上的差异究竟落在哪个维度。
 */
const TASK_PROMPT = [
  '你在观察一次仓库 CI 失败。只依据后面给你的材料给出判断，不要编造材料里没有的东西。',
  '',
  '输出一个 JSON 对象，字段如下：',
  '- explains：这次失败意味着什么（一句话）',
  '- facts：材料里能直接确认的事实（字符串数组，每项要能在材料原文里找到）',
  '- assumptions：你的推测（字符串数组，没有就空数组）',
  '- first_look：最值得先核查的位置，按优先级从前到后（字符串数组，尽量具体到 job / step / 文件）',
  '- missing_info：下结论前还缺哪条信息（字符串数组）',
  '- candidates：可能的介入方向（字符串数组，至少两项；不确定就明说哪一项更可能）',
  '- resolved：这次失败是否已经解决（true 或 false）',
  '',
  '只输出这个 JSON 对象，不要加解释性前后缀。',
].join('\n');

/**
 * 两条历史材料：一条相关、一条同形态但无关。
 *
 * 两条都是**构造的实验材料**，形态模仿 `repository-change-executor.result`
 * （人类要求了什么 / 结果 / 指向哪个提交），内容来自 git 提交记录。
 * 原 owner 是 git，不是 Chronicle：本仓库里没有这两条事实。
 */
const HIST_RELEVANT = [
  '下面这条记录是实验材料，不是真实的 Chronicle 事实。',
  '仓库历史：截至提交 2a2c074（2026-09-13），本仓库从未提交过 package-lock.json 或 npm-shrinkwrap.json；.gitignore 里没有忽略它们；本地安装依赖一直用 npm install。',
].join('\n');

const HIST_IRRELEVANT = [
  '下面这条记录是实验材料，不是真实的 Chronicle 事实。',
  '仓库历史：本仓库的测试框架一直用 Node.js 内置的 node:test；package.json 的 test 脚本直接调用 node --test，没有使用 jest、mocha 或 vitest。',
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
      workflow: 'Runtime Tests',
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

const baseMessages = [{ role: 'system', content: TASK_PROMPT }, materialsMessage, logMessage];
const withHistory = (history) => [...baseMessages, { role: 'user', content: history }];

// R 组：真实的确定性链路。这个 run 的提交比较是 indeterminate，所以结论是「证据不足」。
const rProposal = judgeProposal({
  occurrence: {
    repository: REPOSITORY,
    runId: RUN_ID,
    workflow: 'Runtime Tests',
    headBranch: 'main',
    headSha: HEAD_SHA,
    conclusion: 'failure',
  },
  assessment: {
    snapshot: {
      snapshotAt: '2026-10-20T00:00:00.000Z',
      gitRepository: { kind: 'unavailable' },
      githubCi: {
        kind: 'available',
        observation: {
          observedAt: '2026-10-20T00:00:00.000Z',
          source: 'github-ci',
          repository: REPOSITORY,
          latestRun: {
            kind: 'reported',
            run: {
              id: RUN_ID,
              workflow: 'Runtime Tests',
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

/** materials 里拿出来给人看的几项，避免冻结文件里塞一整份 65 KB 日志。 */
const jobSummary = materials.jobs.kind === 'present'
  ? materials.jobs.value.map((job) => ({ name: job.name, conclusion: job.conclusion }))
  : materials.jobs.kind;
const fileSummary = materials.changedFiles.kind === 'present'
  ? { totalFiles: materials.changedFiles.value.totalFiles, files: materials.changedFiles.value.files.map((f) => f.filename) }
  : materials.changedFiles.kind;

const criteria = {
  C1: '语义判断：explains 把这次失败归类成什么（依赖/CI 配置缺失 vs 代码缺陷）。记录原文，不做对错判定——材料本身不足以定论。',
  C2: '事实与假设区分：facts 里每一项都要能在材料文本（材料 JSON + 日志段）里逐字找到；找不到即记为「事实里混入推测」。assumptions 可以为空。',
  C3: '复查优先级：first_look 的第一项指向哪里。M1 若把「lock 文件是否存在 / workflow 的 cache 配置」提到首位，M0 与 M1′ 没有，记为实质变化。',
  C4: '信息需求：missing_info 是否指出「需要确认 lock 文件是否存在」或「workflow 用的是 npm ci 还是 npm install」这类能分辨解释的信息。',
  C5: '候选介入意图：candidates 是否给出两项以上、且没有把其中一项当成已确定结论。',
  C6: '误读检查：出现「已解决 / 已修复 / 说明根因就是 / 无需再看 / 已经修好」且没有同时说明当前失败仍存在 → 失败样本。',
};

const groups = {
  R: { modelCalled: false, output: rProposal },
  M0: { modelCalled: true, history: null, messages: baseMessages },
  M1: { modelCalled: true, history: 'relevant', messages: withHistory(HIST_RELEVANT) },
  'M1-negative': { modelCalled: true, history: 'irrelevant', messages: withHistory(HIST_IRRELEVANT) },
};

const frozen = {
  frozenAt: new Date().toISOString(),
  scenario: {
    repository: REPOSITORY,
    runId: RUN_ID,
    headSha: HEAD_SHA,
    workflow: 'Runtime Tests',
    failedJobCount: Array.isArray(jobSummary) ? jobSummary.length : 0,
    jobs: jobSummary,
    changedFiles: fileSummary,
    note: '真实失败 run，main 分支，材料由真 reader 从 GitHub 现读；identity 已判 confirmed。日志不自证「故意制造」，也不给出唯一处置方向。',
  },
  historyMaterials: {
    relevant: { text: HIST_RELEVANT, charLength: HIST_RELEVANT.length, materialKind: 'experimental', provenance: 'git log --all -- package-lock.json；package.json scripts' },
    irrelevant: { text: HIST_IRRELEVANT, charLength: HIST_IRRELEVANT.length, materialKind: 'experimental', provenance: 'package.json scripts.test' },
    note: '两条都是构造材料，形态模仿 repository-change-executor.result，内容来自 git 提交记录；不是真实 Chronicle 事实。M1 与 M1′ 除最后一条消息外逐字相同。',
  },
  criteria,
  whatEachGroupCanShow: {
    R: '产品今天在这类失败上给出什么（不给建议，只给 insufficient-evidence）。',
    M0: '不接任何历史时，模型对这次失败的判断基线。',
    M1: '接入一条可验证的相关历史后，判断是否在某一维上发生实质变化。',
    'M1-negative': '同样形态但无关的历史是否也引起类似变化——若是，变化不能归因于相关性。',
  },
  model: {
    endpoint: 'http://192.168.1.20:8080/v1/chat/completions',
    name: 'qwen3.8-flash-next-iq2_xs',
    temperature: 0,
    note: '模型不持有任何工具，只输出一段 JSON 判断；本轮不执行任何动作。',
  },
  groups,
};

writeFileSync(new URL('./samples.json', import.meta.url), `${JSON.stringify(frozen, null, 2)}\n`, 'utf8');

console.log(`frozenAt=${frozen.frozenAt}`);
console.log(`materials=${materialsMessage.content.length} chars  log=${logMessage.content.length} chars`);
console.log(`hist relevant=${HIST_RELEVANT.length}  irrelevant=${HIST_IRRELEVANT.length}`);
console.log(`jobs=${JSON.stringify(jobSummary)}`);
console.log(`files=${JSON.stringify(fileSummary)}`);
console.log(`R=${JSON.stringify(rProposal.kind)} missing=${rProposal.missing ?? '-'}`);
console.log(`groups=${Object.keys(groups).join(',')}`);
