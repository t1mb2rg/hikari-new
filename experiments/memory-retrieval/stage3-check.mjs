#!/usr/bin/env node
/**
 * 阶段 3 验证：真实 Session 数据上跑完整链路 —— search 找候选，再 read 一条。
 *
 * 只读日志，不改任何 session；不调模型。重点看三件事：
 *   1. search 给的 chars 与 read 的 totalChars 是否一致（模型据此前判断代价）
 *   2. status 与 statusReading 是否成对出现，措辞有没有说过头
 *   3. evidence 指针是否原样带出（它回答「从哪儿来」，不是「仍然成立」）
 *
 * 用法：node experiments/memory-retrieval/stage3-check.mjs <session.jsonl>
 */
import { readFileSync } from 'node:fs'
import { applyFindingRecord, readFinding, searchFindings } from '../../hikari-native/world/findings.js'

const jsonlPath = process.argv[2]
if (!jsonlPath) {
  console.error('usage: node stage3-check.mjs <session.jsonl>')
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

const found = searchFindings(state.findings, { query: 'findings.js 证据' })
console.log(`search → total=${found.total} shown=${found.shown}`)
console.log('')

let checked = 0
let mismatch = 0
for (const candidate of found.results) {
  const detail = readFinding(state.findings, { id: candidate.id })
  const sameChars = detail.totalChars === candidate.chars
  if (!sameChars) mismatch += 1
  checked += 1
  console.log(`--- read ${detail.id} ---`)
  console.log(`search.chars=${candidate.chars}  read.totalChars=${detail.totalChars}  一致=${sameChars}`)
  console.log(`status=${detail.status} / ${detail.statusReading}`)
  console.log(`provenance=${detail.provenance}  evidence=${JSON.stringify(detail.evidence)}`)
  console.log(`scope.project=${detail.scope.project}`)
  console.log(`truncated=${detail.truncated} offset=${detail.offset} limit=${detail.limit}`)
  console.log(`text[:60]=${detail.text.slice(0, 60)}`)
  console.log('')
}

console.log(`校验 ${checked} 条，chars 不一致 ${mismatch} 条`)

// 未知 id 必须报错而不是静默返回空
try {
  readFinding(state.findings, { id: 'f-999' })
  console.log('未知 id：没有报错 ← 不符合预期')
} catch (error) {
  console.log(`未知 id 报错：${error.message}`)
}
