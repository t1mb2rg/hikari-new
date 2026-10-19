// s2-measure: 在 attention 的真实周期调度下，量一次模型的补充到底花多久、把轮询推迟多少。
//
// 真：Runtime、attention 插件、diagnosis 插件、supplement 插件、materials reader（打真 GitHub）、
//     模型端点（192.168.1.20:8080）、budgetMs=180000。
// 假：ci acquisition（直接给定失败 run，因为产品上只观察最新一条 run，且它现在是绿的）、
//     awareness（按产品逻辑把 assessment 组出来，commitComparison=indeterminate）、relevance judge、
//     change actions、speaking、delivery、chronicle。
//
// 两轮各用一个不同的历史红 run，因为 attention 对同一 failure 只处理一次。
// 产物：cycle-log.json
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

import { Runtime } from '../../dist/index.js';
import { detectNewFailure } from '../../dist/repository-ci-attention/judgement.js';
import { chronicleService } from '../../dist/chronicle/index.js';
import { gitHubCiRunMaterialsService, gitHubCiService, createGitHubCiRunMaterialsReader } from '../../dist/github-ci/index.js';
import { humanDeliveryService } from '../../dist/human-delivery/index.js';
import { languageDiagnosisSpeakingService, languageSpeakingService } from '../../dist/language/index.js';
import { repositoryCiAwarenessService } from '../../dist/repository-ci-awareness/index.js';
import {
  repositoryCiDiagnosisProposalService,
  repositoryCiDiagnosisProposalPlugin,
  repositoryCiDiagnosisSupplementPlugin,
} from '../../dist/repository-ci-diagnosis-proposal/index.js';
import { repositoryChangeActionsService } from '../../dist/repository-change-executor/index.js';
import { repositoryCiRelevanceJudgeService } from '../../dist/repository-ci-relevance/index.js';
import { repositoryCiAttentionPlugin } from '../../dist/repository-ci-attention/index.js';

const OWNER = 't1mb2rg';
const NAME = 'hikari-new';
const REPOSITORY = `${OWNER}/${NAME}`;
const DELAY_MS = 1000;
const BUDGET_MS = 180_000;
const ENDPOINT = 'http://192.168.1.20:8080/v1/chat/completions';
const MODEL = 'qwen3.8-flash-next-iq2_xs';

const RUN_IDS = [38932844025, 38931770141, 38930952193]; // §13.12 五个历史红 run 中的三个

const token = execSync('gh auth token', { encoding: 'utf8' }).trim();
if (!token) throw new Error('no gh token');

// 两个 run 的完整 head_sha：identity 判定对完整 sha 做，短 sha 会 mismatch。
const runs = [];
for (const runId of RUN_IDS) {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${NAME}/actions/runs/${runId}`, {
    headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  if (json.head_sha === undefined) throw new Error(`run ${runId}: no head_sha (${res.status})`);
  runs.push({ runId, headSha: json.head_sha, conclusion: json.conclusion, headBranch: json.head_branch });
}

// ---------------------------------------------------------------------------------------------
// 观测装置：所有时间都打在这几个边界上，它们就是 cycle 的开始与结束。
// ---------------------------------------------------------------------------------------------
const T0 = Date.now();
const at = () => Date.now() - T0;
const events = []; // {at, kind, ...}
const note = (kind, extra = {}) => {
  const event = { at: at(), kind, ...extra };
  events.push(event);
  if (true) {
    // 实时输出：装配错会立刻看见，而不是等六分钟。
    const detail = kind === 'materials-read'
      ? `round#${event.round} run=${event.runId} ${event.ms}ms identity=${event.identity} jobs=${event.jobs} files=${event.changedFiles} log=${event.log}(${event.logChars})`
      : (event.line ?? event.round ?? '');
    console.log(`${String(event.at).padStart(7)}ms [${kind}] ${detail}`);
  }
};

let round = 0;
let finished = false;

const ciDefinition = {
  id: 'probe.ci',
  version: '1.0.0',
  provides: [gitHubCiService],
  setup(context) {
    context.services.provide(gitHubCiService, {
      current() {
        // 第 k 轮用第 k 个 run：round 在 awareness 里自增过，这里取上一轮的索引。
        const r = runs[Math.min(Math.max(round - 1, 0), runs.length - 1)];
        return Promise.resolve(
          Object.freeze({
            observedAt: new Date().toISOString(),
            source: 'github-ci',
            repository: REPOSITORY,
            latestRun: Object.freeze({
              kind: 'reported',
              run: Object.freeze({
                id: r.runId,
                workflow: 'ci',
                headBranch: r.headBranch ?? 'main',
                headSha: r.headSha,
                status: 'completed',
                conclusion: Object.freeze({ kind: 'reported', value: 'failure' }),
              }),
            }),
          }),
        );
      },
    });
  },
};

