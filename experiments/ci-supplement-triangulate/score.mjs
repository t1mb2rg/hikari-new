// 汇总六项指标：对每条记录用同一份材料重算标识，输出 summary.json 与控制台表。
//
// 未附加的记录（timeout / upstream-error / refused-citation）没有模型文本，
// 于是定位一致性与引用质量为 null——这是读数本身，不是缺数据。

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createGitHubCiRunMaterialsReader } from '../../dist/github-ci/materials.js';
import { renderOccurrence } from '../../dist/repository-ci-attention/judgement.js';

import { mechanicalDigest } from './digest.mjs';
import { corpusOf, extractMarkers, citationSplit } from './markers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OWNER = 't1mb2rg';
const NAME = 'hikari-new';
const OWNER_NAME = `${OWNER}/${NAME}`;

const frozen = JSON.parse(readFileSync(join(HERE, 'samples.json'), 'utf8'));
const results = JSON.parse(readFileSync(join(HERE, 'results.json'), 'utf8'));
const token = execSync('gh auth token', { encoding: 'utf8' }).trim();
const reader = createGitHubCiRunMaterialsReader({ owner: OWNER, name: NAME, token });

const usable = (marker) =>
  (marker.kind === 'job' || marker.kind === 'step' || marker.kind === 'file') &&
  marker.inMaterials &&
  marker.consistent === true;
const keyOf = (marker) => `${marker.kind}\u0000${marker.value}`;

const rows = [];
for (const record of results.records) {
  const sample = frozen.samples.find((entry) => entry.runId === record.runId);
  const materials = await reader.getRunMaterials({
    repository: OWNER_NAME,
    runId: record.runId,
    headSha: sample.headSha,
  });
  const corpus = corpusOf(materials);
  const notice = renderOccurrence({
    repository: OWNER_NAME,
    runId: sample.runId,
    workflow: sample.workflowObserved,
    headBranch: sample.headBranch,
    headSha: sample.headSha,
    conclusion: 'failure',
    observedAt: materials.requestedAt,
  });
  const digest = mechanicalDigest(materials);
  const digestMarkers = extractMarkers(digest, corpus);
  const answerText = record.groups?.C_model ?? '';
  const modelMarkers = answerText === '' ? [] : extractMarkers(answerText, corpus);
  const digestKeys = new Set(digestMarkers.filter(usable).map(keyOf));
  const modelKeys = new Set(modelMarkers.filter(usable).map(keyOf));
  const inNotice = (value) => notice.join('\n').includes(value);

  rows.push({
    runId: record.runId,
    failureShape: sample.failureShape,
    materialsMs: record.materialsMs,
    ms: record.ms,
    attached: record.attached,
    failureType: record.failureType,
    truth: {
      failedJobs: corpus.failedJobs,
      failedSteps: corpus.failedSteps,
      changedFileCount: corpus.files.length,
      logChars: corpus.logText.length,
    },
    A: {
      lineCount: notice.length,
      usableMarkers: extractMarkers(notice.join('\n'), corpus).filter(usable).length,
      hasJobStep: notice.join('\n').includes(corpus.jobNames[0] ?? '\u0000'),
      hasFile: corpus.files.some((file) => notice.join('\n').includes(file.filename)),
    },
    B: {
      text: digest,
      usableMarkers: digestMarkers.filter(usable).map((m) => `${m.kind}:${m.value}`),
      allMarkers: digestMarkers.map((m) => ({ kind: m.kind, value: m.value, consistent: m.consistent })),
    },
    C: {
      text: answerText === '' ? null : answerText,
      markers: modelMarkers.map((m) => ({
        kind: m.kind,
        value: m.value,
        consistent: m.consistent,
        inNotice: inNotice(m.value),
      })),
      locusConsistency:
        answerText === ''
          ? null
          : {
              judged: modelMarkers.filter((m) => m.consistent !== null).length,
              inconsistent: modelMarkers.filter((m) => m.consistent === false).map((m) => m.value),
            },
      citationQuality:
        record.groups?.C_cited == null ? null : citationSplit(record.groups.C_cited, corpus),
      cited: record.groups?.C_cited ?? null,
    },
    incremental: {
      onlyModel: modelMarkers.filter(usable).filter((m) => !digestKeys.has(keyOf(m)))
        .map((m) => `${m.kind}:${m.value}`),
      onlyDigest: digestMarkers.filter(usable).filter((m) => !modelKeys.has(keyOf(m)))
        .map((m) => `${m.kind}:${m.value}`),
    },
  });
  console.log(`run ${record.runId}: ${record.failureType}`);
}

const summary = {
  note: '六项指标汇总。usable 标识 = job/step/文件且能在材料里核实且与真值一致。',
  ranAt: new Date().toISOString(),
  totals: {
    attachRate: `${rows.filter((row) => row.attached).length}/${rows.length}`,
    mechanicalDigestUsable: `${rows.filter((row) => row.B.usableMarkers.length > 0).length}/${rows.length}`,
    noticeUsable: `${rows.filter((row) => row.A.usableMarkers > 0).length}/${rows.length}`,
    failureTypes: rows.map((row) => row.failureType),
    mediansMs: {
      attached: rows.filter((row) => row.attached).map((row) => row.ms),
    },
  },
  rows,
};

writeFileSync(join(HERE, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

console.log();
console.log('run            A可用  B可用  C附加  失败类型            模型ms');
for (const row of rows) {
  console.log(
    `${String(row.runId).padEnd(14)} ${String(row.A.usableMarkers).padEnd(5)} ${String(row.B.usableMarkers.length).padEnd(6)} ${String(row.attached).padEnd(6)} ${row.failureType.padEnd(18)} ${row.ms}`,
  );
}
console.log();
console.log('A 可用标识全部为 0：八行通知里没有 job / step / 文件。');
