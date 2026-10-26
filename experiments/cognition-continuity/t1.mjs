// T1：一次独立调用。材料与提示词来自已冻结的 samples.json，本脚本不自造任何内容。
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const dir = `${ROOT}experiments/cognition-continuity/`;
const samples = JSON.parse(readFileSync(`${dir}samples.json`, 'utf8'));

const messages = [
  { role: 'system', content: samples.prompts.t1System },
  { role: 'user', content: samples.prompts.t1User },
];

async function call(messages) {
  const startedAt = Date.now();
  const body = {
    model: samples.model.name,
    temperature: samples.model.temperature,
    max_tokens: samples.model.max_tokens,
    messages,
  };
  const apiKey = process.env.MODEL_API_KEY;
  const headers = { 'content-type': 'application/json' };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`; // 只从环境变量取，不落盘、不进产物
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), samples.model.timeoutMs);
  try {
    const response = await fetch(samples.model.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    return {
      elapsedMs: Date.now() - startedAt,
      httpStatus: response.status,
      rawResponseText: text,
      requestBody: body,
    };
  } catch (error) {
    return {
      elapsedMs: Date.now() - startedAt,
      failed: true,
      failureKind: error.name === 'AbortError' ? 'timeout' : 'transport-error',
      failureDetail: String(error && error.message ? error.message : error),
      requestBody: body,
    };
  } finally {
    clearTimeout(timer);
  }
}

const result = await call(messages);
const record = {
  calledAt: new Date().toISOString(),
  frozenAt: samples.frozenAt,
  messages,
  ...result,
};

// 解析（解析失败也保留原文，标 malformed）
if (record.rawResponseText) {
  try {
    const parsed = JSON.parse(record.rawResponseText);
    const choice = parsed.choices && parsed.choices[0];
    record.finishReason = choice ? choice.finish_reason : undefined;
    record.usage = parsed.usage;
    record.content = choice && choice.message ? choice.message.content : undefined;
    record.modelReported = parsed.model;
    if (typeof record.content === 'string') {
      const cleaned = record.content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
      try {
        record.structured = JSON.parse(cleaned);
      } catch {
        record.structured = null;
        record.malformed = true;
        record.malformedDetail = 'content 不是可解析 JSON';
      }
    } else {
      record.malformed = true;
      record.malformedDetail = '缺少 choices[0].message.content';
    }
  } catch {
    record.malformed = true;
    record.malformedDetail = '响应体不是 JSON';
  }
}

writeFileSync(`${dir}t1.json`, JSON.stringify(record, null, 2));
console.log('T1 完成：', record.elapsedMs, 'ms · http', record.httpStatus, '· finish', record.finishReason, '· malformed', Boolean(record.malformed));
console.log('--- structured ---');
console.log(JSON.stringify(record.structured, null, 2));
