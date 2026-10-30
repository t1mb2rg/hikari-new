// Quick shape probe for one C-03 captures run: event type counts, tool calls,
// finding records, turn boundaries, trace request count.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const c03 = 'G:\\work\\LAB\\code\\projects\\own\\hikari-new\\experiments\\hikari-feedback-loop\\c03'
const runId = process.argv[2]
const meta = JSON.parse(readFileSync(join(c03, 'captures', `${runId}.meta.json`), 'utf8'))

function decodeSession(file) {
  const buf = readFileSync(file)
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
  const offsets = []
  let at = 0
  while ((at = buf.indexOf(magic, at)) !== -1) {
    offsets.push(at)
    at += 4
  }
  const events = []
  for (let k = 0; k < offsets.length; k += 1) {
    const end = k + 1 < offsets.length ? offsets[k + 1] : buf.length
    try {
      const out = zstdDecompressSync(buf.subarray(offsets[k], end))
      for (const line of out.toString('utf8').split('\n')) {
        if (!line.trim()) continue
        try {
          events.push(JSON.parse(line))
        } catch {}
      }
    } catch {}
  }
  return events
}

const events = decodeSession(meta.sessionFile)
const counts = {}
for (const ev of events) counts[ev.type] = (counts[ev.type] ?? 0) + 1

console.log('== event counts ==')
console.log(counts)

console.log('\n== turn boundaries ==')
for (const ev of events) {
  if (ev.type === 'turn/start' || ev.type === 'turn/end') {
    console.log(ev.seq, ev.type, JSON.stringify(ev.data))
  }
}

console.log('\n== tool calls ==')
for (const ev of events) {
  if (ev.type === 'tool/call') {
    const a = ev.data.arguments
    console.log(ev.seq, `t${ev.data.turn}/s${ev.data.step}`, ev.data.name, typeof a === 'string' ? a.slice(0, 160) : JSON.stringify(a).slice(0, 160), ev.data.callId)
  }
}

console.log('\n== findings ==')
for (const ev of events) {
  if (ev.type === 'plugin:hikari/finding') {
    console.log(ev.seq, JSON.stringify(ev.data).slice(0, 300))
  }
}

console.log('\n== tool results (isError / first 120 chars) ==')
for (const ev of events) {
  if (ev.type === 'tool/result') {
    const m = ev.data.message
    const text = (m.content ?? []).map((c) => c.text ?? '').join(' ').replace(/\s+/g, ' ').slice(0, 120)
    console.log(ev.seq, `t${ev.data.turn}`, m.toolCallId, m.isError ? 'ERR' : 'ok', text)
  }
}

const trace = join(c03, 'captures', `${runId}.jsonl`)
if (existsSync(trace)) {
  const lines = readFileSync(trace, 'utf8').split('\n').filter(Boolean)
  console.log('\n== trace requests ==', lines.length)
  for (const line of lines) {
    const r = JSON.parse(line)
    console.log(r.index, r.at, `msgs=${r.messages.length}`, `tools=${r.tools.length}`, r.model)
  }
}
