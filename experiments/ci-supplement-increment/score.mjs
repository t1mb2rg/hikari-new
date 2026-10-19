// 判分：把「补充段有没有说出通知里没有的东西」变成可复现的计数。
//
// 规则写死在这里，跑完不改：
//   标识 = ①材料词表里的 job/step 名 ②文件路径 ③与日志逐字相同的片段（6-gram 连续命中）
//   对每个标识判：出现在 8 行基线通知里吗 / 逐字出现在材料里吗 / 若为 job 或 step，它在失败集合里吗
//   幻觉 = 文件路径形态但材料里查不到；以及被引号包住、材料里查不到的片段
//
// 真值来自 materials.json（job/step conclusion），逐字核对用的材料现取（run 固定，材料不变）。

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createGitHubCiRunMaterialsReader } from '../../dist/github-ci/materials.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OWNER = 't1mb2rg';
const NAME = 'hikari-new';
const NGRAM = 6;
const FILE_RE = /[A-Za-z0-9_./\\-]+\.(?:mjs|tsx?|jsx?|json|ya?ml|ps1|md|txt)/g;
const FAILURE_CONCLUSIONS = new Set(['failure', 'timed_out', 'startup_failure']);

const truth = JSON.parse(readFileSync(join(HERE, 'materials.json'), 'utf8'));
const outputs = JSON.parse(readFileSync(join(HERE, 'outputs.json'), 'utf8'));
const token = execSync('gh auth token', { encoding: 'utf8' }).trim();
const reader = createGitHubCiRunMaterialsReader({ owner: OWNER, name: NAME, token });

const normalise = (value) => value.replace(/\\/g, '/');

/** 材料的可核对全文：jobs 投影 + 改动文件 + 日志正文。 */
function corpusOf(materials) {
  const jobs = materials.jobs.kind === 'present' ? materials.jobs.value : [];
  const jobsText = jobs
    .map(
      (job) =>
        `${job.name}\n${job.steps.map((step) => `${step.name} :: ${step.conclusion}`).join('\n')}`,
    )
    .join('\n');
  const files = materials.changedFiles.kind === 'present' ? materials.changedFiles.value.files : [];
  const filesText = files
    .map((file) => `${file.filename}\n${file.patch.kind === 'present' ? file.patch.text : ''}`)
    .join('\n');
  const logText = materials.log.kind === 'present' ? materials.log.value.text : '';
  return {
    jobs,
    files,
    logText,
    all: `${jobsText}\n${filesText}\n${logText}`,
    jobNames: jobs.map((job) => job.name),
    stepNames: jobs.flatMap((job) => job.steps.map((step) => step.name)),
    failedJobs: jobs
      .filter((job) => job.conclusion !== null && FAILURE_CONCLUSIONS.has(job.conclusion))
      .map((job) => job.name),
    failedSteps: jobs
      .flatMap((job) =>
        job.steps
          .filter((step) => step.conclusion !== null && FAILURE_CONCLUSIONS.has(step.conclusion))
          .map((step) => `${job.name} / ${step.name}`),
      ),
  };
}

/** 6-gram 连续命中：返回 text 里与 logText 逐字相同的片段区间（跳过已占用的区间）。 */
function logSpans(text, logText, occupied) {
  if (logText.length < NGRAM) return [];
  const grams = new Set();
  for (let i = 0; i + NGRAM <= logText.length; i += 1) grams.add(logText.slice(i, i + NGRAM));
  const hit = new Array(text.length).fill(false);
  for (let i = 0; i + NGRAM <= text.length; i += 1) {
    if (grams.has(text.slice(i, i + NGRAM))) {
      for (let k = i; k < i + NGRAM; k += 1) if (!occupied[k]) hit[k] = true;
    }
  }
  const spans = [];
  let start = -1;
  for (let i = 0; i <= text.length; i += 1) {
    if (i < text.length && hit[i]) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      spans.push({ at: start, end: i, value: text.slice(start, i) });
      start = -1;
    }
  }
  // 只有两侧都被打断的完整片段才算「被引用的日志原文」；被标点/换行切断的碎片不算。
  return spans.filter((span) => span.value.trim().length >= 8);
}

/** 词表里最长的先匹配，区间不重复占用，避免「Build and test」里的 test 被算成 job 名。 */
function vocabularyHits(text, words, occupied) {
  const hits = [];
  for (const word of [...new Set(words)].sort((a, b) => b.length - a.length)) {
    if (word.length === 0) continue;
    let from = 0;
    for (;;) {
      const at = text.indexOf(word, from);
      if (at < 0) break;
      const end = at + word.length;
      const before = at === 0 ? '' : text[at - 1];
      const after = end >= text.length ? '' : text[end];
      const boundary = (ch) => ch === '' || !/[A-Za-z0-9_/\\-]/.test(ch);
      let free = true;
      for (let i = at; i < end; i += 1) if (occupied[i]) free = false;
      if (boundary(before) && boundary(after) && free) {
        for (let i = at; i < end; i += 1) occupied[i] = true;
        hits.push({ at, end, value: word });
      }
      from = end;
    }
  }
  return hits;
}

