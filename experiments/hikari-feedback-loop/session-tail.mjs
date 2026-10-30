/**
 * Print the tail events of a multi-frame zstd session log.
 *
 * Usage: node session-tail.mjs <session-file> [count]
 */
import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

function frames(buffer) {
  const positions = []
  let at = buffer.indexOf(MAGIC)
  while (at !== -1) {
    positions.push(at)
    at = buffer.indexOf(MAGIC, at + 4)
  }
  return positions.map((start, index) => buffer.subarray(start, index + 1 < positions.length ? positions[index + 1] : buffer.length))
}

function decode(buffer) {
  const out = []
  for (const frame of frames(buffer)) {
    try {
      out.push(zstdDecompressSync(frame).toString('utf8'))
    } catch {
      // trailing partial frame
    }
  }
  return out.join('')
}

const file = process.argv[2]
const count = Number(process.argv[3] ?? 20)
if (!file) throw new Error('usage: node session-tail.mjs <session-file> [count]')
const text = decode(readFileSync(file))
const lines = text.split('\n').filter((line) => line.trim().length > 0)
console.log(`total lines: ${lines.length}`)
for (const line of lines.slice(-count)) {
  try {
    const event = JSON.parse(line)
    const data = event.data ?? {}
    const brief = data.message?.content?.[0]?.text?.slice(0, 120) ?? data.message?.text?.slice(0, 120) ?? ''
    console.log(`seq=${event.seq} type=${event.type} ${brief ? JSON.stringify(brief) : ''}`)
  } catch {
    console.log(line.slice(0, 200))
  }
}
