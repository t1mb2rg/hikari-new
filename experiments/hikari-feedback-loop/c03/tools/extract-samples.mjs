/**
 * Extract one real sample per evidence class from a session log.
 *
 * Usage: node extract-samples.mjs <session.v4.jsonl.zstd> [out.json]
 *
 * Classes: success / denied / error / pending / orphan-result.
 * Output is used by tool-evidence-fix.md as the "independent samples" evidence.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'
import {
  RESULT_DENIED,
  RESULT_ERROR,
  RESULT_PENDING,
  RESULT_SUCCESS,
  pairToolEvents,
  parseCall,
  parseResult,
  readRangeOf,
  observedRangeOf,
} from './tool-evidence.mjs'

const file = process.argv[2]
const out = process.argv[3]
if (!file) {
  console.error('usage: node extract-samples.mjs <session.v4.jsonl.zstd> [out.json]')
  process.exit(2)
}

const bytes = readFileSync(file)
const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const frames = []
let offset = 0
while (offset < bytes.length) {
  const index = bytes.indexOf(magic, offset)
  if (index === -1) break
  frames.push(index)
  offset = index + 4
}

const events = []
for (let i = 0; i < frames.length; i += 1) {
  const start = frames[i]
  const end = i + 1 < frames.length ? frames[i + 1] : bytes.length
  const text = zstdDecompressSync(bytes.subarray(start, end)).toString('utf8')
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      events.push(JSON.parse(line))
    } catch {}
  }
}

const { pairs, orphanResults } = pairToolEvents(events)
const byClass = new Map()
for (const pair of pairs) {
  const className = pair.status
  if (!byClass.has(className)) byClass.set(className, [])
  byClass.get(className).push(pair)
}

function describe(pair) {
  const range = readRangeOf(pair.call)
  const observed = observedRangeOf(pair)
  return {
    callSeq: pair.call.seq,
    callId: pair.call.callId,
    name: pair.call.name,
    rawArguments: pair.call.rawArguments,
    range,
    status: pair.status,
    resultSeq: pair.result?.seq,
    resultIsError: pair.result?.isError,
    resultText: pair.result?.text.slice(0, 300),
    observed,
  }
}

const samples = {}
for (const className of [RESULT_SUCCESS, RESULT_DENIED, RESULT_ERROR, RESULT_PENDING]) {
  const list = byClass.get(className) ?? []
  // For a success sample prefer a tool whose range can actually be verified.
  const preferred =
    className === RESULT_SUCCESS
      ? list.find((pair) => observedRangeOf(pair).kind === 'inspected') ?? list[0]
      : list[0]
  samples[className] = { count: list.length, sample: preferred ? describe(preferred) : null }
}
samples.orphanResults = {
  count: orphanResults.length,
  sample: orphanResults.length > 0 ? parseResult(orphanResults[0]) : null,
}
samples.totalCalls = pairs.length
samples.totalEvents = events.length

const json = JSON.stringify(samples, null, 2)
if (out) writeFileSync(out, `${json}\n`, 'utf8')
console.log(json)
