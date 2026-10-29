// 重取 baseline.json 里同三类对象的 sha256 / mtime，逐项比对，写 after.json 与 after-check.json。
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const baseline = JSON.parse(readFileSync('experiments/record-integrity/baseline.json', 'utf8'));
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

const goals = {};
for (const f of readdirSync('clear/goals').filter((n) => /^g-.*\.md$/.test(n)).sort()) {
  goals[`clear/goals/${f}`] = sha(`clear/goals/${f}`);
}

const hikariNative = {};
const walk = (dir) => {
  for (const e of readdirSync(dir).sort()) {
    const p = `${dir}/${e}`;
    if (statSync(p).isDirectory()) walk(p);
    else hikariNative[p] = sha(p);
  }
};
walk('hikari-native');

const sessionDir = join(homedir(), '.dsh/storages/session_projcache/sessions');
const sessionCacheMtime = {};
const sessionCacheSha = {};
for (const f of readdirSync(sessionDir).sort()) {
  const p = `${sessionDir}/${f}`;
  sessionCacheMtime[f] = Math.floor(statSync(p).mtimeMs / 1000);
  sessionCacheSha[f] = sha(p);
}

const after = { takenAt: new Date().toISOString(), goals, hikariNative, sessionCacheMtime, sessionCacheSha };

const diff = [];
for (const group of ['goals', 'hikariNative']) {
  const before = baseline[group] ?? {};
  const now = after[group] ?? {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(now)])) {
    if (before[k] !== now[k]) diff.push({ group, key: k, before: before[k] ?? null, after: now[k] ?? null });
  }
}

const mtimeDiff = [];
for (const k of new Set([...Object.keys(baseline.sessionCacheMtime ?? {}), ...Object.keys(after.sessionCacheMtime)])) {
  const b = baseline.sessionCacheMtime?.[k];
  const a = after.sessionCacheMtime[k];
  if (b !== a) mtimeDiff.push({ key: k, before: b ?? null, after: a ?? null });
}

const srcTest = execFileSync('git', ['diff', '--stat', '--', 'src', 'test'], { encoding: 'utf8' }).trim();
const tracked = execFileSync('git', ['ls-files', 'hikari-native'], { encoding: 'utf8' }).trim();

const report = {
  takenAt: after.takenAt,
  goalsCount: { before: Object.keys(baseline.goals ?? {}).length, after: Object.keys(goals).length },
  hikariNativeCount: { before: Object.keys(baseline.hikariNative ?? {}).length, after: Object.keys(hikariNative).length },
  contentDiff: diff,
  sessionCacheMtimeDiff: mtimeDiff,
  sessionCacheTouched: mtimeDiff.map((d) => d.key),
  srcTestDiffEmpty: srcTest === '',
  srcTestStat: srcTest,
  hikariNativeTrackedFiles: tracked === '' ? [] : tracked.split('\n'),
};

writeFileSync('experiments/record-integrity/after.json', JSON.stringify(after, null, 2));
writeFileSync('experiments/record-integrity/after-check.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
