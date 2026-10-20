// 补充核验：C2 原规则（facts 每一项都能在材料里逐字找到）对中文复述不适用——
// 模型用中文把英文材料改写了一遍，逐字匹配必然全数落空，那读的是「语言」不是「事实」。
//
// 这里改用一个事后补充的、可机械执行的规则：**从每条 fact 里抽出 ASCII 标识符与数字**，
// 逐个检查它们在材料原文里是否出现。抽不出来的（纯中文概括）不判。
// 这条规则是看到输出之后写的，只作辅助读数，不用于裁决；报告里会标明这一点。

import { readFileSync, writeFileSync } from 'node:fs';

const samples = JSON.parse(readFileSync(new URL('./samples.json', import.meta.url), 'utf8'));
const outputs = JSON.parse(readFileSync(new URL('./outputs.json', import.meta.url), 'utf8'));

const baseCorpus = `${samples.groups.M0.messages[1].content}\n${samples.groups.M0.messages[2].content}`.toLowerCase();
/** 每组能引用的语料 = 材料 + 日志 + 该组自己那条历史消息（若有）。 */
const corpusFor = (key) => {
  const history = samples.groups[key]?.messages?.[3]?.content;
  return history === undefined ? baseCorpus : `${baseCorpus}\n${history}`.toLowerCase();
};

/** 从一句 fact 里抽出应当能在材料里找到的 ASCII 标识符与数字。 */
function tokens(text) {
  const found = text.match(/[A-Za-z0-9.][A-Za-z0-9_.@/-]{2,}/g) ?? [];
  return [...new Set(found.map((t) => t.replace(/[.\-_]+$/, '').toLowerCase()))].filter((t) => t.length >= 3);
}

const report = {};
for (const key of ['M0', 'M1', 'M1-negative']) {
  const group = outputs.groups[key];
  if (group.failure || !group.score) {
    report[key] = { skipped: true, reason: group.failure?.reason ?? 'parsed undefined' };
    continue;
  }
  const corpus = corpusFor(key);
  const rows = (group.parsed.facts ?? []).map((fact) => {
    const list = tokens(fact);
    const missing = list.filter((token) => !corpus.includes(token));
    return { fact, tokens: list, missing, verdict: list.length === 0 ? 'no-token' : missing.length === 0 ? 'ok' : 'unbacked' };
  });
  report[key] = {
    factCount: rows.length,
    ok: rows.filter((r) => r.verdict === 'ok').length,
    noToken: rows.filter((r) => r.verdict === 'no-token').length,
    unbacked: rows.filter((r) => r.verdict === 'unbacked'),
  };
}

writeFileSync(new URL('./c2-tokens.json', import.meta.url), `${JSON.stringify({ note: '事后补充规则，仅作辅助读数', groups: report }, null, 2)}\n`, 'utf8');

for (const [key, value] of Object.entries(report)) {
  if (value.skipped) {
    console.log(`${key}: skipped`);
    continue;
  }
  console.log(`${key}: facts=${value.factCount} ok=${value.ok} no-token=${value.noToken} unbacked=${value.unbacked.length}`);
  for (const row of value.unbacked) console.log(`   ✗ ${row.fact}  missing=${row.missing.join(',')}`);
}
