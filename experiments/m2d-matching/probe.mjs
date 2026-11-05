// M2-d 匹配口径探针：同一批 query、同一批记录，比字面匹配口径的命中数与误命中。
// 可重跑：node experiments/m2d-matching/probe.mjs [--json]
//
// 只读：读 experiments/m2c-live/store/memory.jsonl，不写任何文件。

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const STORE = path.join(ROOT, 'experiments', 'm2c-live', 'store', 'memory.jsonl')

const SEPARATOR = /[\s\p{P}\p{S}]+/u

function readRecords() {
  return fs
    .readFileSync(STORE, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line))
}

const tokensOf = (s) => s.toLowerCase().split(SEPARATOR).filter((t) => t !== '')

/** 非分隔符片段内的相邻字符对；单字片段退化为单字本身。 */
function fragmentsOf(s) {
  const out = new Set()
  for (const chunk of s.toLowerCase().split(SEPARATOR)) {
    if (chunk === '') continue
    if (chunk.length === 1) {
      out.add(chunk)
      continue
    }
    for (let i = 0; i + 1 < chunk.length; i++) out.add(chunk.slice(i, i + 2))
  }
  return out
}

const charsOf = (s) => new Set(s.toLowerCase().split(SEPARATOR).join(''))

function coverage(querySet, textSet) {
  if (querySet.size === 0) return 0
  let hit = 0
  for (const item of querySet) if (textSet.has(item)) hit += 1
  return hit / querySet.size
}

// 片段覆盖率 ≥ t；query 只有 1 个片段时退回整串子串（避免两字 query 覆盖率只有 0/1 两档）。
function fragmentMatch(query, text, t) {
  const q = fragmentsOf(query)
  const lower = text.toLowerCase()
  if (q.size <= 1) return lower.includes(query.toLowerCase())
  return coverage(q, fragmentsOf(text)) >= t
}