const rows = [];
for (const record of outputs.records) {
  const runTruth = truth.runs.find((run) => run.runId === record.runId);
  const materials = await reader.getRunMaterials({
    repository: runTruth ? `${OWNER}/${NAME}` : `${OWNER}/${NAME}`,
    runId: record.runId,
    headSha: runTruth.headSha,
  });
  const corpus = corpusOf(materials);
  const text = record.text ?? '';
  const notice = (runTruth?.notice ?? []).join('\n');
  const corpusAll = normalise(corpus.all);
  const noticeAll = normalise(notice);

  const occupied = new Array(text.length).fill(false);

  // ① job / step 名
  const words = vocabularyHits(text, [...corpus.jobNames, ...corpus.stepNames], occupied);
  // ② 文件路径（先占区间，避免同一处文件被日志片段再算一遍）
  const fileMatches = [];
  FILE_RE.lastIndex = 0;
  for (let match = FILE_RE.exec(text); match !== null; match = FILE_RE.exec(text)) {
    const at = match.index;
    const end = at + match[0].length;
    for (let i = at; i < end; i += 1) occupied[i] = true;
    fileMatches.push({ at, end, value: normalise(match[0]) });
  }
  const files = [...new Map(fileMatches.map((hit) => [hit.value, hit])).values()];
  // ③ 日志原文片段（跳过①②已占用的位置）
  const spans = logSpans(text, corpus.logText, occupied).map((span) => ({
    ...span,
    value: span.value.trim(),
  }));

  const markers = [];
  const seen = new Set();
  const pushMarker = (marker) => {
    const key = `${marker.kind}\u0000${marker.value}`;
    if (seen.has(key)) {
      const existing = markers.find((entry) => `${entry.kind}\u0000${entry.value}` === key);
      existing.occurrences += 1;
      return;
    }
    seen.add(key);
    markers.push({ ...marker, occurrences: 1 });
  };

  for (const hit of words) {
    const word = hit.value;
    const isJob = corpus.jobNames.includes(word);
    pushMarker({
      kind: isJob ? 'job' : 'step',
      value: word,
      inNotice: noticeAll.includes(word),
      inMaterials: true,
      consistent: isJob
        ? corpus.failedJobs.includes(word)
        : corpus.failedSteps.some((entry) => entry.endsWith(`/ ${word}`)),
    });
  }
  for (const hit of files) {
    const file = hit.value;
    const inLog = normalise(corpus.logText).includes(file);
    const inFiles = corpus.files.some((entry) => normalise(entry.filename) === file);
    pushMarker({
      kind: 'file',
      value: file,
      inNotice: noticeAll.includes(file),
      inMaterials: inFiles || inLog,
      consistent: inFiles,
    });
  }
  for (const span of spans) {
    pushMarker({
      kind: 'log-span',
      value: span.value,
      inNotice: noticeAll.includes(span.value),
      inMaterials: true,
      consistent: null,
    });
  }

  const hallucinations = markers.filter(
    (marker) => marker.inMaterials === false || (marker.kind === 'file' && !marker.consistent),
  );

  rows.push({
    runId: record.runId,
    attached: record.attached,
    ms: record.ms,
    noticeLines: runTruth?.noticeLineCount ?? null,
    textChars: text.length,
    text,
    markerCount: markers.length,
    inNoticeCount: markers.filter((marker) => marker.inNotice).length,
    notInMaterialsCount: markers.filter((marker) => marker.inMaterials === false).length,
    hallucinationCount: hallucinations.length,
    hallucinations,
    consistentCount: markers.filter((marker) => marker.consistent === true).length,
    inconsistent: markers.filter((marker) => marker.consistent === false),
    markers,
    truth: {
      failedJobs: corpus.failedJobs,
      failedSteps: corpus.failedSteps,
      changedFiles: corpus.files.map((entry) => normalise(entry.filename)),
    },
    cited: record.cited ?? [],
  });
  console.log(
    `run ${record.runId}: 标识 ${markers.length} 个，通知内 ${rows.at(-1).inNoticeCount}，` +
      `材料里查不到 ${rows.at(-1).notInMaterialsCount}，与真值不一致 ${rows.at(-1).inconsistent.length}`,
  );
  for (const marker of markers) {
    console.log(
      `  [${marker.kind}] ${JSON.stringify(marker.value)} notice=${marker.inNotice} ` +
        `materials=${marker.inMaterials} truth=${marker.consistent}`,
    );
  }
}

writeFileSync(
  join(HERE, 'score.json'),
  `${JSON.stringify({ rules: { NGRAM, FILE_RE: String(FILE_RE) }, rows }, null, 2)}\n`,
  'utf8',
);
console.log('\n写出 score.json');
