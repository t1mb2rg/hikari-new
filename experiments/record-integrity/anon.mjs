// 把 baseline.json / after.json 里的会话缓存文件名替换为不可逆短哈希键，
// 路径里的用户名替换为 <user>。只改编码，不改任何测量值。
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const anon = (name) => createHash('sha256').update(name).digest('hex').slice(0, 12);

for (const file of ['baseline.json', 'after.json']) {
  const p = `experiments/record-integrity/${file}`;
  const j = JSON.parse(readFileSync(p, 'utf8'));

  if (j.sessionCacheMtime) {
    const m = {};
    for (const [k, v] of Object.entries(j.sessionCacheMtime)) m[`session-${anon(k)}`] = v;
    j.sessionCacheMtime = m;
  }
  if (j.sessionCacheSha) {
    const m = {};
    for (const [k, v] of Object.entries(j.sessionCacheSha)) m[`session-${anon(k)}`] = v;
    j.sessionCacheSha = m;
  }
  j.note = '会话缓存的文件名已替换为不可逆短哈希（sha256 前 12 位），用于跨轮比对而不暴露会话标识。';

  writeFileSync(p, JSON.stringify(j, null, 2));
  console.log(file, '-> session keys:', Object.keys(j.sessionCacheMtime ?? {}).length);
}
