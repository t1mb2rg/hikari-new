// Multi-frame zstd session decoder.
// The session file is a stream of independent zstd frames, one JSON object per
// frame. node:zlib only decodes the first frame, so split on the magic number.
import fs from 'node:fs'
import zlib from 'node:zlib'

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** Splits a buffer into zstd frames by scanning for the magic number. */
function frames(buf) {
  const starts = []
  let i = 0
  while (i < buf.length - 3) {
    if (
      buf[i] === MAGIC[0] &&
      buf[i + 1] === MAGIC[1] &&
      buf[i + 2] === MAGIC[2] &&
      buf[i + 3] === MAGIC[3]
    ) {
      starts.push(i)
      i += 4
    } else {
      i += 1
    }
  }
  const out = []
  for (let k = 0; k < starts.length; k += 1) {
    const end = k + 1 < starts.length ? starts[k + 1] : buf.length
    out.push(buf.subarray(starts[k], end))
  }
  return out
}

const path = process.argv[2]
if (!path) {
  console.error('usage: node unzstd.mjs <session.v4.jsonl.zstd>')
  process.exit(1)
}

const all = []
for (const frame of frames(fs.readFileSync(path))) {
  let text
  try {
    text = zlib.zstdDecompressSync(frame).toString('utf8')
  } catch {
    continue
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    try {
      all.push(JSON.parse(trimmed))
    } catch {
      // Skip partial frames at the tail of a live session file.
    }
  }
}

for (const e of all) process.stdout.write(JSON.stringify(e) + '\n')
