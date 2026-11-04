import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  MemoryStore,
  MEMORY_FIELDS,
  MEMORY_SCHEMA_VERSION,
  inspectStoreDir,
  resolveMemoryDir,
} from '../../hikari-native/memory/store.mjs'

const dir = await mkdtemp(join(tmpdir(), 'hikari-store-smoke-'))
const out = []
const say = (...parts) => out.push(parts.join(' '))

say('version=', MEMORY_SCHEMA_VERSION, 'fields=', MEMORY_FIELDS.length)
say('resolve(storeDir)=', resolveMemoryDir({ storeDir: dir, env: {} }) === dir)
say('resolve(DSH_HOME)= has hikari/memory =', resolveMemoryDir({ env: { DSH_HOME: 'G:/work/LAB/code/_poc/home' } }).replace(/\\/g, '/').endsWith('hikari/memory'))

const store = await MemoryStore.open({ storeDir: dir, env: {} })
say('open: size=', store.size, 'lastSeq=', store.lastSeq, 'damage=', JSON.stringify(store.damage))

const r1 = await store.append({
  text: '第一条：用户要求 Hikari 的记忆跨项目共享',
  occurredAt: 1700000000000,
  source: { kind: 'conversation', ref: 'session-hikari#42' },
})
say('append1:', r1.memoryId, 'seq=', r1.seq, 'recordedAt>0=', r1.recordedAt > 0)

const r2 = await store.append({
  text: '第二条：取代第一条',
  supersedes: r1.memoryId,
})
say('append2:', r2.memoryId, 'seq=', r2.seq, 'supersedes ok=', r2.supersedes === r1.memoryId)

const before = await inspectStoreDir(dir)
say('files: jsonl=', before.hasJsonl, 'meta=', before.hasMeta, 'bytes>0=', before.bytes > 0)

await store.close()
say('closed=', store.closed)

const reopened = await MemoryStore.open({ storeDir: dir, env: {} })
say('reopen: size=', reopened.size, 'lastSeq=', reopened.lastSeq, 'damage=', JSON.stringify(reopened.damage))
say('reopen get(1).text=', reopened.get(r1.memoryId)?.text)
say('reopen all seqs=', reopened.all().map((r) => r.seq).join(','))

const raw = await readFile(join(dir, 'memory.jsonl'), 'utf8')
say('jsonl lines=', raw.trim().split('\n').length, 'endsWithNewline=', raw.endsWith('\n'))

// 尾部残片：手动追加半行，重开应识别为 tailCorrupt 并仍能读回前两条
const { appendFile } = await import('node:fs/promises')
await appendFile(join(dir, 'memory.jsonl'), '{"memoryId":"m-broken', 'utf8')
const damaged = await MemoryStore.open({ storeDir: dir, env: {} })
say('tailCorrupt: size=', damaged.size, 'damage=', JSON.stringify(damaged.damage))
const r3 = await damaged.append({ text: '第三条：残片之后' })
say('append after tail: seq=', r3.seq, 'size=', damaged.size)
const afterFix = await MemoryStore.open({ storeDir: dir, env: {} })
say('after fix: size=', afterFix.size, 'damage=', JSON.stringify(afterFix.damage))

await rm(dir, { recursive: true, force: true })
console.log(out.join('\n'))
