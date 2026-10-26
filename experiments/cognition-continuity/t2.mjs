// T2-A / T2-B：两次全新请求，不共享会话状态。
// A = 现状快照 + 新事实 + T1 认知记录（作为第三条 user 消息）
// B = 现状快照 + 新事实（与 A 的前两条消息逐字相同）
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const dir = `${ROOT}experiments/cognition-continuity/`;
const samples = JSON.parse(readFileSync(`${dir}samples.json`, 'utf8'));
const t1 = JSON.parse(readFileSync(`${dir}t1.json`, 'utf8'));

if (!t1.content) throw new Error('t1.json 没有 content，无法构造记录文本');

const apiKey = process.env.MODEL_API_KEY;
// 首轮 T2-A 在冻结的 max_tokens=2000 下 finish_reason=length、content=null（2000 个 completion token 全用在 reasoning_content）。
// 这是输出预算不足的方法缺陷，不是判断失败。第二轮把两组同时提到同一预算重跑，保持 A/B 对等；
// 首轮记录另存，不覆盖。amendment 写在 amendments.json。
const maxTokens = Number(process.env.MAX_TOKENS || samples.model.max_tokens);
const outFile = process.env.OUT_FILE || 'outputs.json';
const baseUser = `${samples.prompts.t1User}\n\n## 新事实\n\n${samples.t2.fact}`;
const recordMessage = `${samples.prompts.t2RecordHeader}\n\n${t1.content}`;

const messagesA = [
  { role: 'system', content: samples.prompts.t2System },
  { role: 'user', content: baseUser },
  { role: 'user', content: recordMessage },
];
const messagesB = [
  { role: 'system', content: samples.prompts.t2System },
  { role: 'user', content: baseUser },
];

async function call(label, messages) {
  const startedAt = Date.now();
  const body = { model: samples.model.name, temperature: samples.model.temperature, max_tokens: maxTokens, messages };
  const headers = { 'content-type': 'application/json' };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), samples.model.timeoutMs);
  const record = { label, calledAt: new Date().toISOString(), messages, requestBody: body };
  try {
    const response = await fetch(samples.model.endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
    const text = await response.text();
    Object.assign(record, { elapsedMs: Date.now() - startedAt, httpStatus: response.status, rawResponseText: text });
  } catch (error) {
    Object.assign(record, {
      elapsedMs: Date.now() - startedAt,
      failed: true,
      failureKind: error.name === 'AbortError' ? 'timeout' : 'transport-error',
      failureDetail: String(error && error.message ? error.message : error),
    });
  } finally {
    clearTimeout(timer);
  }
  if (record.rawResponseText) {
    try {
      const parsed = JSON.parse(record.rawResponseText);
      const choice = parsed.choices && parsed.choices[0];
      record.finishReason = choice ? choice.finish_reason : undefined;
      record.usage = parsed.usage;
      record.content = choice && choice.message ? choice.message.content : undefined;
      if (typeof record.content === 'string') {
        const cleaned = record.content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
        try {
          record.structured = JSON.parse(cleaned);
        } catch {
          record.structured = null;
          record.malformed = true;
        }
      } else {
        record.malformed = true;
      }
    } catch {
      record.malformed = true;
      record.malformedDetail = '响应体不是 JSON';
    }
  }
  console.log(`${label}: ${record.elapsedMs} ms · http ${record.httpStatus} · finish ${record.finishReason} · failed ${Boolean(record.failed)}`);
  return record;
}

const a = await call('t2a', messagesA);
const b = await call('t2b', messagesB);

// 逐字校验：B 的消息必须是 A 的消息去掉记录段后的结果
const identicalPrefix =
  a.messages[0].content === b.messages[0].content &&
  a.messages[1].content === b.messages[1].content &&
  b.messages.length === 2;
const bHasNoRecord = !b.messages.some((m) => String(m.content).includes(samples.prompts.t2RecordHeader) || String(m.content).includes(t1.content.slice(0, 120)));

const out = {
  frozenAt: samples.frozenAt,
  maxTokensUsed: maxTokens,
  t1RecordUsed: t1.content,
  t1Call: {
    calledAt: t1.calledAt,
    maxTokens: t1.requestBody && t1.requestBody.max_tokens,
    messages: t1.messages,
    elapsedMs: t1.elapsedMs,
    httpStatus: t1.httpStatus,
    finishReason: t1.finishReason,
    usage: t1.usage,
    content: t1.content,
    structured: t1.structured,
    note: '完整原始响应见 t1.json',
  },
  checks: { identicalPrefix, bHasNoRecord },
  t2a: a,
  t2b: b,
};
writeFileSync(`${dir}${outFile}`, JSON.stringify(out, null, 2));

console.log('--- checks ---');
console.log('前两条消息逐字相同:', identicalPrefix, '· B 不含记录:', bHasNoRecord);
console.log('--- t2a structured ---');
console.log(JSON.stringify(a.structured, null, 2));
console.log('--- t2b structured ---');
console.log(JSON.stringify(b.structured, null, 2));
