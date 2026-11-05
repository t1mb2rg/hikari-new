// M2-d 交叉核对：把**实施后的** `matchStrength` 拿去重放探针那 19 条 query，逐条对上
// `matching-probe.md` 矩阵里 `E.25` 那一列。
//
// 探针里的 `latinAndCjkMix` 是独立实现（用于选口径）；这份脚本用的是真正会被装进插件的
// 函数，所以它能回答「选出来的口径和落地的口径是不是同一件事」。
//
//   node experiments/m2d-matching/crosscheck.mjs
import { readFileSync } from 'node:fs'

import { matchStrength } from '../../hikari-native/memory/recall.js'

const STORE = new URL('../m2c-live/store/memory.jsonl', import.meta.url)
const records = readFileSync(STORE, 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line))

// `matching-probe.md:33-53` 的 `E.25` 列（两行记录时的命中数，0–2）。
const QUERIES = [
  ['hikari 记忆修订', 'B1', 'hit', 2],
  ['revise memory 旧记录', 'B1', 'hit', 2],
  ['记忆 修订 约定', 'B1', 'hit', 2],
  ['记忆修订 只能修订哪一条 旧记录是否改动', 'B1（findings 侧）', 'hit', 2],
  ['记忆修订', 'B1-变体', 'hit', 2],
  ['记忆', 'B1-变体', 'hit', 0],
  ['Memory 修订约定', 'B2', 'hit', 2],
  ['修订', 'B2', 'hit', 2],
  ['串行队列 单进程', '同义', 'hit', 2],
  ['改了旧记录会不会被覆盖', '同义', 'hit', 2],
  ['两次修改同一条记忆', '同义', 'hit', 0],
  ['how to revise a memory without losing history', '跨语言', 'miss', 0],
  ['memory 修订 规则 是什么', '跨语言', 'hit', 2],
  ['完全不存在的词', '无关', 'miss', 0],
  ['部署脚本 代理', '无关', 'miss', 0],
  ['TypeScript 编译错误', '无关', 'miss', 0],
  ['今天的天气', '无关', 'miss', 0],
  ['npm test 跑多久', '无关', 'miss', 0],
  ['会议纪要 待办事项', '无关', 'miss', 0],
]

let failed = 0
const rows = []
for (const [query, group, expect, wantHits] of QUERIES) {
  const strengths = records.map((record) => matchStrength(query, record.text))
  const hits = strengths.filter((strength) => strength !== null).length
  const ok = hits === wantHits
  if (!ok) failed += 1
  rows.push({
    query,
    group,
    expect,
    want: wantHits,
    got: hits,
    strengths: strengths.map((strength) => (strength === null ? '—' : strength.toFixed(2))).join(' / '),
    ok,
  })
}

const width = (text, size) => String(text).padEnd(size, ' ')
console.log(`${width('query', 44)}${width('组', 16)}期望 探针 实施 强度`)
for (const row of rows) {
  console.log(
    `${width(row.query, 44)}${width(row.group, 16)}${width(row.expect, 5)}${width(row.want, 5)}` +
      `${width(row.got, 5)}${row.strengths}${row.ok ? '' : '   ← 不一致'}`,
  )
}

const wantHits = rows.filter((row) => row.expect === 'hit').length
const gotHits = rows.filter((row) => row.expect === 'hit' && row.got > 0).length
const falsePositives = rows.filter((row) => row.expect === 'miss' && row.got > 0).length
console.log(
  `\n命中 ${gotHits}/${wantHits}，误命中 ${falsePositives}，逐格不一致 ${failed}` +
    `${failed === 0 && falsePositives === 0 ? ' → 实施与探针同口径' : ''}`,
)
process.exitCode = failed === 0 && falsePositives === 0 ? 0 : 1
