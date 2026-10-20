// 按冻结时写下的 C1–C4 判据给四组打分。规则写死在这里，不改。
//
// 判据原文见 samples.json 的 criteria 字段（冻结时写的）。

import { readFileSync, writeFileSync } from 'node:fs';

const samples = JSON.parse(readFileSync(new URL('./samples.json', import.meta.url), 'utf8'));
const outputs = JSON.parse(readFileSync(new URL('./outputs.json', import.meta.url), 'utf8'));

/** 材料文本：材料 JSON + 日志段（含边界标记），就是模型看到的那两段。 */
const materialsText = `${samples.groups.M0.messages[1].content}\n${samples.groups.M0.messages[2].content}`;

/** C2 的关键词：出现这些词，且没有同时说明当前失败仍然存在，就是失败样本。 */
const RESOLVED_WORDS = ['已解决', '已被处理', '无需再看', '无需改动', '已经修好'];

/** 提取候选标识：英文/数字/路径样式的词，以及中文引号里的内容。 */
const identify = (text) => {
  const tokens = new Set();
  for (const match of text.matchAll(/[A-Za-z0-9_][A-Za-z0-9_./:-]{3,}/g)) tokens.add(match[0]);
  for (const match of text.matchAll(/[“"`]([^”"`]{2,60})[”"`]/g)) tokens.add(match[1]);
  return [...tokens];
};

const scoreGroup = (key) => {
  const group = outputs.groups[key];
  if (group === undefined) return { key, skipped: 'R 组不调模型，无回答可判' };
  const parsed = group.parsed ?? {};
  const fields = [parsed.explains, parsed.first_look, parsed.reason, parsed.text].filter((one) => typeof one === 'string');
  const text = fields.join('\n');

  // 该组实际收到的全部文本：材料两段 + 它自己的历史段（M0 没有）。
  const sent = samples.groups[key].messages.map((one) => one.content).join('\n');

  // C1：每个标识都要能在模型收到的文本里逐字找到。
  // 同时区分「只在历史段命中」——那不是幻觉，但也不是材料里的证据，要单列。
  const tokens = identify(text);
  const missing = tokens.filter((token) => !sent.includes(token));
  const materialsOnly = `${samples.groups.M0.messages[1].content}\n${samples.groups.M0.messages[2].content}`;
  const onlyInHistory = tokens.filter((token) => !materialsOnly.includes(token) && sent.includes(token));

  // C2：误读为已解决。
  const resolvedHits = RESOLVED_WORDS.filter((word) => text.includes(word));
  const stillBroken = /仍然|仍然存在|依旧是|仍然失败|未修复|没有修复/.test(text);
  const c2Failed = resolvedHits.length > 0 && !stillBroken;

  return {
    key,
    elapsedMs: group.elapsedMs,
    parsed,
    C1: { checked: tokens.length, missing, onlyInHistory, passed: missing.length === 0 },
    C2: { resolvedWords: resolvedHits, stillBrokenStated: stillBroken, failedSample: c2Failed },
  };
};

const scored = ['M0', 'M1', 'M1-negative'].map(scoreGroup);

// C4：比较 M1 与 M1′ 相对 M0 的变化。变化只看三个结构化字段，不看措辞。
const skeleton = (one) => JSON.stringify([one.parsed?.interrupt, one.parsed?.first_look]);
const c4 = {
  m0: skeleton(scored[0]),
  m1: skeleton(scored[1]),
  m1negative: skeleton(scored[2]),
  m1Changed: skeleton(scored[1]) !== skeleton(scored[0]),
  m1negativeChanged: skeleton(scored[2]) !== skeleton(scored[0]),
};
c4.sameChange = c4.m1Changed === c4.m1negativeChanged;
c4.verdict = c4.sameChange && c4.m1Changed === false
  ? 'M1 与 M1′ 相对 M0 都没有结构化变化 → 相关历史没有可观测效应'
  : c4.sameChange
    ? 'M1 与 M1′ 相对 M0 的变化同等 → 只是多了一段文本的效应，相关历史无独立作用'
    : '仅 M1 变化而 M1′ 未变化 → 相关历史有独立作用';

outputs.criteria = { materialsChars: materialsText.length, groups: scored, C4: c4 };
writeFileSync(new URL('./outputs.json', import.meta.url), `${JSON.stringify(outputs, null, 2)}\n`, 'utf8');

for (const one of scored) {
  console.log(`${one.key}: C1 标识 ${one.C1.checked} 个，材料里查不到 ${one.C1.missing.length} 个${one.C1.missing.length ? `（${one.C1.missing.join(' / ')}）` : ''}；C2 失败样本=${one.C2.failedSample}`);
}
console.log(`C4: ${c4.verdict}`);
