// 候选样本筛选：只读 GitHub，不调用模型。
// 目的：在冻结之前确认这 5 个 run 的材料能取全、身份能确认，并记录失败形态。
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createGitHubCiRunMaterialsReader } from '../../dist/github-ci/materials.js';

const REPO = 't1mb2rg/hikari-new';
const CANDIDATES = [
  { runId: 38760836396, headSha: 'd734eab', why: 'surface 单独失败（Test the runtime），test job 绿' },
  { runId: 34752998965, headSha: '97a5a1d', why: 'test job 在 Setup Node 就失败，没有测试输出' },
  { runId: 36327884462, headSha: '6261c2a', why: '非 main 分支，旧 workflow（8 步）' },
  { runId: 38765009721, headSha: 'd682a89', why: 'test/Build and test，surface 绿' },
  { runId: 38415923320, headSha: '5e8be53', why: 'test/Build and test，另一个时间点' },
];

const token = execSync('gh auth token', { encoding: 'utf8' }).trim();
const reader = createGitHubCiRunMaterialsReader({ owner: 't1mb2rg', name: 'hikari-new', token });

const out = [];
for (const c of CANDIDATES) {
  // 先用完整 sha：短 sha 会让 reader 判 mismatch（已知坑）。
  const full = execSync(`gh api repos/${REPO}/commits/${c.headSha} -q .sha`, { encoding: 'utf8' }).trim();
  const startedAt = Date.now();
  const m = await reader.getRunMaterials({ repository: REPO, runId: c.runId, headSha: full });
  const ms = Date.now() - startedAt;

  const jobs = m.jobs.kind === 'present' ? m.jobs.value : [];
  const failedJobs = jobs
    .filter((j) => j.conclusion === 'failure')
    .map((j) => ({ name: j.name, failedSteps: j.steps.filter((s) => s.conclusion === 'failure').map((s) => s.name) }));
  const files = m.changedFiles.kind === 'present' ? m.changedFiles.value.files : [];
  const log = m.log.kind === 'present' ? m.log.value : null;

  out.push({
    runId: c.runId,
    headSha: full,
    why: c.why,
    identity: m.identity,
    materialsMs: ms,
    workflow: null,
    failedJobs,
    allJobNames: jobs.map((j) => `${j.name}[${j.conclusion}]`),
    changedFiles: files.map((f) => f.path),
    log: log ? { step: log.step, window: log.window, chars: log.text.length, truncated: log.truncated } : { missing: m.log.kind === 'missing' ? m.log.reason : m.log.kind },
  });
  console.log(`${c.runId} identity=${m.identity} ${ms}ms jobs=${failedJobs.map((j) => j.name + '/' + j.failedSteps.join('+')).join(',') || 'none'} files=${files.length} log=${log ? log.step + ':' + log.text.length : 'MISSING'}`);
}

writeFileSync(new URL('./candidates.json', import.meta.url), JSON.stringify(out, null, 2) + '\n', 'utf8');
