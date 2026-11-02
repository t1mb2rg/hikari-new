#!/usr/bin/env node
/**
 * 阶段 2 验证：用真实 Session 日志的 finding 事件重放，然后跑几次 search_memory。
 *
 * 只读日志，不改任何 session；不调模型。查询串是人工挑的，用来观察
 * 召回、预算、分页三项实际行为。
 *
 * 用法：node experiments/memory-retrieval/stage2-check.mjs <session.jsonl>
 */
import { readFileSync } from 'node:fs'
import { applyFindingRecord, searchFindings, SEARCH_BUDGET_CHARS } from '../../hikari-native/world/findings.js'

const jsonlPath = process.argv[2]
if (!jsonlPath) {
  console.error('usage: node stage2-check.mjs <session.jsonl>')
  process.exit(2)
}

const lines = readFileSync(jsonlPath, 'utf8').split('\n').filter((line) => line.trim() !== '')
let state = { findings: {} }
for (const line of lines) {
  let event
  try {
    event = JSON.parse(line)
  } catch {
    continue
  }
  if (event.type !== 'plugin:hikari/finding') continue
  state = applyFindingRecord(state, {
    type: 'plugin:hikari/finding',
    seq: event.seq,
    time: event.time,
    ignorable: true,
    data: event.data,
  })
}

const all = Object.values(state.findings)
console.log('记录:', all.length, '条；有效:', all.filter((f) => f.status === 'open' || f.status === 'confirmed').length)
console.log('')

const queries = ['findings.js 证据', '窗口', 'cache 安装', '', '完全找不到的 zzz']
for (const query of queries) {
  const answer = searchFindings(state.findings, { query })
  const bytes = JSON.stringify(answer).length
  console.log(`=== query: ${JSON.stringify(query)} ===`)
  console.log(`total=${answer.total} shown=${answer.shown} hasMore=${answer.hasMore} nextOffset=${answer.nextOffset} 长度=${bytes}`)
  for (const item of answer.results) {
    console.log(`  [${item.id} ${item.at} ${item.status} ${item.chars}字] ${item.line.slice(0, 70)}`)
  }
  console.log('')
}

// 分页：拿一个召回多的查询，逐页走到底
const paged = '证据'
let offset = 0
let pages = 0
const seen = []
console.log(`=== 分页走查 query=${JSON.stringify(paged)} ===`)
while (pages < 6) {
  const answer = searchFindings(state.findings, { query: paged, limit: 2, offset })
  console.log(`offset=${offset} shown=${answer.shown} hasMore=${answer.hasMore} nextOffset=${answer.nextOffset}`)
  seen.push(...answer.results.map((r) => r.id))
  pages += 1
  if (!answer.hasMore) break
  offset = answer.nextOffset
}
console.log(`共翻 ${pages} 页，累计 ${seen.length} 条，去重后 ${new Set(seen).size} 条`)
console.log('')

// 预算压力：limit 拉到上限 20
const heavy = searchFindings(state.findings, { query: '的', limit: 20 })
console.log('=== limit=20 预算压力 ===')
console.log(`total=${heavy.total} shown=${heavy.shown} 长度=${JSON.stringify(heavy).length} 预算=${SEARCH_BUDGET_CHARS} 合规=${JSON.stringify(heavy).length <= SEARCH_BUDGET_CHARS}`)
