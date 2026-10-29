// 从 v2 会话里抽出第 16 轮（含 T15/T16）的 tool/call 参数与 assistant 正文，
// 用来核实「她到底读了哪些文件」。
import { readFileSync } from 'node:fs';

const lines = readFileSync('experiments/hikari-native-v1/tmp/v2.jsonl', 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));

let turn = 0;
const out = [];
for (const e of lines) {
  if (e.type === 'turn/start') turn += 1;
  if (turn < 14) continue;
  if (e.type === 'tool/call') {
    out.push({ turn, kind: 'call', tool: e.data?.name ?? e.data?.tool, args: e.data?.arguments });
  }
  if (e.type === 'tool/result') {
    const text = JSON.stringify(e.data?.content ?? e.data?.result ?? '').slice(0, 400);
    out.push({ turn, kind: 'result', text });
  }
}
console.log(JSON.stringify(out, null, 2));
