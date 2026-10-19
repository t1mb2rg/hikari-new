// s1-materials: 用产品同一条 materials reader 路径，真打 GitHub 读一条历史红 run 的材料。
// 只读；不入库任何凭据。产物：real-materials.json
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createGitHubCiRunMaterialsReader } from '../../dist/github-ci/materials.js';

const OWNER = 't1mb2rg';
const NAME = 'hikari-new';
const RUN_ID = 38932844025; // §13.12 五个真红 run 中最晚的一个

const token = execSync('gh auth token', { encoding: 'utf8' }).trim();
if (!token) throw new Error('no gh token');

// 先问 run 自己的完整 head_sha：reader 的 identity 判定是对完整 sha 做的，短 sha 必然 mismatch。
const runRes = await fetch(`https://api.github.com/repos/${OWNER}/${NAME}/actions/runs/${RUN_ID}`, {
  headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}` },
});
const runJson = await runRes.json();
const HEAD_SHA = runJson.head_sha;
console.log(`run ${RUN_ID}: head_sha=${HEAD_SHA} event=${runJson.event} status=${runJson.status} conclusion=${runJson.conclusion}`);

const reader = createGitHubCiRunMaterialsReader({ owner: OWNER, name: NAME, token });

const startedAt = Date.now();
const materials = await reader.getRunMaterials({
  repository: `${OWNER}/${NAME}`,
  runId: RUN_ID,
  headSha: HEAD_SHA,
});
const readerTotalMs = Date.now() - startedAt;

// 三个子请求各自耗时（与 reader 内部同 URL 同 header，只计时）。
const base = 'https://api.github.com';
const h = {
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  authorization: `Bearer ${token}`,
};
async function timeIt(label, url) {
  const t0 = Date.now();
  const res = await fetch(url, { headers: h, redirect: 'follow' });
  const bytes = (await res.arrayBuffer()).byteLength;
  return { label, ms: Date.now() - t0, status: res.status, bytes };
}

const failedJobId = materials.jobs.kind === 'present'
  ? (materials.jobs.value.find((j) => j.conclusion === 'failure') ?? materials.jobs.value[0])?.id
  : undefined;

const sub = [
  await timeIt('commits', `${base}/repos/${OWNER}/${NAME}/commits/${HEAD_SHA}`),
  await timeIt('jobs', `${base}/repos/${OWNER}/${NAME}/actions/runs/${RUN_ID}/jobs?per_page=100`),
];
if (failedJobId !== undefined) {
  sub.push(await timeIt('log(zip)', `${base}/repos/${OWNER}/${NAME}/actions/jobs/${failedJobId}/logs`));
}

function shape(m) {
  if (m.kind === 'present') {
    const v = m.value;
    const bytes = JSON.stringify(v).length;
    if (Array.isArray(v)) return { kind: m.kind, items: v.length, bytes };
    if (v && typeof v === 'object' && 'files' in v) return { kind: m.kind, files: v.files.length, totalFiles: v.totalFiles, bytes };
    if (v && typeof v === 'object' && 'chars' in v) return { kind: m.kind, chars: v.chars, bytes };
    if (v && typeof v === 'object' && 'text' in v) return { kind: m.kind, chars: v.text.length, bytes };
    return { kind: m.kind, bytes };
  }
  return m.kind === 'missing' ? { kind: m.kind, reason: m.reason } : { kind: m.kind };
}

const out = {
  probedAt: new Date().toISOString(),
  repository: materials.repository,
  runId: materials.runId,
  headSha: materials.headSha,
  requestedAt: materials.requestedAt,
  identity: materials.identity,
  readerTotalMs,
  subRequests: sub,
  materials: {
    jobs: shape(materials.jobs),
    changedFiles: shape(materials.changedFiles),
    log: shape(materials.log),
  },
  jobCount: materials.jobs.kind === 'present' ? materials.jobs.value.length : 0,
  failedJobId,
};
writeFileSync(new URL('./real-materials.json', import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
