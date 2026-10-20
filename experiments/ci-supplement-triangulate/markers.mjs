// 标识提取与一致性判定：与 experiments/ci-supplement-increment/score.mjs 同一套规则。
// 规则在 samples.json 的 markerRules 里已冻结；这里只是可执行版本，跑分前不改。

const NGRAM = 6;
const FILE_RE = /[A-Za-z0-9_./\\-]+\.(?:mjs|tsx?|jsx?|json|ya?ml|ps1|md|txt)/g;
const FAILURE_CONCLUSIONS = new Set(['failure', 'timed_out', 'startup_failure']);

export const normalise = (value) => value.replace(/\\/g, '/');

/** 材料的可核对全文与真值。 */
export function corpusOf(materials) {
  const jobs = materials.jobs.kind === 'present' ? materials.jobs.value : [];
  const files = materials.changedFiles.kind === 'present' ? materials.changedFiles.value.files : [];
  const logText = materials.log.kind === 'present' ? materials.log.value.text : '';
  const jobsText = jobs
    .map((job) => `${job.name}\n${job.steps.map((s) => `${s.name} :: ${s.conclusion}`).join('\n')}`)
    .join('\n');
  const filesText = files
    .map((file) => `${file.filename}\n${file.patch.kind === 'present' ? file.patch.text : ''}`)
    .join('\n');
  return {
    jobs,
    files,
    logText,
    // 结构性材料段：不含日志正文。用来判 cited 落在哪一段。
    structural: normalise(`${jobsText}\n${filesText}`),
    all: normalise(`${jobsText}\n${filesText}\n${logText}`),
    jobNames: jobs.map((job) => job.name),
    stepNames: jobs.flatMap((job) => job.steps.map((step) => step.name)),
    failedJobs: jobs
      .filter((job) => job.conclusion !== null && FAILURE_CONCLUSIONS.has(job.conclusion))
      .map((job) => job.name),
    failedSteps: jobs.flatMap((job) =>
      job.steps
        .filter((step) => step.conclusion !== null && FAILURE_CONCLUSIONS.has(step.conclusion))
        .map((step) => `${job.name} / ${step.name}`),
    ),
  };
}

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
  return spans.filter((span) => span.value.trim().length >= 8);
}

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

/** 从一段文本里抽出三类标识，并判它们与材料真值的关系。 */
export function extractMarkers(text, corpus) {
  const occupied = new Array(text.length).fill(false);
  const noticeAll = ''; // 本实验单独传 notice 判断，见下方 inNotice 覆盖
  const words = vocabularyHits(text, [...corpus.jobNames, ...corpus.stepNames], occupied);
  const fileMatches = [];
  FILE_RE.lastIndex = 0;
  for (let match = FILE_RE.exec(text); match !== null; match = FILE_RE.exec(text)) {
    const at = match.index;
    const end = at + match[0].length;
    for (let i = at; i < end; i += 1) occupied[i] = true;
    fileMatches.push({ at, end, value: normalise(match[0]) });
  }
  const files = [...new Map(fileMatches.map((hit) => [hit.value, hit])).values()];
  const spans = logSpans(text, corpus.logText, occupied).map((span) => ({
    ...span,
    value: span.value.trim(),
  }));

  const markers = [];
  const seen = new Map();
  const push = (marker) => {
    const key = `${marker.kind}\u0000${marker.value}`;
    const existing = seen.get(key);
    if (existing !== undefined) {
      existing.occurrences += 1;
      return;
    }
    const entry = { ...marker, occurrences: 1 };
    seen.set(key, entry);
    markers.push(entry);
  };

  for (const hit of words) {
    const word = hit.value;
    const isJob = corpus.jobNames.includes(word);
    push({
      kind: isJob ? 'job' : 'step',
      value: word,
      inMaterials: true,
      consistent: isJob
        ? corpus.failedJobs.includes(word)
        : corpus.failedSteps.some((entry) => entry.endsWith(`/ ${word}`)),
    });
  }
  for (const hit of files) {
    const file = hit.value;
    const inFiles = corpus.files.some((entry) => normalise(entry.filename) === file);
    push({
      kind: 'file',
      value: file,
      inMaterials: inFiles || normalise(corpus.logText).includes(file),
      consistent: inFiles,
    });
  }
  for (const span of spans) {
    push({ kind: 'log-span', value: span.value, inMaterials: true, consistent: null });
  }
  // noticeAll 变量保留给调用方语义：这里不判 inNotice，由调用方补。
  void noticeAll;
  return markers;
}

/** cited 里每条落在结构段还是只在日志段。 */
export function citationSplit(cited, corpus) {
  let structural = 0;
  let logOnly = 0;
  for (const item of cited) {
    const needle = normalise(item);
    if (corpus.structural.includes(needle)) structural += 1;
    else logOnly += 1;
  }
  return { total: cited.length, structural, logOnly };
}
