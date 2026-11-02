#!/usr/bin/env node
/**
 * 阶段 1 验证：用真实 Session 日志里的 finding 事件重放，看 renderFindings 现在输出什么。
 *
 * 数据来源：真实跑过的 Hikari session（例如 session-hikari-fb2，33 条 finding 事件），
 * 不是构造样本。只读日志，不改任何 session。
 *
 * 用法：node experiments/memory-retrieval/stage1-check.mjs <session.jsonl>
 */
import { readFileSync } from 'node:fs'
import { applyFindingRecord, renderFindings } from '../../hikari-native/world/findings.js'

const jsonlPath = process.argv[2]
if (!jsonlPath) {
  console.error('usage: node stage1-check.mjs <session.jsonl>')
  process.exit(2)
}

const lines = readFileSync(jsonlPath, 'utf8').split('\n').filter((line) => line.trim() !== '')
let state = { findings: {} }
let applied = 0
let rejected = 0
for (const line of lines) {
  let event
  try {
    event = JSON.parse(line)
  } catch {
    continue
  }
  if (event.type !== 'plugin:hikari/finding') continue
  const before = state
  state = applyFindingRecord(before, {
    type: 'plugin:hikari/finding',
    seq: event.seq,
    time: event.time,
    ignorable: true,
    data: event.data,
  })
  if (state === before) rejected += 1
  else applied += 1
}

const all = Object.values(state.findings)
const byStatus = {}
for (const finding of all) byStatus[finding.status] = (byStatus[finding.status] ?? 0) + 1
const current = all.filter((f) => f.status === 'open' || f.status === 'confirmed')
const text = renderFindings(state.findings)

console.log('=== 重放结果 ===')
console.log('finding 事件:', applied + rejected, '（被状态机拒绝:', rejected, '）')
console.log('最终记录:', all.length, byStatus)
console.log('有效（open+confirmed）:', current.length)
console.log('')
console.log('=== renderFindings 输出 ===')
console.log(text === '' ? '(空字符串)' : text)
console.log('')
console.log('=== 度量 ===')
const [body, visibility] = text.split('\n\n记忆可见性：')
console.log('body 长度:', body.length)
console.log('visible 段存在:', visibility !== undefined)
if (visibility !== undefined) console.log('visible 段长度:', `记忆可见性：${visibility}`.length)
console.log('总长度:', text.length)
console.log('body ≤ 1200:', body.length <= 1200)
// 只数真正的 finding 行（`- [f-xxx · …] …`），「已闭合 N 条」汇总是闭合计数，不算展示。
const shownInBody = body === '' ? 0 : body.split('\n').filter((line) => line.startsWith('- [')).length
console.log('实际展示条数:', shownInBody)
console.log('可见性声明的未注入条数应等于:', Math.max(0, current.length - shownInBody))
