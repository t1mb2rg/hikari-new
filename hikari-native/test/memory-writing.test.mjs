// M2-b 测试：write_memory / revise_memory 的十二项验收。
// 跑法：node --test hikari-native/test/memory-writing.test.mjs
//
// 两层夹具，按"这一项验收到底在验谁"分开：
// 1) 直接夹具（`openTools`）：真 `MemoryStore` + 真的 `installMemoryWriteTools`，只把
//    `ctx.tools.register` 换成一个 Map。写入工具只依赖 store，所以这一层能拿到 store 的
//    真实读数（size / all / 重开后逐字段比较），不必绕插件生命周期。
// 2) 插件夹具（`boot`）：与 `memory.test.mjs` 同构的真 Cordis + 假 sessions/tools，用来验
//    "注册随 fiber 回滚"与"检索工具、World findings 不受影响"——这两项只有在插件层才成立。
//
// 与任务书 §4 的十二项一一对应；用例名前缀 `[n]` 方便核对。
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'

import { Context, Service } from '@deepseek-ai/cordis'

import { apply as worldApply, name as worldName, inject as worldInject } from '../world/index.js'
import { apply as memoryApply, name as memoryName, inject as memoryInject } from '../memory/index.js'
import { MemoryStore } from '../memory/store.mjs'
import { MAX_TEXT, installMemoryWriteTools } from '../memory/writing.js'

const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/[\\/]+$/, '')
const SESSION_ID = 'session-hikari'

const storeDirs = []
async function freshStoreDir() {
  const dir = await mkdtemp(join(tmpdir(), 'hikari-memory-writing-'))
  storeDirs.push(dir)
  return dir
}
after(async () => {
  for (const dir of storeDirs) await rm(dir, { recursive: true, force: true })
})

async function until(predicate, { timeout = 5000, label = 'condition' } = {}) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (predicate()) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error(`timed out after ${timeout} ms waiting for ${label}`)
}

/**
 * 直接夹具：打开一个存储、装上两个写入工具，返回能拿到真实读数的一切。
 *
 * `storeDir` 是本用例独占的临时目录；`tools` 是 Map，`register` 不做回滚——生命周期在
 * 插件夹具里验，这里要的是 store 的真值。
 */
async function openTools() {
  const storeDir = await freshStoreDir()
  const store = await MemoryStore.open({ storeDir })
  const tools = new Map()
  installMemoryWriteTools({ tools: { register: (definition) => tools.set(definition.name, definition) } }, store)
  return { store, storeDir, tools }
}

/** 关掉实例再用同一个目录打开——验收 2、3、7 要比较的就是"重开之后还在不在"。 */
async function reopen(store, storeDir) {
  await store.close()
  return MemoryStore.open({ storeDir })
}

// ---- 插件夹具（验收 11、12）----------------------------------------------------

const findingsState = {
  findings: {
    'f-001': {
      findingId: 'f-001',
      recordedAt: 1792400000000,
      status: 'refuted',
      claim: '方向 2 的唤醒来自窗口变化。',
      evidence: [{ kind: 'tool', ref: 'perception.foreground' }],
    },
    'f-002': {
      findingId: 'f-002',
      recordedAt: 1792403600000,
      status: 'confirmed',
      claim: 'project-watch 以 30 秒采样项目状态。',
      evidence: [{ kind: 'file', ref: 'hikari-native/project-watch/index.js' }],
    },
  },
}

/** 与 `memory.test.mjs` 同一套替身：`Service` 基类让 `this.ctx` 重绑定到调用者 fiber。 */
class FakeTools extends Service {
  registry = new Map()
  order = []

  constructor(ctx) {
    super(ctx, 'tools')
  }

  register(definition) {
    return this.ctx.effect(() => {
      this.registry.set(definition.name, definition)
      this.order.push(definition.name)
      return () => {
        if (this.registry.get(definition.name) === definition) this.registry.delete(definition.name)
      }
    }, `tools.register(${definition.name})`)
  }

  get(name) {
    return this.registry.get(name)
  }

  has(name) {
    return this.registry.has(name)
  }
}

function fakePlugins() {
  const holder = { tools: undefined }
  const plugins = {
    sessions: { name: 'sessions', apply(ctx) { ctx.provide('sessions', { get: () => ({ id: SESSION_ID }) }) } },
    sessionProjections: {
      name: 'sessionProjections',
      apply(ctx) {
        ctx.provide('sessionProjections', { register() {}, stateOf: () => findingsState })
      },
    },
    systemPrompt: { name: 'systemPrompt', apply(ctx) { ctx.provide('systemPrompt', { context() {} }) } },
    tools: {
      name: 'tools',
      apply(ctx) {
        holder.tools = new FakeTools(ctx)
      },
    },
  }
  return { plugins, holder }
}

