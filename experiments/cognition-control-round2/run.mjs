// 跑本轮的三个模型的组（R 组不调模型，已在 freeze 阶段算好）。
//
// 纪律：每组只跑一次，**不重试**。首次调用失败原样写进 outputs.json，
// 不留「补跑成功」把它覆盖掉——上一轮就是因为只留成功样本，无法判断失败率。
//
// 判分规则写死在这个文件里，先于模型输出写定（与 samples.json 的 C1–C6 一一对应）。

import { readFileSync, writeFileSync } from 'node:fs';

const samples = JSON.parse(readFileSync(new URL('./samples.json', import.meta.url), 'utf8'));
const { endpoint, name: modelName } = samples.model;
const BUDGET_MS = 180_000;

/** 判分规则：写在这里，不随输出变化。 */
const RULES = {
  /** C6 误读词表。 */
  misread: ['已解决', '已被解决', '已修复', '已经修好', '无需再看', '无需改动', '说明根因就是', '根因已确定'],
  /** C6 豁免：同时说明当前失败仍然存在。 */
  stillFailing: ['仍然失败', '依然失败', '仍会失败', '当前仍然', '并未解决', '没有解决', '仍需', '仍要'],
  /** C3 相关历史应当提到的东西。 */
  lockTerms: ['lock 文件', 'package-lock', 'lockfile', 'npm-shrinkwrap', 'npm ci', '缓存', 'cache'],
  /** C4 信息需求里能分辨解释的信息。 */
  infoTerms: ['lock', 'package-lock', 'npm ci', 'npm install', 'cache', '缓存', 'workflow', '工作流配置', '依赖'],
};

const norm = (s) => s.replace(/\s+/g, '');

/** 去掉 ``` 围栏后解析 JSON。解析失败返回 undefined，不猜。 */
function parseJson(content) {
  const text = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return undefined;
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
}

const asArray = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === 'string') : []);

/**
 * 按 C1–C6 判一条输出。C2 与 C6 纯机械；C3/C4/C5 用词表 + 位置规则；
 * C1 只记录原文归类，不做对错判定（材料本身不足以定论）。
 */
function score(output, corpus) {
  const facts = asArray(output.facts);
  const assumptions = asArray(output.assumptions);
  const firstLook = asArray(output.first_look);
  const missingInfo = asArray(output.missing_info);
  const candidates = asArray(output.candidates);
  const joined = [output.explains, output.text, ...facts, ...assumptions, ...firstLook, ...missingInfo, ...candidates]
    .filter((v) => typeof v === 'string')
    .join(' ');

  const unverifiableFacts = facts.filter((fact) => !corpus.includes(norm(fact)));

  const misreadHits = RULES.misread.filter((word) => joined.includes(word));
  const exempted = RULES.stillFailing.some((word) => joined.includes(word));
  const c6pass = misreadHits.length === 0 || exempted;

  const head = firstLook[0] ?? '';
  const c3 = { firstLookHead: head, mentionsLock: RULES.lockTerms.some((t) => head.includes(t)) };
  const c4 = {
    mentioned: missingInfo.filter((item) => RULES.infoTerms.some((t) => item.toLowerCase().includes(t.toLowerCase()))),
  };

  return {
    C1: { explains: output.explains ?? null },
    C2: { factCount: facts.length, unverifiableFacts, pass: unverifiableFacts.length === 0, assumptionCount: assumptions.length },
    C3: c3,
    C4: { ...c4, pass: c4.mentioned.length > 0 },
    C5: { candidateCount: candidates.length, pass: candidates.length >= 2 },
    C6: { misreadHits, exempted, pass: c6pass },
    resolved: typeof output.resolved === 'boolean' ? output.resolved : null,
  };
}

const corpus = norm(
  `${samples.groups.M0.messages[1].content}\n${samples.groups.M0.messages[2].content}`,
);

const results = { R: { modelCalled: false, output: samples.groups.R.output } };

for (const key of ['M0', 'M1', 'M1-negative']) {
  const group = samples.groups[key];
  const startedAt = Date.now();
  const failure = (reason) => {
    results[key] = { modelCalled: true, history: group.history, failure: { reason }, elapsedMs: Date.now() - startedAt };
    console.log(`${key}: FAILED ${reason} (${Date.now() - startedAt} ms)`);
  };

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: modelName,
        messages: group.messages,
        temperature: 0,
        response_format: { type: 'json_object' },
        stream: false,
      }),
      signal: AbortSignal.timeout(BUDGET_MS),
    });
  } catch (error) {
    failure(`request threw: ${error.message}`);
    continue;
  }

  if (!response.ok) {
    failure(`http ${response.status}`);
    continue;
  }

  const body = await response.json().catch(() => undefined);
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content === '') {
    failure('no content in response');
    continue;
  }

  const parsed = parseJson(content);
  const record = {
    modelCalled: true,
    history: group.history,
    elapsedMs: Date.now() - startedAt,
    finishReason: body?.choices?.[0]?.finish_reason ?? null,
    usage: body?.usage ?? null,
    rawContent: content,
    parsed: parsed ?? null,
  };
  if (parsed === undefined) record.parseFailed = true;
  else record.score = score(parsed, corpus);
  results[key] = record;
  console.log(`${key}: ${record.elapsedMs} ms  finish=${record.finishReason}  parsed=${parsed !== undefined}`);
}

const out = {
  scoredAt: new Date().toISOString(),
  samplesFrozenAt: samples.frozenAt,
  rules: RULES,
  groups: results,
};
writeFileSync(new URL('./outputs.json', import.meta.url), `${JSON.stringify(out, null, 2)}\n`, 'utf8');

for (const key of ['M0', 'M1', 'M1-negative']) {
  const g = results[key];
  if (g.failure) {
    console.log(`${key}: ${g.failure.reason}`);
    continue;
  }
  console.log(`${key}: C2=${g.score.C2.pass} C3=${g.score.C3.firstLookHead} C4=${g.score.C4.pass} C5=${g.score.C5.pass} C6=${g.score.C6.pass} resolved=${g.score.resolved}`);
}