// 拉丁词元必须被正文的某个词元包含（`revise` 能命中 `revise_memory`，`typescript`/`npm` 不能命中 `script`/`store`），
// 中文侧仍用片段覆盖率。
const LATIN_WORD = /^[a-z0-9_.#/-]+$/u

function latinAndCjkMix(query, text, t) {
  const lower = text.toLowerCase()
  const textTokens = tokensOf(text)
  const latinTokens = tokensOf(query).filter((token) => LATIN_WORD.test(token))
  for (const token of latinTokens) {
    if (!textTokens.some((candidate) => candidate.includes(token))) return false
  }
  const cjkFragments = new Set(
    [...fragmentsOf(query)].filter((fragment) => !LATIN_WORD.test(fragment)),
  )
  if (cjkFragments.size <= 1) return lower.includes(query.toLowerCase()) || latinTokens.length > 0
  return coverage(cjkFragments, fragmentsOf(text)) >= t
}

const matchers = [
  {
    id: 'A',
    label: 'A 整串子串（现状 recall.js:122）',
    hit: (query, text) => text.toLowerCase().includes(query.toLowerCase()),
  },
  {
    id: 'B',
    label: 'B 切词多词与（全部词都要出现）',
    hit: (query, text) => {
      const tokens = tokensOf(query)
      if (tokens.length === 0) return false
      const lower = text.toLowerCase()
      return tokens.every((t) => lower.includes(t))
    },
  },
  ...['0.25', '0.30', '0.34', '0.40', '0.50'].map((t) => ({
    id: `F${t}`,
    label: `F 片段覆盖率 ≥ ${t}（1 片段时退回子串）`,
    hit: (query, text) => fragmentMatch(query, text, Number(t)),
  })),
  ...['0.25', '0.30', '0.34'].map((t) => ({
    id: `E${t}`,
    label: `E 拉丁整词 + 中文片段覆盖率 ≥ ${t}`,
    hit: (query, text) => latinAndCjkMix(query, text, Number(t)),
  })),
  {
    id: 'D50',
    label: 'D 单字覆盖率 ≥ 0.50',
    hit: (query, text) => coverage(charsOf(query), charsOf(text)) >= 0.5,
  },
  {
    id: 'D34',
    label: 'D 单字覆盖率 ≥ 0.34',
    hit: (query, text) => coverage(charsOf(query), charsOf(text)) >= 0.34,
  },
]

const queries = [
  // B1 的真实 query（原文，experiments/m2c-live/s3-recall.md:17-20）
  { q: 'hikari 记忆修订', group: 'B1', expect: 'hit' },
  { q: 'revise memory 旧记录', group: 'B1', expect: 'hit' },
  { q: '记忆 修订 约定', group: 'B1', expect: 'hit' },
  // 同上第 3 次调用，走的是 findings 侧 search_memory（文档 :19）——纳入是为了让 B1 组等于现场原文全集；
  // 两侧都拿 query 去比 record.text，所以字面可比。
  { q: '记忆修订 只能修订哪一条 旧记录是否改动', group: 'B1（findings 侧）', expect: 'hit' },
  { q: '记忆修订', group: 'B1-变体', expect: 'hit' },
  { q: '记忆', group: 'B1-变体', expect: 'hit' },
  // B2 对照（原文措辞，历史上命中过）
  { q: 'Memory 修订约定', group: 'B2', expect: 'hit' },
  { q: '修订', group: 'B2', expect: 'hit' },
  // 同义改写
  { q: '串行队列 单进程', group: '同义', expect: 'hit' },
  { q: '改了旧记录会不会被覆盖', group: '同义', expect: 'hit' },
  { q: '两次修改同一条记忆', group: '同义', expect: 'hit' },
  // 跨语言：正文全中文，纯英文问法／中英混排
  { q: 'how to revise a memory without losing history', group: '跨语言', expect: 'miss' },
  { q: 'memory 修订 规则 是什么', group: '跨语言', expect: 'hit' },
  // 无关 query：期望全 0 命中（误命中检验）
  { q: '完全不存在的词', group: '无关', expect: 'miss' },
  { q: '部署脚本 代理', group: '无关', expect: 'miss' },
  { q: 'TypeScript 编译错误', group: '无关', expect: 'miss' },
  { q: '今天的天气', group: '无关', expect: 'miss' },
  { q: 'npm test 跑多久', group: '无关', expect: 'miss' },
  { q: '会议纪要 待办事项', group: '无关', expect: 'miss' },
]

// B1 检索发生时 store 只有 1 行（s3-recall.md:34）；默认用当前 2 行，--records=1 复现当时快照。
const recordLimit = Number((process.argv.find((a) => a.startsWith('--records=')) ?? '').split('=')[1] ?? 0)
const records = recordLimit > 0 ? readRecords().slice(0, recordLimit) : readRecords()
const rows = []
for (const { q, group, expect } of queries) {
  const cells = {}
  for (const m of matchers) cells[m.id] = records.filter((r) => m.hit(q, r.text)).length
  rows.push({ query: q, group, expect, cells })
}

const summarize = (id) => {
  const hits = rows.filter((r) => r.expect === 'hit' && r.cells[id] > 0).length
  const misses = rows.filter((r) => r.expect === 'hit').length
  const falsePositives = rows.filter((r) => r.expect === 'miss' && r.cells[id] > 0).length
  return { hits, misses, falsePositives }
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ records: records.length, rows, matchers: matchers.map((m) => m.id) }, null, 2))
} else {
  console.log(`records = ${records.length}`)
  console.log(['query', '组', '期望', ...matchers.map((m) => m.id)].join(' | '))
  for (const r of rows) {
    console.log([r.query, r.group, r.expect, ...matchers.map((m) => r.cells[m.id])].join(' | '))
  }
  console.log('\n汇总（命中 = 期望命中的 query 里至少命中一条记录；误 = 期望不命中的 query 里命中了）：')
  for (const m of matchers) {
    const s = summarize(m.id)
    console.log(`${m.id.padEnd(5)} ${m.label.padEnd(42)} 命中 ${s.hits}/${s.misses}  误命中 ${s.falsePositives}`)
  }
}