async function boot({ worldConfig = { registerMemoryTools: false }, withMemory = true } = {}) {
  const app = new Context()
  const storeDir = await freshStoreDir()
  const { plugins, holder } = fakePlugins()
  for (const plugin of Object.values(plugins)) app.plugin(plugin)
  await new Promise((r) => setTimeout(r, 30))
  app.plugin({ name: worldName, inject: worldInject, apply: worldApply }, { root: ROOT, ...worldConfig })
  await new Promise((r) => setTimeout(r, 40))
  const memory = withMemory
    ? app.plugin({ name: memoryName, inject: memoryInject, apply: memoryApply }, { storeDir })
    : undefined
  if (withMemory) await until(() => holder.tools.has('write_memory'), { label: 'write_memory registered' })
  return { app, tools: holder.tools, memory, storeDir }
}

// ---- 十二项验收 ---------------------------------------------------------------

test('[1] 正常写入：返回 m- 前缀的 memoryId，并在存储里落一行', async () => {
  const { store, storeDir, tools } = await openTools()
  const result = await tools.get('write_memory').execute({ text: '用 npm test 跑全量测试。' })
  assert.match(result.memoryId, /^m-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  assert.equal(result.seq, 1)
  assert.equal(typeof result.recordedAt, 'number')
  assert.equal(result.chars, '用 npm test 跑全量测试。'.length)
  assert.equal(store.size, 1)
  assert.equal(store.get(result.memoryId).text, '用 npm test 跑全量测试。')

  // 落盘的是**一行**合法 JSON，十字段齐全——不能只看内存快照说"写成功了"。
  const raw = await readFile(join(storeDir, 'memory.jsonl'), 'utf8')
  const lines = raw.split('\n').filter((line) => line.length > 0)
  assert.equal(lines.length, 1)
  const row = JSON.parse(lines.at(-1))
  assert.deepEqual(Object.keys(row).sort(), [
    'memoryId',
    'occurredAt',
    'recordedAt',
    'seq',
    'source',
    'supersedes',
    'text',
    'validFrom',
    'validHint',
    'validTo',
  ])
  assert.equal(row.memoryId, result.memoryId)
  assert.equal(row.seq, 1)
  assert.equal(row.recordedAt, result.recordedAt)
  assert.deepEqual(row.source, { kind: 'unknown', ref: null })
  assert.equal(row.supersedes, null)
  await store.close()
})

test('[2] 写入后关闭实例并重新打开，记录逐字段仍在', async () => {
  const { store, storeDir, tools } = await openTools()
  const written = await tools.get('write_memory').execute({
    text: '记忆跨越实例存在。',
    occurredAt: 1762345678901,
    validHint: '除非存储层改了格式',
    source: { kind: 'file', ref: 'hikari-native/memory/store.mjs:44' },
  })
  const before = store.get(written.memoryId)
  const reopened = await reopen(store, storeDir)
  assert.deepEqual(reopened.get(written.memoryId), before)
  assert.equal(reopened.size, 1)
  await reopened.close()
})

test('[3] 全局 memoryId 唯一：两次写入不同 id，重开后仍不重复', async () => {
  const { store, storeDir, tools } = await openTools()
  const a = await tools.get('write_memory').execute({ text: '第一条' })
  const b = await tools.get('write_memory').execute({ text: '第二条' })
  assert.notEqual(a.memoryId, b.memoryId)
  const reopened = await reopen(store, storeDir)
  const ids = reopened.all().map((record) => record.memoryId)
  assert.equal(ids.length, 2)
  assert.equal(new Set(ids).size, 2)
  await reopened.close()
})

test('[4] 工程字段不可伪造：schema 不暴露，绕过 schema 直接进 store 被白名单拒绝', async () => {
  const { store, tools } = await openTools()
  // 结构化断言：参数里根本没有工程字段的位置，且不许额外字段（那一道门挡 supersedes）。
  const parameters = tools.get('write_memory').parameters
  for (const field of ['memoryId', 'recordedAt', 'seq', 'supersedes']) {
    assert.equal(parameters.properties[field], undefined, `${field} must not be a parameter`)
  }
  assert.equal(parameters.additionalProperties, false)
  assert.deepEqual(Object.keys(parameters.properties).sort(), [
    'occurredAt',
    'source',
    'text',
    'validFrom',
    'validHint',
    'validTo',
  ])
  // 行为断言：即便绕开 schema，存储层的白名单也不收货——这正是"工程字段由工程生成"的第二道门。
  // 注意断言的是 `error.code`：`MemoryStoreError` 的错误码在字段上，message 只有中文说明。
  await assert.rejects(
    () => store.append({ text: '手工指定 id', memoryId: 'm-00000000-0000-0000-0000-000000000000' }),
    (error) => error.code === 'INVALID_INPUT',
  )
  assert.equal(store.size, 0)
  await store.close()
})

test('[5] 非法输入逐条被拒绝且不落盘', async () => {
  const { store, tools } = await openTools()
  const write = tools.get('write_memory')
  const cases = [
    ['空正文', { text: '   ' }, 'MEMORY_TEXT_EMPTY'],
    ['超长正文', { text: 'x'.repeat(MAX_TEXT + 1) }, 'MEMORY_TEXT_TOO_LONG'],
    ['超长 hint', { text: 'ok', validHint: 'y'.repeat(401) }, 'MEMORY_HINT_TOO_LONG'],
    ['非整数时间', { text: 'ok', occurredAt: 1.5 }, 'MEMORY_INVALID_TIME'],
    ['负时间', { text: 'ok', validFrom: -1 }, 'MEMORY_INVALID_TIME'],
    ['时间区间倒挂', { text: 'ok', validFrom: 10, validTo: 5 }, 'MEMORY_INVALID_RANGE'],
    ['occurredAt 在未来', { text: 'ok', occurredAt: Date.now() + 60000 }, 'MEMORY_INVALID_TIME_ORDER'],
    ['非法 kind', { text: 'ok', source: { kind: 'database' } }, 'MEMORY_INVALID_SOURCE'],
    ['unknown 由模型显式填', { text: 'ok', source: { kind: 'unknown' } }, 'MEMORY_INVALID_SOURCE'],
    ['inference 带 ref', { text: 'ok', source: { kind: 'inference', ref: 'x' } }, 'MEMORY_INVALID_SOURCE'],
    ['finding 缺 ref', { text: 'ok', source: { kind: 'finding' } }, 'MEMORY_INVALID_SOURCE'],
    ['ref 全空白', { text: 'ok', source: { kind: 'session', ref: '   ' } }, 'MEMORY_INVALID_SOURCE'],
    ['ref 超长', { text: 'ok', source: { kind: 'file', ref: 'p'.repeat(513) } }, 'MEMORY_INVALID_SOURCE'],
  ]
  for (const [label, args, code] of cases) {
    await assert.rejects(
      () => write.execute(args),
      (error) => error.message.startsWith(`${code}:`),
      `${label} should fail with ${code}`,
    )
    assert.equal(store.size, 0, `${label} must not write anything`)
  }
  // 边界之内的两条：hint 恰好 400 字被保留，全空白 hint 落成 null（省略=未知）。
  const long = await write.execute({ text: 'ok', validHint: 'z'.repeat(400) })
  assert.equal(store.get(long.memoryId).validHint.length, 400)
  const blank = await write.execute({ text: 'ok', validHint: '   ' })
  assert.equal(store.get(blank.memoryId).validHint, null)
  assert.equal(store.size, 2)
  await store.close()
})

test('[6] 正常修订：追加一条新记录并指向旧记录，旧记录不动', async () => {
  const { store, tools } = await openTools()
  const first = await tools.get('write_memory').execute({ text: '版本一' })
  const second = await tools.get('revise_memory').execute({ memoryId: first.memoryId, text: '版本二' })
  assert.notEqual(second.memoryId, first.memoryId)
  assert.equal(second.supersedes, first.memoryId)
  assert.equal(second.seq, 2)
  assert.equal(store.size, 2)
  assert.equal(store.get(second.memoryId).text, '版本二')
  await store.close()
})

test('[7] 修订后旧记录仍然存在，且一个字段都没被改写', async () => {
  const { store, storeDir, tools } = await openTools()
  const first = await tools.get('write_memory').execute({ text: '旧文本', occurredAt: 1762345678901 })
  const before = store.get(first.memoryId)
  await tools.get('revise_memory').execute({ memoryId: first.memoryId, text: '新文本' })
  assert.deepEqual(store.get(first.memoryId), before)
  assert.equal('supersededBy' in store.get(first.memoryId), false)
  const reopened = await reopen(store, storeDir)
  assert.deepEqual(reopened.get(first.memoryId), before)
  assert.equal(reopened.size, 2)
  await reopened.close()
})

test('[8] supersedes 指向正确，链可两跳，且并发修订不产生分叉', async () => {
  const { store, tools } = await openTools()
  const write = tools.get('write_memory')
  const revise = tools.get('revise_memory')

  const a = await write.execute({ text: 'a' })
  const b = await revise.execute({ memoryId: a.memoryId, text: 'b' })
  const c = await revise.execute({ memoryId: b.memoryId, text: 'c' })
  assert.equal(store.get(a.memoryId).supersedes, null)
  assert.equal(store.get(b.memoryId).supersedes, a.memoryId)
  assert.equal(store.get(c.memoryId).supersedes, b.memoryId)
  // 已经改过的目标不能直接再改：错误消息必须带出后继 id，否则模型没有别的线索找回来。
  await assert.rejects(
    () => revise.execute({ memoryId: a.memoryId, text: '分叉' }),
    (error) =>
      error.message.startsWith('MEMORY_SUPERSEDES_NOT_HEAD:') && error.message.includes(b.memoryId),
  )

  // 并发 20 次修订同一条链头：只能有一个赢，其余全被"已有后继"挡住。
  const target = c.memoryId
  const results = await Promise.allSettled(
    Array.from({ length: 20 }, (_, i) => revise.execute({ memoryId: target, text: `并发 ${i}` })),
  )
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  assert.equal(
    results.filter((r) => r.status === 'rejected').every((r) => r.reason.message.startsWith('MEMORY_SUPERSEDES_NOT_HEAD:')),
    true,
  )
  assert.equal(store.all().filter((record) => record.supersedes === target).length, 1)
  await store.close()
})

test('[9] 不存在的修订目标被拒绝且不落盘', async () => {
  const { store, tools } = await openTools()
  const revise = tools.get('revise_memory')
  await assert.rejects(
    () => revise.execute({ memoryId: 'm-00000000-0000-0000-0000-000000000000', text: 'x' }),
    // 不许提示去 search_memory：那里只有 findings，模型会白跑一趟。
    (error) =>
      error.message.startsWith('MEMORY_SUPERSEDES_UNKNOWN:') && !error.message.includes('search_memory'),
  )
  await assert.rejects(
    () => revise.execute({ memoryId: 'f-001', text: 'x' }),
    (error) => error.message.startsWith('MEMORY_SUPERSEDES_NOT_MEMORY:'),
  )
  assert.equal(store.size, 0)
  await store.close()
})

test('[10] 并发追加 20 次，seq 连续无洞', async () => {
  const { store, tools } = await openTools()
  const write = tools.get('write_memory')
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => write.execute({ text: `第 ${i} 条` })))
  const seqs = results.map((r) => r.seq).sort((x, y) => x - y)
  assert.deepEqual(seqs, Array.from({ length: 20 }, (_, i) => i + 1))
  assert.equal(store.size, 20)
  assert.equal(store.lastSeq, 20)
  await store.close()
})

