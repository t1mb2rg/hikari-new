// 跑 M0 / M1 / M1′ 三组真调用。不重试：一次就是一次，失败也照原样落盘。
//
// R 组不在这里：它是确定性链路的输出，已经在 samples.json 里（freeze.mjs 算的）。

import { readFileSync, writeFileSync } from 'node:fs';

const samples = JSON.parse(readFileSync(new URL('./samples.json', import.meta.url), 'utf8'));
const { endpoint, name: modelName, temperature } = samples.model;

const callModel = async (messages) => {
  const startedAt = Date.now();
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: modelName, messages, temperature, stream: false }),
  });
  const elapsedMs = Date.now() - startedAt;
  const raw = await response.text();
  if (!response.ok) {
    return { status: response.status, elapsedMs, raw, error: 'http-error' };
  }
  const parsed = JSON.parse(raw);
  const message = parsed.choices?.[0]?.message;
  return {
    status: response.status,
    elapsedMs,
    raw,
    content: message?.content ?? '',
    finishReason: parsed.choices?.[0]?.finish_reason ?? null,
    usage: parsed.usage ?? null,
  };
};

/** 把模型回答里的 JSON 抠出来：允许 ``` 围栏与前后缀文字。 */
const extractJson = (content) => {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : content;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return undefined;
  }
};

const results = { ranAt: new Date().toISOString(), model: samples.model, groups: {} };

for (const key of ['M0', 'M1', 'M1-negative']) {
  const group = samples.groups[key];
  process.stdout.write(`${key} … `);
  const answer = await callModel(group.messages);
  const parsed = answer.content === undefined ? undefined : extractJson(answer.content);
  results.groups[key] = {
    messagesSent: group.messages.length,
    historyIncluded: group.messages.length === 4,
    ...answer,
    parsed: parsed ?? null,
  };
  console.log(`${answer.elapsedMs} ms  status=${answer.status}  parsed=${parsed === undefined ? 'no' : 'yes'}`);
}

writeFileSync(new URL('./outputs.json', import.meta.url), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
console.log('wrote outputs.json');