// 产品同构的 awareness：一轮 cycle 的第一次 acquisition，也就是这一轮的起点。
const awarenessDefinition = {
  id: 'probe.awareness',
  version: '1.0.0',
  requires: [gitHubCiService],
  provides: [repositoryCiAwarenessService],
  setup(context) {
    const ci = context.services.get(gitHubCiService);
    context.services.provide(repositoryCiAwarenessService, {
      async current() {
        round += 1;
        note('cycle-start', { round });
        const observation = await ci.current();
        const assessment = Object.freeze({
          snapshot: Object.freeze({
            snapshotAt: observation.observedAt,
            gitRepository: Object.freeze({ kind: 'unavailable' }),
            githubCi: Object.freeze({ kind: 'available', observation }),
          }),
          // 资格第一条要的就是这个 indeterminate（§13.3）。
          commitComparison: 'indeterminate',
        });
        if (process.env.PROBE_DEBUG === '1') {
          console.log('DEBUG assessment keys:', Object.keys(assessment.snapshot), 'ciKind:', assessment.snapshot.githubCi.kind,
            'latestKind:', assessment.snapshot.githubCi.observation.latestRun.kind,
            'status:', assessment.snapshot.githubCi.observation.latestRun.run.status,
            'conclusion:', JSON.stringify(assessment.snapshot.githubCi.observation.latestRun.run.conclusion),
            'runId:', assessment.snapshot.githubCi.observation.latestRun.run.id);
          const probe = detectNewFailure(observation, new Set(), new Set());
          console.log('DEBUG detectNewFailure →', JSON.stringify(probe));
        }
        return assessment;
      },
    });
  },
};

const relevanceDefinition = {
  id: 'probe.relevance',
  version: '1.0.0',
  provides: [repositoryCiRelevanceJudgeService],
  setup(context) {
    context.services.provide(repositoryCiRelevanceJudgeService, {
      judge() {
        return Promise.resolve(
          Object.freeze({ verdict: 'relevant', designation: REPOSITORY, via: Object.freeze({ kind: 'verbatim' }) }),
        );
      },
    });
  },
};

const changeActionsDefinition = {
  id: 'probe.change-actions',
  version: '1.0.0',
  provides: [repositoryChangeActionsService],
  setup(context) {
    context.services.provide(repositoryChangeActionsService, {
      pushedCommit() {
        return Promise.resolve(undefined);
      },
    });
  },
};

// 真 materials reader，包一层计时：supplement 每轮读一次材料。
const reader = createGitHubCiRunMaterialsReader({ owner: OWNER, name: NAME, token });
const materialsDefinition = {
  id: 'probe.materials',
  version: '1.0.0',
  provides: [gitHubCiRunMaterialsService],
  setup(context) {
    context.services.provide(gitHubCiRunMaterialsService, {
      async getRunMaterials(query) {
        const startedAt = at();
        const materials = await reader.getRunMaterials(query);
        note('materials-read', {
          round,
          ms: at() - startedAt,
          runId: query.runId,
          identity: materials.identity,
          jobs: materials.jobs.kind,
          changedFiles: materials.changedFiles.kind,
          log: materials.log.kind,
          logChars: materials.log.kind === 'present' ? materials.log.value.text.length : 0,
        });
        return materials;
      },
    });
  },
};

const speakingDefinition = {
  id: 'probe.speaking',
  version: '1.0.0',
  provides: [languageSpeakingService, languageDiagnosisSpeakingService],
  setup(context) {
    context.services.provide(languageSpeakingService, {
      speak(value) {
        return Object.freeze([`CI 失败：run ${value.runId}（${value.conclusion}）`]);
      },
    });
    context.services.provide(languageDiagnosisSpeakingService, {
      speak(value) {
        return Object.freeze([`建议：${value.kind}`]);
      },
    });
  },
};

const deliveryDefinition = {
  id: 'probe.delivery',
  version: '1.0.0',
  provides: [humanDeliveryService],
  setup(context) {
    context.services.provide(humanDeliveryService, {
      deliver(lines) {
        const r = round;
        const handedAt = at();
        note('deliver-start', { round: r, atMs: handedAt, messageCount: 1, lineCount: lines.length });
        note('cycle-end', { round: r, lineCount: lines.length, lines: [...lines] });
        if (r >= runs.length) {
          finished = true;
          setTimeout(() => report(), 200);
        }
        return Promise.resolve({ outcome: 'delivered' });
      },
    });
  },
};

