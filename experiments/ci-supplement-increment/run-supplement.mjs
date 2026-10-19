// 对五个真红 run 各跑一次真补充：真材料 + 真端点 + 真插件模块，提示词与 schema 不动。
//
// 落 outputs.json：人最终看到的那段文字（attach 的返回值）就是这里的读数。
// 拒绝（undefined）同样是读数——它意味着这次没有附加，原因在日志里。

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createGitHubCiRunMaterialsReader } from '../../dist/github-ci/materials.js';
import { createRepositoryCiDiagnosisSupplement } from '../../dist/repository-ci-diagnosis-proposal/supplement.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OWNER = 't1mb2rg';
const NAME = 'hikari-new';
const OWNER_NAME = `${OWNER}/${NAME}`;
const MODEL = {
  endpoint: 'http://192.168.1.20:8080/v1/chat/completions',
  model: 'qwen3.8-flash-next-iq2_xs',
  budgetMs: 180000,
};

const truth = JSON.parse(
  (await import('node:fs')).readFileSync(join(HERE, 'materials.json'), 'utf8'),
);
// 只补跑某一条（端点偶发故障时用）：已有记录保留为 firstAttempt，不覆盖读数。
const ONLY = process.env.ONLY_RUN === undefined ? undefined : Number(process.env.ONLY_RUN);
const previous =
  ONLY === undefined
    ? undefined
    : JSON.parse((await import('node:fs')).readFileSync(join(HERE, 'outputs.json'), 'utf8'));
const token = execSync('gh auth token', { encoding: 'utf8' }).trim();
const reader = createGitHubCiRunMaterialsReader({ owner: OWNER, name: NAME, token });

const PROPOSAL = Object.freeze({
  kind: 'insufficient-evidence',
  missing: 'commit-comparison-indeterminate',
});

const records = [];
for (const run of truth.runs) {
  if (ONLY !== undefined && run.runId !== ONLY) continue;
  const logs = [];
  const supplement = createRepositoryCiDiagnosisSupplement({
    readMaterials: (query) => reader.getRunMaterials(query),
    model: MODEL,
    log: (line) => {
      logs.push(line);
      console.log(`  [log] ${line}`);
    },
  });

  const startedAt = Date.now();
  let content;
  let error;
  try {
    content = await supplement.attach({
      occurrence: {
        repository: OWNER_NAME,
        runId: run.runId,
        workflow: run.workflow,
        headBranch: run.headBranch,
        headSha: run.headSha,
        conclusion: run.conclusion,
        observedAt: new Date().toISOString(),
      },
      proposal: PROPOSAL,
    });
  } catch (thrown) {
    error = thrown instanceof Error ? thrown.message : String(thrown);
  }
  const ms = Date.now() - startedAt;

  records.push({
    runId: run.runId,
    ms,
    attached: content !== undefined,
    text: content?.text ?? null,
    cited: content?.cited ?? null,
    logs,
    ...(error === undefined ? {} : { error }),
  });

  console.log(
    `run ${run.runId}: ${content === undefined ? '未附加' : '已附加'} ${ms} ms` +
      (error === undefined ? '' : ` ERROR ${error}`),
  );
  if (content !== undefined) console.log(`  文本：${content.text}`);
  console.log();
}

const commit = execSync('git log -1 --format=%H -- src/repository-ci-diagnosis-proposal/supplement.ts', {
  encoding: 'utf8',
}).trim();

let merged = records;
if (previous !== undefined) {
  const fresh = new Map(records.map((record) => [record.runId, record]));
  merged = previous.records.map((record) => {
    const replacement = fresh.get(record.runId);
    if (replacement === undefined) return record;
    fresh.delete(record.runId);
    return { ...replacement, firstAttempt: record };
  });
  merged.push(...fresh.values());
}

writeFileSync(
  join(HERE, 'outputs.json'),
  `${JSON.stringify(
    {
      note: '真材料 + 真端点 + 真 supplement 模块。text 就是 attach 的返回值，即人看到的那段。',
      model: MODEL,
      supplementCommit: commit,
      promptUnchangedCheck: 'supplementCommit 应等于 146e53bf9feeafa1bfed9dd7b199b55b82c12fe7',
      ranAt: new Date().toISOString(),
      records: merged,
    },
    null,
    2,
  )}\n`,
  'utf8',
);
console.log(`写出 ${merged.length} 条记录到 outputs.json（supplement.ts = ${commit}）`);
