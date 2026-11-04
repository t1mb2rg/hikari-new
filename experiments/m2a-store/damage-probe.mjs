import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MEMORY_META, MemoryStore, resolveMemoryDir } from '../../hikari-native/memory/store.mjs'

const dir = await mkdtemp(join(tmpdir(), 'hikari-m2a-damage-'))

// 造一份有 3 条记录的存储
const store = await MemoryStore.open({ storeDir: dir, env: {}, now: () => 1000 })
await store.append({ text: '第一条' })
await store.append({ text: '第二条' })
await store.append({ text: '第三条' })
await store.close()

const report = {}

// A6：meta 文件被删
await rm(join(dir, MEMORY_META))
try {
  const reopened = await MemoryStore.open({ storeDir: dir, env: {}, now: () => 1001 })
  report.metaMissing = { ok: true, size: reopened.size, metaRepaired: reopened.damage.metaRepaired }
  await reopened.close()
} catch (error) {
  report.metaMissing = { ok: false, code: error.code, message: error.message }
}
report.metaFileBack = (await readdir(dir)).includes(MEMORY_META)

// A7：meta 内容非法
const store2 = await MemoryStore.open({ storeDir: dir, env: {}, now: () => 1002 })
await store2.close()
await writeFile(join(dir, MEMORY_META), '{ 这不是 JSON', 'utf8')
try {
  const reopened = await MemoryStore.open({ storeDir: dir, env: {}, now: () => 1003 })
  report.metaCorrupt = { ok: true, size: reopened.size }
  await reopened.close()
} catch (error) {
  report.metaCorrupt = { ok: false, code: error.code }
}

// $DSH_HOME 为相对路径
report.relativeDshHomeRejected = (() => {
  try {
    resolveMemoryDir({ env: { DSH_HOME: 'relative-home' } })
    return false
  } catch (error) {
    return error.code
  }
})()
report.relativeStoreDirRejected = (() => {
  try {
    resolveMemoryDir({ storeDir: 'relative-store' })
    return false
  } catch (error) {
    return error.code
  }
})()

console.log(JSON.stringify(report, null, 2))