const chronicleDefinition = {
  id: 'probe.chronicle',
  version: '1.0.0',
  provides: [chronicleService],
  setup(context) {
    const facts = [];
    context.services.provide(chronicleService, {
      append(draft) {
        const fact = Object.freeze({
          factId: `probe-${facts.length + 1}`,
          type: draft.type,
          version: draft.version,
          occurredAt: draft.occurredAt,
          recordedAt: draft.occurredAt,
          source: draft.source,
          payload: draft.payload,
        });
        facts.push(fact);
        return Promise.resolve(fact);
      },
      get(factId) {
        return Promise.resolve(facts.find((f) => f.factId === factId));
      },
      read() {
        return Promise.resolve(facts);
      },
    });
  },
};

function report() {
  if (finished && !report.done) {
    report.done = true;
    const out = { probedAt: new Date().toISOString(), delayMs: DELAY_MS, budgetMs: BUDGET_MS, endpoint: ENDPOINT, model: MODEL, runs, events };
    writeFileSync(new URL('./cycle-log.json', import.meta.url), JSON.stringify(out, null, 2));
    const starts = events.filter((e) => e.kind === 'cycle-start');
    const ends = events.filter((e) => e.kind === 'cycle-end');
    const reads = events.filter((e) => e.kind === 'materials-read');
    const lines = events.map((e) => `${String(e.at).padStart(7)}ms [${e.kind}] ${e.line ?? JSON.stringify({ ...e, at: undefined, kind: undefined })}`);
    console.log(lines.join('\n'));
    console.log('---');
    for (let i = 0; i < Math.min(starts.length, ends.length); i += 1) {
      console.log(`cycle#${starts[i].round}: total=${ends[i].at - starts[i].at}ms  (end-supplement 见 log)`);
    }
    for (let i = 1; i < starts.length; i += 1) {
      console.log(`interval #${i}→#${i + 1} = ${starts[i].at - starts[i - 1].at}ms，上一轮 cycle=${ends[i - 1].at - starts[i - 1].at}ms，delay=${DELAY_MS}`);
    }
    for (const r of reads) console.log(`materials round#${r.round}: ${r.ms}ms identity=${r.identity} logChars=${r.logChars}`);
    for (const d of events.filter((e) => e.kind === 'deliver-start')) {
      console.log(`deliver round#${d.round}: at=${d.atMs}ms messages=${d.messageCount} lines=${d.lineCount}`);
    }
    const timeouts = events.filter((e) => e.kind === 'log' && typeof e.line === 'string' && e.line.includes('超时'));
    console.log(`timeouts=${timeouts.length}${timeouts.length > 0 ? ' :: ' + timeouts.map((e) => e.line).join(' | ') : ''}`);
    for (const s2 of events.filter((e) => e.kind === 'cycle-start')) {
      const prevEnd = events.filter((e) => e.kind === 'cycle-end' && e.at <= s2.at).pop();
      if (prevEnd !== undefined) {
        console.log(`observed round#${s2.round} at ${s2.at}ms = prev cycle-end ${prevEnd.at}ms + ${s2.at - prevEnd.at}ms`);
      }
    }
    process.exit(0);
  }
}

const runtime = new Runtime();
const log = (line) => note('log', { line });

await runtime.loadPlugin(ciDefinition);
await runtime.loadPlugin(speakingDefinition);
await runtime.loadPlugin(deliveryDefinition);
await runtime.loadPlugin(chronicleDefinition);
await runtime.loadPlugin(awarenessDefinition);
await runtime.loadPlugin(relevanceDefinition);
await runtime.loadPlugin(changeActionsDefinition);
await runtime.loadPlugin(repositoryCiDiagnosisProposalPlugin);
await runtime.loadPlugin(materialsDefinition);
const supplementState = await runtime.loadPlugin(repositoryCiDiagnosisSupplementPlugin, {
  model: { endpoint: ENDPOINT, model: MODEL, budgetMs: BUDGET_MS },
  log,
});
const attentionState = await runtime.loadPlugin(repositoryCiAttentionPlugin, { delayMs: DELAY_MS, log });
console.log(`supplement=${supplementState} attention=${attentionState}`);

// 兜底：20 分钟没跑完就写已收集的部分并退出。
setTimeout(() => {
  if (!report.done) {
    console.error('TIMEOUT: 未在 20 分钟内跑完两轮，写出已有事件');
    finished = true;
    report();
  }
}, 20 * 60_000);
