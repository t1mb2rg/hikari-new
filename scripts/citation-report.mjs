// Citation report — a repeatable instrument, deliberately NOT a gate.
//
// Usage:  node scripts/citation-report.mjs [--verbose]
//
// Why a report and not a gate: `governance-rules-v1.md` R7.4 says line numbers are not
// identity, so a test that *enforced* line numbers would turn the thing it calls
// non-identity into identity — and it would fire hundreds of times over historical
// documents that R7.2 says to leave alone. What a machine can check without judgment is
// narrower and still useful:
//
//   1. a cited path does not exist;
//   2. a cited line is past the end of its target;
//   3. a string the citing line quotes is not found in the target file — **this one is a
//      reading list, not a defect count**: most hits are translations or paraphrases, which
//      a string compare cannot distinguish from a deleted quotation (measured: ~133 fired
//      vs ~4 real, over 194 citations);
//   4. a quoted string IS found, but not on the cited line — i.e. it drifted, and by how much.
//      This is the only bucket with a near-zero false-positive rate, and it is the useful one.
//
// Check 4 is the one that found 121 citations into `current-stage.md` (about 47% of them
// pointing at the wrong place, offsets from +8 to +1441). It works because most citations
// quote the thing they cite; a citation that quotes nothing cannot be checked this way,
// and that is reported as such rather than guessed at.
//
// See `governance-rules-v1.md` R7.5 for the measurement this instrument produced.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = process.cwd();
const verbose = process.argv.includes('--verbose');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.gitnexus', 'bin', 'obj']);
const ROOT_DOCS = ['CLAUDE.md', 'AGENTS.md', 'README.md'];

function walk(dir, filter, acc = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, filter, acc);
    else if (filter(name)) acc.push(full);
  }
  return acc;
}

const mdFiles = [
  ...walk(join(root, 'docs'), (n) => n.endsWith('.md')),
  ...ROOT_DOCS.map((f) => join(root, f)).filter(existsSync),
];

const REF = /`([A-Za-z0-9_./\\-]+\.(?:md|ts|mjs|cs|json|yml|ps1))(?::(\d+)(?:\s*-\s*(\d+))?)?`/g;

const cache = new Map();
const linesOf = (p) => {
  if (!cache.has(p)) cache.set(p, readFileSync(p, 'utf8').split('\n'));
  return cache.get(p);
};

const allFiles = walk(root, () => true);
function resolve(cited) {
  const normalized = cited.split('\\').join('/');
  const direct = join(root, normalized);
  if (existsSync(direct) && statSync(direct).isFile()) return direct;
  const matches = allFiles.filter((f) => relative(root, f).split(sep).join('/').endsWith(normalized));
  return matches.length === 1 ? matches[0] : undefined;
}

// The longest 「…」 / “…” / "…" run on a line, if it is long enough to be a quotation
// rather than a term of art. Longest, because that is the one most likely to be the quote.
function quoted(line) {
  const runs = [...line.matchAll(/「([^」]{6,})」|“([^”]{6,})”|"([^"]{6,})"/g)]
    .map((m) => m[1] ?? m[2] ?? m[3])
    .filter((s) => !s.includes('`'));
  return runs.sort((a, b) => b.length - a.length)[0];
}

const findings = { missing: [], outOfRange: [], quoteGone: [], drifted: [], anchored: 0, uncheckable: 0 };
let citations = 0;

for (const file of mdFiles) {
  const lines = linesOf(file);
  for (let i = 0; i < lines.length; i++) {
    REF.lastIndex = 0;
    let m;
    while ((m = REF.exec(lines[i])) !== null) {
      const [, cited, startRaw, endRaw] = m;
      if (!cited.includes('/')) continue; // bare filename in prose, not a citation
      if (startRaw === undefined) continue;
      citations++;
      const target = resolve(cited);
      const where = `${relative(root, file).split(sep).join('/')}:${i + 1}`;
      if (target === undefined) {
        findings.missing.push({ where, cited });
        continue;
      }
      const targetLines = linesOf(target).length;
      const start = Number(startRaw);
      if (start > targetLines || (endRaw && Number(endRaw) > targetLines)) {
        findings.outOfRange.push({ where, cited, targetLines });
        continue;
      }
      const q = quoted(lines[i]);
      if (q === undefined || q.includes('current-stage.md')) {
        findings.uncheckable++;
        continue;
      }
      const found = linesOf(target).findIndex((l) => l.includes(q));
      if (found === -1) {
        findings.quoteGone.push({ where, cited, q: q.slice(0, 60) });
      } else if (found + 1 === start) {
        findings.anchored++;
      } else {
        findings.drifted.push({
          where,
          cited,
          actual: found + 1,
          drift: found + 1 - start,
          q: q.slice(0, 50),
        });
      }
    }
  }
}

const show = (title, rows, fmt) => {
  console.log(`\n${title}: ${rows.length}`);
  for (const r of (verbose ? rows : rows.slice(0, 15))) console.log('  ' + fmt(r));
  if (!verbose && rows.length > 15) console.log(`  … ${rows.length - 15} more (--verbose)`);
};

console.log(`markdown files scanned : ${mdFiles.length}`);
console.log(`path citations w/ line : ${citations}`);
console.log(`quoted string matched  : ${findings.anchored}`);
console.log(`not machine-checkable  : ${findings.uncheckable}  (no quotation on the citing line)`);

show('cited path does not exist', findings.missing, (r) => `${r.where} → ${r.cited}`);
show('cited line past end of file', findings.outOfRange,
  (r) => `${r.where} → ${r.cited}  (target has ${r.targetLines} lines)`);
show('quoted string not found in target — NEEDS A HUMAN EYE, high false-positive rate',
  findings.quoteGone, (r) => `${r.where} → ${r.cited}  「${r.q}…」`);
console.log('  NOTE: most of these are not defects. A citing document often quotes a *translation*');
console.log('  or a *paraphrase* (a Chinese sentence describing English source), and a string compare');
console.log('  cannot tell that from a citation of text that has since been deleted. Judged by hand,');
console.log('  this bucket ran about 4 real cases out of 194 citations; mechanically it fires ~133.');
console.log('  Treat it as a reading list, never as a count of defects.');
show('quoted string found, but not on the cited line (drifted)', findings.drifted,
  (r) => `${r.where} → ${r.cited}  actual ${r.actual}  (${r.drift > 0 ? '+' : ''}${r.drift})  「${r.q}…」`);

if (findings.drifted.length > 0) {
  const drifts = findings.drifted.map((r) => r.drift);
  const byTarget = new Map();
  for (const r of findings.drifted) {
    const t = r.cited.replace(/:\d+(-\d+)?$/, '');
    byTarget.set(t, (byTarget.get(t) ?? 0) + 1);
  }
  console.log(`\ndrift range: ${Math.min(...drifts)} … ${Math.max(...drifts)}`);
  console.log('drifted citations by target:');
  for (const [t, n] of [...byTarget.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${t}`);
  }
}
