import fs from 'node:fs'

/**
 * Compares the v0 session (pre-change baseline) with the v2 replay session.
 *
 * Usage: node compare.mjs <v0.jsonl> <replay.jsonl>
 *
 * Attribution note: `user/message` carries no `turn` field, so turns are
 * counted by observation order rather than read from the event. Hikari herself
 * flagged this in T9 of the replay run; the first version of this script got it
 * wrong.
 */

const [v0Path, replayPath] = process.argv.slice(2)
if (!v0Path || !replayPath) {
  console.error('usage: node compare.mjs <v0.jsonl> <replay.jsonl>')
  process.exit(1)
}

const OBSERVATION = /前台窗口从「([^」]*)」切换到「([^」]*)」（进程 ([^）]*)）/

function readEvents(path) {
  return fs
    .readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

function turnsOf(events) {
  const turns = []
  let current = null
  for (const e of events) {
    if (e.type === 'user/message') {
      const text = (e.data?.content ?? [])
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('')
      const m = OBSERVATION.exec(text)
      if (!m) continue
      current = { index: turns.length + 1, previous: m[1], snapshot: m[2], process: m[3], texts: [], tools: [] }
      turns.push(current)
      continue
    }
    if (current === null) continue
    if (e.type === 'assistant/message') {
      const cs = e.data?.message?.content ?? []
      const text = cs
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('')
        .trim()
      if (text.length > 0) current.texts.push(text)
      continue
    }
    if (e.type === 'tool/call') {
      current.tools.push(e.data?.name ?? '?')
    }
  }
  return turns
}

// A turn is "closed as irrelevant" when the verdict words appear at the very
// start; anything after the verdict is the turn's own work and does not count.
const says = (text, pattern) => pattern.test(text.replace(/\s+/g, ' ').slice(0, 80))

function classify(turn) {
  const text = turn.texts.join('\n').trim()
  const flat = text.replace(/\s+/g, ' ')
  return {
    chars: text.length,
    tools: turn.tools.length,
    irrelevant: says(flat, /^(\*\*)?(无关|无需行动|本身无关|这次切换本身无关|这次切换无关|这条.{0,4}无关)/),
    // Narrow on purpose: only an explicit statement that something is wanted
    // and cannot be checked. Hikari herself argued in T13 that the looser
    // pattern would count a speaking habit instead of a real gap.
    infoNeed: /查不到|看不到|无法(确认|验证)|想知道|没有(任何)?需要知道/.test(flat),
    // Distinguishing "查项目" from "查实验装置" — Hikari raised this in T7.
    looksAtProject: /docs\/development|current-stage|handoff|README\.md|src\//.test(flat),
    looksAtRig: /experiments\/|session\.v4|run1-defects|compare\.mjs|cordis\.patch\.yml|hikari-native\/(replay|activation|world|perception)/.test(flat),
  }
}

const v0 = turnsOf(readEvents(v0Path))
const v2 = turnsOf(readEvents(replayPath))

console.log(`v0 turns: ${v0.length}   replay turns: ${v2.length}`)
const rows = v2.map((t, i) => {
  const c = classify(t)
  const b = v0[i] === undefined ? null : classify(v0[i])
  return { t, c, b }
})

console.log('')
console.log('| 轮 | 窗口（截断） | v0 字数 | v0 工具 | v1 字数 | v1 工具 | v1 判定 | 查项目 | 查装置 |')
console.log('|---|---|---|---|---|---|---|---|---|')
for (const { t, c, b } of rows) {
  const w = `${t.previous.slice(0, 14)}→${t.snapshot.slice(0, 14)}`
  console.log(
    `| ${t.index} | ${w} | ${b ? b.chars : '-'} | ${b ? b.tools : '-'} | ${c.chars} | ${c.tools} | ${c.irrelevant ? '无关' : '有关'} | ${c.looksAtProject ? 'Y' : ''} | ${c.looksAtRig ? 'Y' : ''} |`,
  )
}

const sum = (f) => rows.filter(f).length
const total = (f) => rows.reduce((s, r) => s + f(r), 0)

console.log('')
console.log('=== 三项计数 ===')
console.log(`轮数                       v0 ${v0.length} / v1 ${rows.length}`)
console.log(`判定「无关」               v0 ${v0.filter((t) => classify(t).irrelevant).length} / v1 ${sum((r) => r.c.irrelevant)}`)
console.log(`主动查证（工具调用次数）    v0 ${v0.reduce((s, t) => s + t.tools.length, 0)} / v1 ${total((r) => r.c.tools)}`)
console.log(`有工具调用的轮数            v0 ${v0.filter((t) => t.tools.length > 0).length} / v1 ${sum((r) => r.c.tools > 0)}`)
console.log(`出现「想知道/查不到」句式   v0 ${v0.filter((t) => classify(t).infoNeed).length} / v1 ${sum((r) => r.c.infoNeed)}`)
console.log(`输出总字数                  v0 ${v0.reduce((s, t) => s + classify(t).chars, 0)} / v1 ${total((r) => r.c.chars)}`)
console.log('')
console.log(`v1 查项目的轮数: ${sum((r) => r.c.looksAtProject)}  查实验装置的轮数: ${sum((r) => r.c.looksAtRig)}  两者都提: ${sum((r) => r.c.looksAtProject && r.c.looksAtRig)}`)