test('[11] 插件卸载后六个工具消失，重载后恢复且可写入', async () => {
  const { app, tools, memory, storeDir } = await boot()
  assert.deepEqual(tools.order, [
    'record_finding',
    'search_memory',
    'read_memory',
    'write_memory',
    'revise_memory',
    'search_memories',
    'get_memory',
  ])
  await memory.dispose()
  await new Promise((r) => setTimeout(r, 40))
  for (const name of ['search_memory', 'read_memory', 'write_memory', 'revise_memory', 'search_memories', 'get_memory']) {
    assert.equal(tools.has(name), false, `${name} must disappear with the plugin`)
  }
  assert.equal(tools.has('record_finding'), true)

  app.plugin({ name: memoryName, inject: memoryInject, apply: memoryApply }, { storeDir })
  await until(() => tools.has('write_memory'), { label: 'write_memory restored after reload' })
  const written = await tools.get('write_memory').execute({ text: '重载后写入' })
  assert.match(written.memoryId, /^m-/)
})

test('[12] 检索工具与 World findings 不受影响，且检索结果里没有 m- 记录', async () => {
  const { tools } = await boot()
  const search = await tools.get('search_memory').execute({ query: '窗口' })
  assert.equal(search.total, 1)
  assert.equal(search.results[0].id, 'f-001')
  const read = await tools.get('read_memory').execute({ id: 'f-002' })
  assert.equal(read.id, 'f-002')
  assert.equal(read.status, 'confirmed')

  await tools.get('write_memory').execute({ text: '一条记忆' })
  const again = await tools.get('search_memory').execute({ query: '窗口' })
  assert.deepEqual(again, search)
  // 写入不进检索面：memoryId 是另一套 id 空间（缺口 G-10），这里只证明"没有混进来"。
  assert.equal(again.results.some((row) => String(row.id).startsWith('m-')), false)

  // World 的 record_finding 仍在且定义未变。不在这里 execute：它要解析 host 的
  // `@deepseek-ai/dsh-session` 才能落实验记录，那属于 World 自己的测试面（见
  // `hikari-native/test/world*.test.mjs`），在存储夹具里跑会给出一条无关的解析错误。
  const recordFinding = tools.get('record_finding')
  assert.equal(recordFinding.name, 'record_finding')
  assert.equal(recordFinding.parameters.required.includes('claim'), true)
  assert.equal(recordFinding.parameters.additionalProperties, false)
})
