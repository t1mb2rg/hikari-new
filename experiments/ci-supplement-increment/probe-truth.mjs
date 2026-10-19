// 取「真值」与「基线通知」：这一步不调模型。
//
// 真值 = 材料里 conclusion 为失败的 job，以及这些 job 里 conclusion 为失败的 step。
// 基线通知 = renderOccurrence 对同一 occurrence 生成的 8 行，也就是没有模型补充时人看到的东西。
//
// 不落日志正文：materials.json 只存 job 名、step 名、改动文件名、基线通知与几个计数。

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createGitHubCiRunMaterialsReader } from '../../dist/github-ci/materials.js';
import { renderOccurrence } from '../../dist/repository-ci-attention/judgement.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OWNER = 't1mb2rg';
const NAME = 'hikari-new';
const OWNER_NAME = `${OWNER}/${NAME}`;
const RUN_IDS = [38920662846, 38929605750, 38930952193, 38931770141, 38932844025];
const FAILURE_CONCLUSIONS = new Set(['failure', 'timed_out', 'startup_failure']);

const token = execSync('gh auth token', { encoding: 'utf8' }).trim();
if (token === '') throw new Error('gh auth token 为空');

async function runInfo(runId) {
  const response = await fetch(
    `https://api.github.com/repos/${OWNER}/${NAME}/actions/runs/${runId}`,
    {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
      },
    },
  );
  if (!response.ok) throw new Error(`run ${runId}: HTTP ${response.status}`);
  return response.json();
}

const reader = createGitHubCiRunMaterialsReader({ owner: OWNER, name: NAME, token });

const runs = [];
for (const runId of RUN_IDS) {
  const info = await runInfo(runId);
  const startedAt = Date.now();
  const materials = await reader.getRunMaterials({
    repository: OWNER_NAME,
    runId,
    headSha: info.head_sha,
  });
  const materialsMs = Date.now() - startedAt;

  const jobs = materials.jobs.kind === 'present' ? materials.jobs.value : [];
  const failedJobs = jobs
    .filter((job) => job.conclusion !== null && FAILURE_CONCLUSIONS.has(job.conclusion))
    .map((job) => ({
      name: job.name,
      conclusion: job.conclusion,
      failedSteps: job.steps
        .filter((step) => step.conclusion !== null && FAILURE_CONCLUSIONS.has(step.conclusion))
        .map((step) => step.name),
    }));

  const changedFiles =
    materials.changedFiles.kind === 'present'
      ? materials.changedFiles.value.files.map((file) => file.filename)
      : [];

  const occurrence = {
    repository: OWNER_NAME,
    runId,
    workflow: info.name,
    headBranch: info.head_branch,
    headSha: info.head_sha,
    conclusion: info.conclusion,
    observedAt: new Date().toISOString(),
  };
  const notice = renderOccurrence(occurrence);

  runs.push({
    runId,
    headSha: info.head_sha,
    workflow: info.name,
    headBranch: info.head_branch,
    conclusion: info.conclusion,
    identity: materials.identity,
    materialsMs,
    logChars: materials.log.kind === 'present' ? materials.log.value.text.length : 0,
    allJobNames: jobs.map((job) => job.name),
    failedJobs,
    changedFiles,
    noticeLineCount: notice.length,
    notice,
  });

  console.log(
    `run ${runId}: identity=${materials.identity} jobs=${jobs.length} failedJobs=${failedJobs.length} ` +
      `files=${changedFiles.length} logChars=${runs.at(-1).logChars} (${materialsMs} ms)`,
  );
  for (const job of failedJobs) {
    console.log(`  失败 job「${job.name}」 失败步骤: ${JSON.stringify(job.failedSteps)}`);
  }
}

writeFileSync(
  join(HERE, 'materials.json'),
  `${JSON.stringify(
    {
      note: '真值与基线通知。不调模型；不落日志正文。failures 取自材料里的 job/step conclusion。',
      ownerName: OWNER_NAME,
      fetchedAt: new Date().toISOString(),
      runs,
    },
    null,
    2,
  )}\n`,
  'utf8',
);
console.log(`\n写出 ${runs.length} 个 run 到 materials.json`);
