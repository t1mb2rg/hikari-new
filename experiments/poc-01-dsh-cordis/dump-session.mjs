// PoC-01 / 把 DSH 的 session.v4.jsonl.zstd 解成可读的 jsonl 行。
//
// session 文件是多帧 zstd 追加写的；zstdDecompressSync 只解第一帧，
// 所以这里按 zstd 帧魔数扫描切帧再逐帧解压。
// 用法：node dump-session.mjs <session.v4.jsonl.zstd> [输出文件]
import { readFileSync, writeFileSync } from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

const [input, output] = process.argv.slice(2);
if (!input) {
  console.error('用法: node dump-session.mjs <session.v4.jsonl.zstd> [输出文件]');
  process.exit(2);
}

const buffer = readFileSync(input);
const offsets = [];
for (let i = buffer.indexOf(MAGIC); i !== -1; i = buffer.indexOf(MAGIC, i + 4)) offsets.push(i);

let text = '';
let frames = 0;
let broken = 0;
for (const [i, start] of offsets.entries()) {
  const end = i + 1 < offsets.length ? offsets[i + 1] : buffer.length;
  try {
    text += zstdDecompressSync(buffer.subarray(start, end)).toString('utf8');
    frames += 1;
  } catch {
    broken += 1;
  }
}

const lines = text.split('\n').filter(Boolean);
const rendered = lines
  .map((line) => {
    try {
      return JSON.stringify(JSON.parse(line));
    } catch {
      return line;
    }
  })
  .join('\n');

if (output) writeFileSync(output, `${rendered}\n`, 'utf8');
console.log(`frames=${frames} broken=${broken} lines=${lines.length}${output ? ` → ${output}` : ''}`);
