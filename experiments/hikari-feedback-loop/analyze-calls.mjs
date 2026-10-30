// 分析 Hikari 会话里的工具调用序列（按 turn 分组）。
// 用法：node analyze-calls.mjs <session.v4.jsonl.zstd>
import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

const path = process.argv[2]
if (!path) {
  console.error('usage: node analyze-calls.mjs <session.v4.jsonl.zstd>')
  process.exit(2)
}

const bytes = readFileSync(path)
const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const frames = []
let offset = 0
while (offset < bytes.length) {
  const index = bytes.indexOf(magic, offset)
  if (index === -1) break
  frames.push(index)
  offset = index + 4
}
if (frames.length === 0) {
  console.error('no zstd frames')
  process.exit(2)
}

const events = []
for (let i = 0; i < frames.length; i += 1) {
  const start = frames[i]
  const end = i + 1 < frames.length ? frames[i + 1] : bytes.length
  const text = zstdDecompressSync(bytes.subarray(start, end)).toString('utf8')
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue
    try {
      events.push(JSON.parse(line))
    } catch {
      // skip partial line
    }
  }
}

const short = (value, n = 90) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text === undefined ? '' : text.length > n ? `${text.slice(0, n)}…` : text
}

let turn = 0
const perTurn = new Map()
for (const event of events) {
  if (event.type === 'turn/start') turn = event.data?.turn ?? turn + 1
  if (event.type === 'tool/call') {
    if (!perTurn.has(turn)) perTurn.set(turn, [])
    perTurn.get(turn).push({ kind: 'call', name: event.data?.name, args: short(event.data?.arguments ?? event.data?.input) })
  }
  if (event.type === 'tool/result') {
    if (!perTurn.has(turn)) perTurn.set(turn, [])
    perTurn.get(turn).push({ kind: event.data?.isError ? 'error' : 'result', name: event.data?.message?.toolCallId ?? '' })
  }
  if (event.type === 'plugin:hikari/finding') {
    if (!perTurn.has(turn)) perTurn.set(turn, [])
    perTurn.get(turn).push({ kind: 'finding', name: `${event.data?.findingId} ${event.data?.status}` })
  }
}

for (const [n, entries] of [...perTurn.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`turn ${n}:`)
  for (const entry of entries) console.log(`  ${entry.kind.padEnd(7)} ${entry.name} ${entry.args ?? ''}`)
}
