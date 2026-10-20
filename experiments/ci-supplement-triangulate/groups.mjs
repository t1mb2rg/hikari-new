// 只生成 A（八行通知）与 B（机械摘要）两组文本，不调模型。
// 三组对照里 A/B 是零模型的，独立于模型读数生成，样本内容也不随时间变，
// 所以即使某条记录是模型侧的首次调用，A/B 也能单独重算。

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createGitHubCiRunMaterialsReader } from '../../dist/github-ci/materials.js';
import { renderOccurrence } from '../../dist/repository-ci-attention/judgement.js';

import { mechanicalDigest } from './digest.mjs';
import { corpusOf, extractMarkers } from './markers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OWNER = 't1mb2rg';
const NAME = 'hikari-new';
const OWNER_NAME = `${OWNER}/${NAME}`;

const frozen = JSON.parse(readFileSync(join(HERE, 'samples.json'), 'utf8'));
const token = execSync('gh auth token', { encoding: 'utf8' }).trim();
const reader = createGitHubCiRunMaterialsReader({ owner: OWNER, name: NAME, token });

const groups = [];
for (const sample of frozen.samples) {
  const startedAt = Date.now();
  const materials = await reader.getRunMaterials({
    repository: OWNER_NAME,
    runId: sample.runId,
    headSha: sample.headSha,
  });
  const materialsMs = Date.now() - startedAt;

  const occurrence = {
    repository: OWNER_NAME,
    runId: sample.runId,
    workflow: sample.workflowObserved,
    headBranch: sample.headBranch,
    headSha: sample.headSha,
    conclusion: 'failure',
    observedAt: materials.requestedAt,
  };
  const notice = renderOccurrence(occurrence);
  const digest = mechanicalDigest(materials);
  const corpus = corpusOf(materials);

  groups.push({
    runId: sample.runId,
    identity: materials.identity,
    materialsMs,
    failureTruth: {
      failedJobs: corpus.failedJobs,
      failedSteps: corpus.failedSteps,
      changedFileCount: corpus.files.length,
      logChars: corpus.logText.length,
    },
    A_notice: notice,
    A_lineCount: notice.length,
    B_digest: digest,
    markers: {
      A: extractMarkers(notice.join('\n'), corpus).map((m) => ({ ...m, inNotice: true })),
      B: extractMarkers(digest, corpus).map((m) => ({
        ...m,
        inNotice: notice.join('\n').includes(m.value),
      })),
    },
  });

  console.log(`run ${sample.runId}: identity=${materials.identity} 材料 ${materialsMs} ms`);
  console.log(notice.map((line) => `  A| ${line}`).join('\n'));
  console.log(digest.split('\n').map((line) => `  B| ${line}`).join('\n'));
  console.log();
}

writeFileSync(
  join(HERE, 'groups.json'),
  `${JSON.stringify(
    { note: 'A/B 两组是零模型的，独立于模型读数生成。真值取自同一份材料。', ranAt: new Date().toISOString(), groups },
    null,
    2,
  )}\n`,
  'utf8',
);
console.log(`写出 ${groups.length} 组到 groups.json`);
