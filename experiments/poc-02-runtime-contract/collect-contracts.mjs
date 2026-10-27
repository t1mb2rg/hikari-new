// 收集 src/ 下全部 defineService / defineEvent 的真实 id 与版本。
// 供 inventory.md（真实契约全集）与 key-collision.mjs（碰撞检查）共用。
// 用 indexOf 扫描而不是正则：跨行与泛型参数会让正则难写且易漏（本文件首版就漏了 8 个）。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.argv[2] ?? 'src';
const WINDOW = 400;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (entry.endsWith('.ts')) out.push(p);
  }
  return out;
}

function collect(kind) {
  const marker = `define${kind}<`;
  const found = [];
  for (const file of walk(ROOT)) {
    const text = readFileSync(file, 'utf8');
    let from = 0;
    let at;
    while ((at = text.indexOf(marker, from)) >= 0) {
      from = at + marker.length;
      const window = text.slice(at, at + WINDOW);
      const q1 = window.indexOf("'");
      const q2 = q1 < 0 ? -1 : window.indexOf("'", q1 + 1);
      if (q1 < 0 || q2 < 0) continue;
      const id = window.slice(q1 + 1, q2);
      const rest = window.slice(q2 + 1);
      const vm = /^\s*(?:,\s*(\d+))?/.exec(rest);
      const version = vm?.[1] ? Number(vm[1]) : 1;
      found.push({ id, version, file: file.split('\\').join('/') });
    }
  }
  const seen = new Set();
  return found
    .filter((c) => {
      const key = `${c.id}@${c.version}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

export const services = collect('Service');
export const events = collect('Event');

if (process.argv[1]?.endsWith('collect-contracts.mjs')) {
  console.log(`services ${services.length}`);
  for (const c of services) console.log(`  ${c.id}@${c.version}  ${c.file}`);
  console.log(`events ${events.length}`);
  for (const c of events) console.log(`  ${c.id}@${c.version}  ${c.file}`);
}
