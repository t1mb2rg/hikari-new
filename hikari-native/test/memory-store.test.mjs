/**
 * Memory Store 测试（M2-a）。
 *
 * 覆盖 `TASK` §5 要求的 10 项。所有用例都写临时目录，不碰真实 `DSH_HOME`；
 * 时间由 `now` 注入，不依赖真实时钟。
 */
import assert from 'node:assert/strict'
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

import {
  MEMORY_JSONL,
  MEMORY_META,
  MEMORY_SCHEMA_VERSION,
  MemoryStore,
  inspectStoreDir,
  resolveMemoryDir,
  validateRecord,
} from '../memory/store.mjs'

const created = []

async function tempDir(prefix = 'hikari-memory-store-') {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  created.push(dir)
  return dir
}

async function readJsonl(dir) {
  const text = await readFile(join(dir, MEMORY_JSONL), 'utf8')
  return text.split('\n').filter((line) => line.trim().length > 0)
}

async function readMeta(dir) {
  return JSON.parse(await readFile(join(dir, MEMORY_META), 'utf8'))
}

const clockAt = (value) => () => value

after(async () => {
  for (const dir of created) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('memory store', () => {
  it('1. 空存储初始化：目录、meta 就位，jsonl 尚未创建，计数为零', async () => {
    const dir = await tempDir()
    const store = await MemoryStore.open({ storeDir: dir, env: {}, now: clockAt(1000) })

    assert.equal(store.size, 0)
    assert.equal(store.lastSeq, 0)
    assert.equal(store.closed, false)

    const meta = await readMeta(dir)
    assert.equal(meta.schemaVersion, MEMORY_SCHEMA_VERSION)
    assert.equal(meta.recordCount, 0)
    assert.equal(meta.lastSeq, 0)
    assert.equal(meta.createdAt, 1000)

    const info = await inspectStoreDir(dir)
    assert.equal(info.exists, true)
    assert.equal(info.hasMeta, true)
    // jsonl 只在第一次 append 时出现——空存储不写空文件，避免「有文件但没内容」
    // 与「从未初始化」两种情况看起来一样。
    assert.equal(info.hasJsonl, false)

    assert.equal(store.damage.tailCorrupt, null)
    assert.equal(store.damage.skippedCorruptLines, 0)
    assert.equal(store.damage.metaRepaired, false)
  })

  it('2. 记录追加：字段齐全、seq 递增、recordedAt 来自注入时钟', async () => {
    const dir = await tempDir()
    let tick = 2000
    const store = await MemoryStore.open({ storeDir: dir, env: {}, now: () => tick })

    const first = await store.append({
      text: '用户偏好中文回复',
      source: { kind: 'conversation', ref: 'session#1' },
    })
    tick = 2001
    const second = await store.append({ text: '第二条' })

    assert.match(first.memoryId, /^m-[0-9a-f-]{36}$/)
    assert.equal(first.seq, 1)
    assert.equal(first.recordedAt, 2000)
    assert.equal(first.occurredAt, null)
    assert.equal(first.validFrom, null)
    assert.equal(first.validTo, null)
    assert.equal(first.validHint, null)
    assert.equal(first.supersedes, null)
    assert.deepEqual(first.source, { kind: 'conversation', ref: 'session#1' })

    assert.equal(second.seq, 2)
    assert.equal(second.recordedAt, 2001)
    // 没给 source 时落一个明确的 unknown，而不是缺字段——validateRecord 要求十字段齐全。
    assert.deepEqual(second.source, { kind: 'unknown', ref: null })

    assert.equal(store.size, 2)
    assert.equal(store.lastSeq, 2)
    assert.equal((await readJsonl(dir)).length, 2)

    const meta = await readMeta(dir)
    assert.equal(meta.recordCount, 2)
    assert.equal(meta.lastSeq, 2)
  })

  it('3. 重启恢复：按写入顺序读回，内容逐字段相同', async () => {
    const dir = await tempDir()
    const store = await MemoryStore.open({ storeDir: dir, env: {}, now: clockAt(3000) })
    const a = await store.append({ text: 'alpha', occurredAt: 0 })
    const b = await store.append({ text: 'beta', validHint: '大约一周' })
    await store.close()

    const reopened = await MemoryStore.open({ storeDir: dir, env: {}, now: clockAt(3999) })
    assert.equal(reopened.size, 2)
    assert.deepEqual(
      reopened.all().map((r) => r.memoryId),
      [a.memoryId, b.memoryId],
    )
    assert.deepEqual(reopened.get(a.memoryId), { ...a })
    assert.deepEqual(reopened.get(b.memoryId), { ...b })
    assert.equal(reopened.get(b.memoryId).validHint, '大约一周')
    assert.equal(reopened.damage.metaRepaired, false)
  })

  it('4. 全局 ID 唯一性：批量追加不出现重复 memoryId，且都能按 id 取回', async () => {
    const dir = await tempDir()
    const store = await MemoryStore.open({ storeDir: dir, env: {}, now: clockAt(4000) })
    const ids = new Set()
    for (let i = 0; i < 64; i += 1) {
      const record = await store.append({ text: `记录 ${i}` })
      assert.equal(ids.has(record.memoryId), false)
      ids.add(record.memoryId)
    }
    assert.equal(store.size, 64)
    assert.equal(ids.size, 64)

    const reopened = await MemoryStore.open({ storeDir: dir, env: {}, now: clockAt(4001) })
    assert.equal(reopened.size, 64)
    assert.equal(reopened.all().every((r) => ids.has(r.memoryId)), true)
  })

  it('5. supersedes：保存指向；指向不存在的记忆时拒写', async () => {
    const dir = await tempDir()
    const store = await MemoryStore.open({ storeDir: dir, env: {}, now: clockAt(5000) })
    const old = await store.append({ text: '旧认识' })
    const fresh = await store.append({ text: '新认识', supersedes: old.memoryId })
    assert.equal(fresh.supersedes, old.memoryId)

    await assert.rejects(
      () => store.append({ text: '孤儿', supersedes: 'm-00000000-0000-4000-8000-000000000000' }),
      (error) => error.code === 'SUPERSEDES_UNKNOWN',
    )
    // 拒写不能留下半个记录
    assert.equal(store.size, 2)
    assert.equal((await readJsonl(dir)).length, 2)

    await store.close()
    const reopened = await MemoryStore.open({ storeDir: dir, env: {}, now: clockAt(5001) })
    assert.equal(reopened.get(fresh.memoryId).supersedes, old.memoryId)
  })

  it('6. 时间字段与 null：0 是合法时间戳，null 与缺省都要能存回来', async () => {
    const dir = await tempDir()
    const store = await MemoryStore.open({ storeDir: dir, env: {}, now: clockAt(6000) })

    const zero = await store.append({ text: '纪元零点', occurredAt: 0 })
    const explicitNull = await store.append({
      text: '明确不知道何时发生',
      occurredAt: null,
      validFrom: null,
      validTo: null,
      validHint: null,
    })
    const window = await store.append({
      text: '一段时间内有效',
      validFrom: 1_700_000_000_000,
      validTo: 1_700_600_000_000,
      validHint: '这个季度',
    })

    await store.close()
    const reopened = await MemoryStore.open({ storeDir: dir, env: {}, now: clockAt(6001) })

    assert.equal(reopened.get(zero.memoryId).occurredAt, 0)
    assert.equal(reopened.get(explicitNull.memoryId).occurredAt, null)
    assert.equal(reopened.get(explicitNull.memoryId).validHint, null)
    assert.equal(reopened.get(window.memoryId).validFrom, 1_700_000_000_000)
    assert.equal(reopened.get(window.memoryId).validTo, 1_700_600_000_000)
    assert.equal(reopened.get(window.memoryId).occurredAt, null)
  })

  it('7. JSONL 尾部损坏：识别为残片、不丢已有记录、补写后仍可继续、再次启动不重复报错', async () => {
    const dir = await tempDir()
    const store = await MemoryStore.open({ storeDir: dir, env: {}, now: clockAt(7000) })
    await store.append({ text: '第一条' })
    await store.append({ text: '第二条' })
    await store.close()

    const path = join(dir, MEMORY_JSONL)
    const beforeBytes = await readFile(path)
    const tail = '{"memoryId":"m-00000000-0000-4000-8000-'
    await appendFile(path, tail, 'utf8')
    const afterBytes = await readFile(path)
    // 残片是追加进去的，原有字节一个没动——本实现从不重写 memory.jsonl。
    assert.equal(afterBytes.subarray(0, beforeBytes.length).equals(beforeBytes), true)

    const damaged = await MemoryStore.open({ storeDir: dir, env: {}, now: clockAt(7001) })
    assert.equal(damaged.size, 2)
    assert.equal(damaged.damage.tailCorrupt.line, 3)
    assert.equal(damaged.damage.tailCorrupt.bytes, Buffer.byteLength(tail, 'utf8'))

    const third = await damaged.append({ text: '残片之后' })
    assert.equal(third.seq, 3)

    // 第二次启动：残片所在行已经在 meta 里登记过，跳过而不报错。
    const recovered = await MemoryStore.open({ storeDir: dir, env: {}, now: clockAt(7002) })
    assert.equal(recovered.size, 3)
    assert.equal(recovered.damage.tailCorrupt, null)
    assert.equal(recovered.damage.skippedCorruptLines, 1)
    assert.deepEqual(recovered.all().map((r) => r.text), ['第一条', '第二条', '残片之后'])
    // 坏字节仍在文件里——保留原始证据，不做「修复性删除」。
    assert.equal((await readFile(path, 'utf8')).includes(tail), true)

    const meta = await readMeta(dir)
    assert.deepEqual(meta.corruptLines, [3])
  })

  it('8. Schema 版本：不兼容时拒绝启动，且不改动任何文件', async () => {
    const dir = await tempDir()
    const store = await MemoryStore.open({ storeDir: dir, env: {}, now: clockAt(8000) })
    await store.append({ text: '要保住的一条' })
    await store.close()

    const metaPath = join(dir, MEMORY_META)
    const meta = await readMeta(dir)
    await writeFile(metaPath, JSON.stringify({ ...meta, schemaVersion: 999 }, null, 2), 'utf8')
    const jsonlBefore = await readFile(join(dir, MEMORY_JSONL))
    const metaBefore = await readFile(metaPath)

    await assert.rejects(
      () => MemoryStore.open({ storeDir: dir, env: {}, now: clockAt(8001) }),
      (error) => error.code === 'SCHEMA_INCOMPATIBLE'
        && error.details.found === 999
        && error.details.expected === MEMORY_SCHEMA_VERSION,
    )

    // 拒绝启动必须是无副作用的：两个文件字节都不变。
    assert.equal((await readFile(join(dir, MEMORY_JSONL))).equals(jsonlBefore), true)
    assert.equal((await readFile(metaPath)).equals(metaBefore), true)
  })

  it('9. 全局存储：路径只由 DSH_HOME 决定，不看当前工作目录，两个「项目」读写同一份', async () => {
    const home = await tempDir('hikari-memory-home-')
    const elsewhere = await tempDir('hikari-memory-cwd-')
    const expected = resolveMemoryDir({ env: { DSH_HOME: home } })
    assert.equal(expected.endsWith(join('hikari', 'memory')), true)

    // 空白的 DSH_HOME 视为未设，不能解析成相对当前目录的路径。
    const saved = process.env.DSH_HOME
    const cwd = process.cwd()
    try {
      process.env.DSH_HOME = home
      const fromHere = resolveMemoryDir({})
      process.chdir(elsewhere)
      const fromElsewhere = resolveMemoryDir({})
      assert.equal(fromHere, fromElsewhere)
      assert.equal(fromHere, expected)

      process.env.DSH_HOME = '   '
      assert.equal(resolveMemoryDir({}).includes(elsewhere), false)
      assert.equal(resolveMemoryDir({}) === expected, false)
    } finally {
      process.chdir(cwd)
      if (saved === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = saved
    }

    // 两个「不同项目目录」下的两个插件实例，看到的是同一份数据。
    const firstInstance = await MemoryStore.open({ env: { DSH_HOME: home }, now: clockAt(9000) })
    await firstInstance.append({ text: '在项目 A 里记下的' })
    await firstInstance.close()

    const secondInstance = await MemoryStore.open({ env: { DSH_HOME: home }, now: clockAt(9001) })
    assert.equal(secondInstance.size, 1)
    assert.equal(secondInstance.all()[0].text, '在项目 A 里记下的')
    await secondInstance.close()
  })

  it('10. 卸载与重新加载：close 后拒写，重新打开后数据完整且 seq 连续', async () => {
    const dir = await tempDir()
    const first = await MemoryStore.open({ storeDir: dir, env: {}, now: clockAt(10000) })
    await first.append({ text: '第一轮' })
    await first.close()

    assert.equal(first.closed, true)
    await assert.rejects(() => first.append({ text: '卸载后不该写得进去' }), (error) => error.code === 'STORE_CLOSED')

    const second = await MemoryStore.open({ storeDir: dir, env: {}, now: clockAt(10001) })
    const next = await second.append({ text: '第二轮' })
    assert.equal(next.seq, 2)
    await second.close()

    const third = await MemoryStore.open({ storeDir: dir, env: {}, now: clockAt(10002) })
    assert.equal(third.size, 2)
    assert.deepEqual(third.all().map((r) => r.seq), [1, 2])
    assert.deepEqual(third.all().map((r) => r.text), ['第一轮', '第二轮'])
    await third.close()
  })

  it('11. meta 与 jsonl 不一致时以 jsonl 为准重建，并报告 metaRepaired', async () => {
    const dir = await tempDir()
    const store = await MemoryStore.open({ storeDir: dir, env: {}, now: clockAt(11000) })
    const kept = await store.append({ text: '真实存在的一条' })
    await store.close()

    // 把 meta 改成「什么都没有」：这是元数据损坏最常见的样子（写 meta 时崩了）。
    const metaPath = join(dir, MEMORY_META)
    const meta = await readMeta(dir)
    await writeFile(metaPath, JSON.stringify({ ...meta, recordCount: 0, lastSeq: 0 }, null, 2), 'utf8')

    const repaired = await MemoryStore.open({ storeDir: dir, env: {}, now: clockAt(11001) })
    assert.equal(repaired.size, 1)
    assert.equal(repaired.lastSeq, 1)
    assert.equal(repaired.get(kept.memoryId).text, '真实存在的一条')
    assert.equal(repaired.damage.metaRepaired, true)

    // 重建后的 meta 与 jsonl 一致，下次启动不再报修复。
    const after = await readMeta(dir)
    assert.equal(after.recordCount, 1)
    assert.equal(after.lastSeq, 1)
    const again = await MemoryStore.open({ storeDir: dir, env: {}, now: clockAt(11002) })
    assert.equal(again.damage.metaRepaired, false)
  })
})

describe('memory store — 记录校验', () => {
  it('接受一条最小合法记录，拒绝缺字段与未知字段', async () => {
    const minimal = {
      memoryId: 'm-11111111-1111-4111-8111-111111111111',
      text: '内容',
      occurredAt: null,
      recordedAt: 1,
      validFrom: null,
      validTo: null,
      validHint: null,
      source: { kind: 'unknown', ref: null },
      supersedes: null,
      seq: 1,
    }
    assert.deepEqual(validateRecord(minimal), { ok: true, errors: [] })

    const missing = { ...minimal }
    delete missing.text
    assert.equal(validateRecord(missing).ok, false)

    const extra = { ...minimal, projectId: 'p1' }
    const verdict = validateRecord(extra)
    assert.equal(verdict.ok, false)
    // 任务书 §2 冻结的十个字段之外一律不收：多一个字段就是 schema 漂移。
    assert.equal(verdict.errors.some((e) => e.includes('未知字段 projectId')), true)
  })
})
