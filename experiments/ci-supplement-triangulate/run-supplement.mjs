// 三组对照实验的执行脚本：同一个 run 上取
//   A 八行通知（产品 renderOccurrence 生成，不含 job/step/文件/日志）
//   B 机械摘要（digest.mjs，零模型）
//   C 模型补充（产品当前 attach()，真材料 + 真端点）
// 并算 samples.json 里冻结的六项指标。
//
// 不重试：首次失败就是失败，原因写进 failureType。

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createGitHubCiRunMaterialsReader } from '../../dist/github-ci/materials.js';
import { renderOccurrence } from '../../dist/repository-ci-attention/judgement.js';
import { createRepositoryCiDiagnosisSupplement } from '../../dist/repository-ci-diagnosis-proposal/supplement.js';

import { mechanicalDigest } from './digest.mjs';
import { corpusOf, extractMarkers, citationSplit } from './markers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OWNER = 't1mb2rg';
const NAME = 'hikari-new';
const OWNER_NAME = `${OWNER}/${NAME}`;

const frozen = JSON.parse(readFileSync(join(HERE, 'samples.json'), 'utf8'));
const MODEL = {
  endpoint: frozen.model.endpoint,
  model: frozen.model.model,
  budgetMs: frozen.model.budgetMs,
};
// 端点偶发 502 时只补跑某一条，旧记录保留为 firstAttempt。
const ONLY = process.env.ONLY_RUN === undefined ? undefined : Number(process.env.ONLY_RUN);
const token = execSync('gh auth token', { encoding: 'utf8' }).trim();
const reader = createGitHubCiRunMaterialsReader({ owner: OWNER, name: NAME, token });

// 产品链路走到补充的唯一入口：提交比较无法判定，确定性链路没有任何建议。
const PROPOSAL = Object.freeze({ kind: 'insufficient-evidence', missing: 'commit-comparison-indeterminate' });

/** 从日志行里认出补充为什么没附加。 */
function failureType(text) {
  if (text.includes('引用不可核验')) return 'refused-citation';
  if (text.includes('超时')) return 'timeout';
  if (text.includes('端点不可用')) return 'upstream-error';
  if (text.includes('输出未完成') || text.includes('格式错误') || text.includes('无法解析')) return 'refused-shape';
  if (text.includes('未附加')) return 'not-eligible';
  return 'unknown';
}

const usable = (marker) =>
  (marker.kind === 'job' || marker.kind === 'step' || marker.kind === 'file') &&
  marker.inMaterials &&
  marker.consistent === true;

const keyOf = (marker) => `${marker.kind}\u0000${marker.value}`;

const records = [];
for (const sample of frozen.samples) {
  if (ONLY !== undefined && sample.runId !== ONLY) continue;
  console.log(`=== run ${sample.runId} (${sample.workflowObserved} @ ${sample.headBranch}) ===`);

  const materialsStartedAt = Date.now();
  const materials = await reader.getRunMaterials({
    repository: OWNER_NAME,
    runId: sample.runId,
    headSha: sample.headSha,
  });
  const materialsMs = Date.now() - materialsStartedAt;

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

  const logs = [];
  const supplement = createRepositoryCiDiagnosisSupplement({
    readMaterials: () => materials,
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
    content = await supplement.attach({ occurrence, proposal: PROPOSAL });
  } catch (thrown) {
    error = thrown instanceof Error ? thrown.message : String(thrown);
  }
  const ms = Date.now() - startedAt;
  const logText = logs.join('\n');

  // 指标
  const answerText = content?.text ?? '';
  const modelMarkers = answerText === '' ? [] : extractMarkers(answerText, corpus);
  const digestMarkers = extractMarkers(digest, corpus);
  const digestKeys = new Set(digestMarkers.filter(usable).map(keyOf));
  const modelUsable = modelMarkers.filter(usable);
  const modelKeys = new Set(modelUsable.map(keyOf));
  const incremental = modelUsable.filter((marker) => !digestKeys.has(keyOf(marker)));
  const missedByModel = digestMarkers.filter(usable).filter((marker) => !modelKeys.has(keyOf(marker)));

  const inNotice = (marker) => notice.join('\n').includes(marker.value);

  records.push({
    runId: sample.runId,
    failureShape: sample.failureShape,
    materialsMs,
    ms,
    attached: content !== undefined,
    failureType: content !== undefined ? 'attached' : failureType(logText),
    groups: {
      A_notice: notice,
      A_lineCount: notice.length,
      B_digest: digest,
      C_model: content?.text ?? null,
      C_cited: content?.cited ?? null,
    },
    metrics: {
      attachRate: content !== undefined ? 1 : 0,
      failureType: content !== undefined ? 'attached' : failureType(logText),
      ms,
      locusConsistency: {
        markers: modelMarkers.filter((m) => m.consistent !== null).length,
        inconsistent: modelMarkers.filter((m) => m.consistent === false).length,
        inconsistentValues: modelMarkers.filter((m) => m.consistent === false).map((m) => m.value),
      },
      citationQuality: content === undefined ? null : citationSplit(content.cited, corpus),
      incrementalGain: {
        modelUsable: modelUsable.length,
        digestUsable: digestMarkers.filter(usable).length,
        onlyModel: incremental.map((m) => ({ kind: m.kind, value: m.value, inNotice: inNotice(m) })),
        onlyDigest: missedByModel.map((m) => ({ kind: m.kind, value: m.value })),
      },
    },
    markers: {
      model: modelMarkers.map((m) => ({ ...m, inNotice: inNotice(m) })),
      digest: digestMarkers.map((m) => ({ ...m, inNotice: inNotice(m) })),
    },
    logs,
    ...(error === undefined ? {} : { error }),
  });

  console.log(`  通知 ${notice.length} 行 / 机械摘要 ${digest.split('\n').length} 行 / 模型 ${content === undefined ? '未附加' : '已附加'} ${ms} ms`);
  if (content !== undefined) console.log(`  模型文本：${content.text}`);
  console.log();
}

const commit = execSync('git log -1 --format=%H -- src/repository-ci-diagnosis-proposal/supplement.ts', {
  encoding: 'utf8',
}).trim();

const previous =
  ONLY === undefined || !existsSync(join(HERE, 'results.json'))
    ? undefined
    : JSON.parse(readFileSync(join(HERE, 'results.json'), 'utf8'));
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
  join(HERE, 'results.json'),
  `${JSON.stringify(
    {
      note: '三组对照：A 八行通知（产品生成）/ B 机械摘要（零模型）/ C 模型补充（真 attach）。',
      model: MODEL,
      supplementCommit: commit,
      expectedCommit: '146e53bf9feeafa1bfed9dd7b199b55b82c12fe7',
      ranAt: new Date().toISOString(),
      records: merged,
    },
    null,
    2,
  )}\n`,
  'utf8',
);
console.log(`写出 ${merged.length} 条到 results.json（supplement.ts = ${commit}）`);
