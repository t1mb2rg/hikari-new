import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MemoryStore } from '../../hikari-native/memory/store.mjs'

const dir = await mkdtemp(join(tmpdir(), 'hikari-store-debug-'))
const store = await MemoryStore.open({ storeDir: dir, env: {} })
const r1 = await store.append({ text: 'a' })
const r2 = await store.append({ text: 'b' })
await store.close()

const tail = '{"memoryId":"m-broken'
await writeFile(join(dir, 'memory.jsonl'), (await readFile(join(dir, 'memory.jsonl'), 'utf8')) + tail, 'utf8')

const raw = await readFile(join(dir, 'memory.jsonl'), 'utf8')
const lines = raw.split('\n')
console.log('raw tail:', JSON.stringify(raw.slice(-40)))
console.log('lines.length =', lines.length)
console.log('lastIndex =', lines.length - 1)
console.log('hasTrailingNewline =', lines[lines.length - 1] === '')
lines.forEach((l, i) => console.log(`  [${i}] len=${l.length} head=${JSON.stringify(l.slice(0, 20))}`))

try {
  const s = await MemoryStore.open({ storeDir: dir, env: {} })
  console.log('reopen OK size=', s.size, 'damage=', JSON.stringify(s.damage))
} catch (error) {
  console.log('reopen FAILED:', error.code, error.details)
}

await rm(dir, { recursive: true, force: true })
void r1
void r2
