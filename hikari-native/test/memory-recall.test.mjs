// M2-c 测试：search_memories / get_memory 的十二项验收。
// 跑法：node --test hikari-native/test/memory-recall.test.mjs
//
// 两层夹具，与 `memory-writing.test.mjs` 同一分工：
// 1) 直接夹具（`openTools`）：真 `MemoryStore` + 真的 `installMemoryRecallTools`，只把
//    `ctx.tools.register` 换成 Map。发现工具只依赖 store，这一层能拿到真实读数（size / all /
//    jsonl 字节），不必绕插件生命周期。
// 2) 插件夹具（`boot`）：与 `memory.test.mjs` 同构的真 Cordis + 假 sessions/tools，用来验
//    "注册随 fiber 回滚"与"检索工具、World findings 不受影响"。
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
import { installMemoryRecallTools, matchStrength } from '../memory/recall.js'

const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/[\\/]+$/, '')
const SESSION_ID = 'session-hikari'

const storeDirs = []
async function freshStoreDir() {
  const dir = await mkdtemp(join(tmpdir(), 'hikari-memory-recall-'))
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

/** 直接夹具：一个真存储 + 两个发现工具，`tools` 是 Map（注册不回滚，生命周期在插件夹具里验）。 */
async function openTools() {
  const storeDir = await freshStoreDir()
  const store = await MemoryStore.open({ storeDir })
  const tools = new Map()
  installMemoryRecallTools({ tools: { register: (definition) => tools.set(definition.name, definition) } }, store)
  return { store, storeDir, tools, search: tools.get('search_memories').execute, get: tools.get('get_memory').execute }
}

/**
 * 断言失败消息以错误码开头（任务书 §4 补充说明：判前缀，不判错误类）。
 *
 * 收 thunk 而不是 promise：两个发现工具的 `execute` 是同步的（冻结面要求与 `record_finding`
 * 同风格），同步 throw 根本不会变成 rejected promise。
 */
async function rejectsWith(run, code) {
  let error
  try {
    const value = run()
    if (value !== null && typeof value === 'object' && typeof value.then === 'function') await value
  } catch (caught) {
    error = caught
  }
  assert.equal(error instanceof Error, true, `expected ${code}, nothing was thrown`)
  assert.match(error.message, new RegExp(`^${code}: `))
  return error
}

// ---- 验收 1：正常检索 ----------------------------------------------------------

test('[1] 检索命中：返回 memoryId/snippet/occurredAt/validHint/supersededBy', async () => {
  const { store, search } = await openTools()
  const written = await store.append({
    text: '部署脚本在 Windows 上必须先设 HTTPS_PROXY。',
    occurredAt: 1792400000000,
    validHint: '直到 CI 改成本地镜像',
    source: { kind: 'conversation', ref: 'session-a#3' },
  })

  const hit = await search({ query: 'HTTPS_PROXY' })
  assert.equal(hit.results.length, 1)
  const candidate = hit.results[0]
  assert.deepEqual(
    Object.keys(candidate).sort(),
    ['memoryId', 'occurredAt', 'snippet', 'supersededBy', 'validHint'].sort(),
  )
  assert.equal(candidate.memoryId, written.memoryId)
  assert.equal(candidate.snippet, written.text)
  assert.equal(candidate.occurredAt, 1792400000000)
  assert.equal(candidate.validHint, '直到 CI 改成本地镜像')
  assert.equal(candidate.supersededBy, null)
  // 候选不含全文之外的字段：没有 text / source / recordedAt / seq
  for (const key of ['text', 'source', 'recordedAt', 'seq']) assert.equal(key in candidate, false)
  // 没有更多时不带 nextOffset（不是给 null）
  assert.equal('nextOffset' in hit, false)
  // 长文本只给摘要：120 个码元 + 省略号
  const long = await store.append({ text: `很长的正文 ${'字'.repeat(200)}` })
  const longHit = await search({ query: '很长的正文' })
  assert.equal(longHit.results[0].memoryId, long.memoryId)
  assert.equal(longHit.results[0].snippet.length, 121)
  assert.equal(longHit.results[0].snippet.endsWith('…'), true)
})

// ---- 验收 2：子串、大小写、无关 query ------------------------------------------

test('[2] 正文子串匹配、大小写不敏感，无关 query 返回空集', async () => {
  const { store, search } = await openTools()
  await store.append({ text: 'PortableGit 的 sha256 是 075e158e…' })
  await store.append({ text: '快照隔离靠 Object.freeze 实现。' })

  const lower = await search({ query: 'portablegit' })
  const upper = await search({ query: 'PORTABLEGIT' })
  assert.equal(lower.results.length, 1)
  assert.deepEqual(upper.results, lower.results)

  // 子串，不要求整词
  assert.equal((await search({ query: 'ableGi' })).results.length, 1)
  // 无关 query：空集，且不带 nextOffset
  assert.deepEqual(await search({ query: '完全不存在的词' }), { results: [] })
})

// ---- 验收 3：时间窗 ------------------------------------------------------------

test('[3] since/until 是闭区间，occurredAt 为 null 时不命中时间窗', async () => {
  const { store, search } = await openTools()
  const at = await store.append({ text: '标记 A 时间窗', occurredAt: 1792400000000 })
  const early = await store.append({ text: '标记 A 早一点', occurredAt: 1792300000000 })
  const unknown = await store.append({ text: '标记 A 不知道何时' })

  const window = await search({ query: '标记 A', since: 1792400000000, until: 1792400000000 })
  assert.deepEqual(window.results.map((r) => r.memoryId), [at.memoryId], '闭区间应含端点')

  const from = await search({ query: '标记 A', since: 1792350000000 })
  assert.deepEqual(from.results.map((r) => r.memoryId), [at.memoryId], '早于 since 的记录不在窗口内')

  const allTime = await search({ query: '标记 A', since: 1792200000000 })
  assert.deepEqual(allTime.results.map((r) => r.memoryId).sort(), [at.memoryId, early.memoryId].sort())

  // occurredAt === null：给任一界限都不命中
  assert.equal((await search({ query: '标记 A', since: 0 })).results.some((r) => r.memoryId === unknown.memoryId), false)
  assert.equal(
    (await search({ query: '标记 A', until: 9999999999999 })).results.some((r) => r.memoryId === unknown.memoryId),
    false,
  )
  // 不给时间窗时它照常出现
  assert.equal((await search({ query: '标记 A' })).results.length, 3)
})

// ---- 验收 4：headOnly ----------------------------------------------------------

test('[4] headOnly 排除已被修订的旧记录', async () => {
  const { store, search } = await openTools()
  const old = await store.append({ text: '采样周期是 30 秒。' })
  const now = await store.append({ text: '采样周期改成 15 秒。', supersedes: old.memoryId })

  const all = await search({ query: '采样周期' })
  assert.equal(all.results.length, 2)
  assert.equal(all.results.find((r) => r.memoryId === old.memoryId).supersededBy, now.memoryId)

  const heads = await search({ query: '采样周期', headOnly: true })
  assert.deepEqual(heads.results.map((r) => r.memoryId), [now.memoryId])
})

// ---- 验收 5：排序与翻页 --------------------------------------------------------

test('[5] 结果按 seq 倒序，limit/nextOffset 可翻页', async () => {
  const { store, search } = await openTools()
  const ids = []
  for (let i = 0; i < 5; i += 1) ids.push((await store.append({ text: `分页样本 ${i}` })).memoryId)

  const first = await search({ query: '分页样本', limit: 2 })
  assert.deepEqual(first.results.map((r) => r.memoryId), [ids[4], ids[3]])
  assert.equal(first.nextOffset, 2)

  const second = await search({ query: '分页样本', limit: 2, nextOffset: first.nextOffset })
  assert.deepEqual(second.results.map((r) => r.memoryId), [ids[2], ids[1]])
  assert.equal(second.nextOffset, 4)

  const last = await search({ query: '分页样本', limit: 2, nextOffset: second.nextOffset })
  assert.deepEqual(last.results.map((r) => r.memoryId), [ids[0]])
  assert.equal('nextOffset' in last, false, '没有更多时不给这个键')

  // limit 是上限：999 夹到 20，不报错；0 夹到 1
  assert.equal((await search({ query: '分页样本', limit: 999 })).results.length, 5)
  assert.equal((await search({ query: '分页样本', limit: 0 })).results.length, 1)
  // nextOffset 负数归零
  assert.equal((await search({ query: '分页样本', limit: 2, nextOffset: -3 })).nextOffset, 2)
})

// ---- 验收 6：参数非法 ----------------------------------------------------------

test('[6] 空 query、非整数时间、since>until 分别被拒', async () => {
  const { store, search } = await openTools()
  const before = store.size
  await rejectsWith(() => search({}), 'MEMORY_QUERY_EMPTY')
  await rejectsWith(() => search({ query: '   ' }), 'MEMORY_QUERY_EMPTY')
  await rejectsWith(() => search({ query: 42 }), 'MEMORY_QUERY_EMPTY')
  await rejectsWith(() => search({ query: 'x', since: 1.5 }), 'MEMORY_INVALID_TIME')
  await rejectsWith(() => search({ query: 'x', until: '1792400000000' }), 'MEMORY_INVALID_TIME')
  await rejectsWith(() => search({ query: 'x', since: -1 }), 'MEMORY_INVALID_TIME')
  await rejectsWith(() => search({ query: 'x', since: 10, until: 5 }), 'MEMORY_INVALID_RANGE')
  assert.equal(store.size, before, '被拒的检索不写盘')
})

// ---- 验收 7：get_memory --------------------------------------------------------

test('[7] get_memory 返回完整十字段与派生 supersededBy', async () => {
  const { store, get } = await openTools()
  const written = await store.append({
    text: '一条完整的记忆。',
    occurredAt: 1792400000000,
    validFrom: 1792400000000,
    validTo: 1792500000000,
    validHint: '一周内有效',
    source: { kind: 'file', ref: 'hikari-native/memory/store.mjs:24' },
  })

  const record = await get({ memoryId: written.memoryId })
  assert.deepEqual(Object.keys(record), [
    'memoryId', 'text', 'occurredAt', 'recordedAt', 'validFrom', 'validTo',
    'validHint', 'source', 'supersedes', 'seq', 'supersededBy',
  ])
  assert.equal(record.memoryId, written.memoryId)
  assert.equal(record.text, '一条完整的记忆。')
  assert.equal(record.occurredAt, 1792400000000)
  assert.equal(record.recordedAt, written.recordedAt)
  assert.equal(record.validFrom, 1792400000000)
  assert.equal(record.validTo, 1792500000000)
  assert.equal(record.validHint, '一周内有效')
  assert.deepEqual(record.source, { kind: 'file', ref: 'hikari-native/memory/store.mjs:24' })
  assert.equal(record.supersedes, null)
  assert.equal(record.seq, written.seq)
  assert.equal(record.supersededBy, null)
  // 不做传递闭包：没有邻居正文这类附加键
  assert.equal('next' in record || 'previous' in record, false)
})

// ---- 验收 8：前缀与不存在 ------------------------------------------------------

test('[8] f- 前缀报 MEMORY_NOT_A_MEMORY，未知 m- 报 MEMORY_UNKNOWN_ID', async () => {
  const { get } = await openTools()
  const notMemory = await rejectsWith(() => get({ memoryId: 'f-001' }), 'MEMORY_NOT_A_MEMORY')
  const unknown = await rejectsWith(
    () => get({ memoryId: 'm-00000000-0000-4000-8000-000000000000' }),
    'MEMORY_UNKNOWN_ID',
  )
  await rejectsWith(() => get({}), 'MEMORY_UNKNOWN_ID')
  await rejectsWith(() => get({ memoryId: '   ' }), 'MEMORY_UNKNOWN_ID')
  await rejectsWith(() => get({ memoryId: 42 }), 'MEMORY_UNKNOWN_ID')
  // 两条消息指向不同下一步：f- 去 read_memory，未知 m- 去 search_memories
  assert.match(notMemory.message, /use read_memory for findings/)
  assert.match(unknown.message, /use search_memories to find one/)
})

// ---- 验收 9：修订后的链 --------------------------------------------------------

test('[9] 修订后旧记录仍在，get_memory(旧) 的 supersededBy 指向新记录', async () => {
  const { store, get, search } = await openTools()
  const old = await store.append({ text: '端口是 8080。' })
  const now = await store.append({ text: '端口是 8081。', supersedes: old.memoryId })

  assert.equal(store.size, 2, '旧记录没有被删')
  const oldRecord = await get({ memoryId: old.memoryId })
  const nowRecord = await get({ memoryId: now.memoryId })
  assert.equal(oldRecord.supersededBy, now.memoryId)
  assert.equal(nowRecord.supersedes, old.memoryId)
  assert.equal(nowRecord.supersededBy, null)
  assert.equal(oldRecord.text, '端口是 8080。', '旧正文原样保留')

  // 两跳：c 修订 b、b 修订 a；get_memory(a).supersededBy 只给直接后继 b（不做传递闭包）
  const a = await store.append({ text: '三跳样本 a' })
  const b = await store.append({ text: '三跳样本 b', supersedes: a.memoryId })
  const c = await store.append({ text: '三跳样本 c', supersedes: b.memoryId })
  assert.equal((await get({ memoryId: a.memoryId })).supersededBy, b.memoryId)
  assert.equal((await get({ memoryId: b.memoryId })).supersededBy, c.memoryId)
  assert.equal((await search({ query: '三跳样本', headOnly: true })).results.length, 1)
})

// ---- 验收 10：空存储与只读 -----------------------------------------------------

test('[10] 空存储返回空数组且不带 nextOffset；检索前后 memory.jsonl 与 store.size 不变', async () => {
  const { store, storeDir, search, get } = await openTools()
  assert.deepEqual(await search({ query: '任何东西' }), { results: [] })

  const written = await store.append({ text: '只读检查样本。' })
  const jsonl = join(storeDir, 'memory.jsonl')
  const before = { bytes: await readFile(jsonl, 'utf8'), size: store.size }
  await search({ query: '只读检查' })
  await get({ memoryId: written.memoryId })
  await rejectsWith(() => get({ memoryId: 'f-001' }), 'MEMORY_NOT_A_MEMORY')
  const afterRead = { bytes: await readFile(jsonl, 'utf8'), size: store.size }
  assert.deepEqual(afterRead, before, '发现工具不写盘、不改内存记录')
})

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
  },
}

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

async function boot({ worldConfig = { registerMemoryTools: false } } = {}) {
  const app = new Context()
  const storeDir = await freshStoreDir()
  const holder = {}
  const plugins = {
    sessions: { name: 'sessions', apply(ctx) { ctx.provide('sessions', { get: () => ({ id: SESSION_ID }) }) } },
    sessionProjections: {
      name: 'sessionProjections',
      apply(ctx) {
        ctx.provide('sessionProjections', { register() {}, stateOf: () => findingsState })
      },
    },
    systemPrompt: { name: 'systemPrompt', apply(ctx) { ctx.provide('systemPrompt', { context() {} }) } },
    tools: { name: 'tools', apply(ctx) { holder.tools = new FakeTools(ctx) } },
  }
  for (const plugin of Object.values(plugins)) app.plugin(plugin)
  await new Promise((r) => setTimeout(r, 30))
  app.plugin({ name: worldName, inject: worldInject, apply: worldApply }, { root: ROOT, ...worldConfig })
  await new Promise((r) => setTimeout(r, 40))
  const memory = app.plugin({ name: memoryName, inject: memoryInject, apply: memoryApply }, { storeDir })
  await until(() => holder.tools.has('search_memories'), { label: 'search_memories registered' })
  return { app, tools: holder.tools, memory, storeDir }
}

test('[11] 卸载后六个工具消失，重载后恢复', async () => {
  const { app, tools, memory, storeDir } = await boot()
  const memoryTools = ['search_memory', 'read_memory', 'write_memory', 'revise_memory', 'search_memories', 'get_memory']
  for (const name of memoryTools) assert.equal(tools.has(name), true, `${name} should be registered`)
  assert.equal(tools.has('record_finding'), true)

  await memory.dispose()
  await new Promise((r) => setTimeout(r, 40))
  for (const name of memoryTools) assert.equal(tools.has(name), false, `${name} should be gone after dispose`)
  assert.equal(tools.has('record_finding'), true, 'World 的工具不随 Memory 卸载')

  app.plugin({ name: memoryName, inject: memoryInject, apply: memoryApply }, { storeDir })
  await until(() => tools.has('search_memories'), { label: 'search_memories restored after reload' })
  for (const name of memoryTools) assert.equal(tools.has(name), true, `${name} should be back after reload`)
})

test('[12] 全量回归：写了记忆之后，search_memory 的结果里仍然没有 m- 前缀 id', async () => {
  const { tools } = await boot()
  const written = await tools.get('write_memory').execute({ text: '窗口变化会唤醒方向 2。' })
  assert.match(written.memoryId, /^m-/)

  const memories = await tools.get('search_memories').execute({ query: '窗口' })
  assert.equal(memories.results.length, 1)

  const findings = await tools.get('search_memory').execute({ query: '窗口' })
  assert.equal(findings.results.length, 1)
  assert.equal(findings.results[0].id, 'f-001')
  assert.equal(findings.results.some((r) => String(r.id).startsWith('m-')), false, 'findings 检索不应返回记忆 id')
  assert.equal(typeof findings.total, 'number', 'search_memory 的输出形状未变')
})

// ---- M2-d：匹配口径（`docs/architecture/m2d-memory-matching-interface-freeze.md` §5）----
//
// B1 现场那四条 query 原本一条都没命中（`experiments/m2c-live/s3-recall.md`）。这里用
// **会话 A 真正写进去的那段正文**重放：正文取自 `experiments/m2c-live/store/memory.jsonl`
// 第 1 行（954 个码元），只此一条记录，不另造语料。
const REAL_TEXT = [
  'Hikari 的 Memory 修订约定（可作为后续讨论的前提，已在源码核实成立）：「修订只能改链头，旧记录永不改」。',
  '',
  '核实位置：',
  '- `hikari-native/memory/writing.js` 的 `assertReviseTarget`（约 253-281 行）：先 `store.get(id)` 确认记录存在，再 `store.all().find(r => r.supersedes === id)` 查后继；一旦已有后继就抛 `MEMORY_SUPERSEDES_NOT_HEAD`，并在消息里点名当前链头，要求改那条。因此只能修订当前版本（链头）。',
  '- `revise_memory` 的实现（约 463-481 行）：判链头与写入在同一个 `enqueue` 串行回调里完成，写入走 `store.append(toAppendInput(input, { supersedes: target }))`——只追加新记录，`supersedes` 由工具层从 memoryId 复制，模型无法自己写。',
  '- `hikari-native/memory/store.mjs`：文件被注释与实现共同限定为 append-only（只 `appendFile` JSONL；`writeFile` 只用于 meta 计数器），没有 update/delete 路径；`supersedes` 必须指向已存在记录，不能指向自己（自指/悬挂会被 `INVALID_RECORD`/`INVALID_INPUT` 拒绝）。',
  '- 工具描述里也写死了：「The old record is kept forever; nothing is edited or deleted.」',
  '',
  '已知局限（不是反例，但讨论时要记住）：串行队列只覆盖单进程；两个进程共写同一 store 没有文件锁，跨进程并发修订仍可能各自写出后继而分叉（`writing.js` 约 288-292 行、`docs/development/m2a-memory-store.md` 风险清单第 1 条）。因此「只能改链头」在单进程内是强制的，跨进程是尽力而为；而「旧记录永不改」在两种情况下都由 append-only 存储保证。',
].join('\n')

test('[13] matchStrength：整串命中 1、片段按覆盖率、拉丁词元必须落在正文词元里', () => {
  // 整串子串（含大小写）→ 满分
  assert.equal(matchStrength('修订只能改链头', REAL_TEXT), 1)
  assert.equal(matchStrength('memory 修订约定', REAL_TEXT), 1)
  // 片段覆盖率：`memory 修订 规则 是什么` 的中文片段只中 `修订`，1/4 = 0.25
  assert.equal(matchStrength('memory 修订 规则 是什么', REAL_TEXT), 0.25)
  // 拉丁词元必须被正文某个词元包含：`script` 里的 `typescript` 不算命中
  assert.equal(matchStrength('typescript', REAL_TEXT), null)
  // 只有拉丁词元、且整串不是子串（写成连字符）→ 0.5：两个词都在，但没有原文依据
  assert.equal(matchStrength('revise-memory', REAL_TEXT), 0.5)
  // 反过来，`revise` 本身就是正文子串 → 走快速路径拿满分
  assert.equal(matchStrength('revise', REAL_TEXT), 1)
  // 覆盖率不足 0.25 一律不中：单字假阳性（`完`/`不`/`存`/`在`/`的`）就是这样被挡住的
  assert.equal(matchStrength('完全不存在的词', REAL_TEXT), null)
  // 0.25 是硬线：命中 1/4 = 0.25 进，命中 1/5 = 0.20 不进
  assert.equal(matchStrength('修订 规则 词汇 语义 关系', REAL_TEXT), null)
})

test('[14] B1 现场四条 query 在只有一条记录时各命中一条（M2-d 的主证据）', async () => {
  const { store, search } = await openTools()
  const written = await store.append({ text: REAL_TEXT })
  const queries = [
    'hikari 记忆修订',
    'revise memory 旧记录',
    '记忆修订 只能修订哪一条 旧记录是否改动',
    '记忆 修订 约定',
  ]
  for (const query of queries) {
    const hit = await search({ query })
    assert.equal(hit.results.length, 1, `「${query}」应当命中会话 A 写的那条`)
    assert.equal(hit.results[0].memoryId, written.memoryId)
  }
})

test('[15] 无关 query 仍然空集（收紧口径不能换来假阳性）', async () => {
  const { store, search } = await openTools()
  await store.append({ text: REAL_TEXT })
  await store.append({ text: '记忆修订的补充：跨进程没有文件锁，分叉只能事后发现。' })
  for (const query of [
    '完全不存在的词',
    '部署脚本 代理',
    'TypeScript 编译错误',
    '今天的天气',
    'npm test 跑多久',
    '会议纪要 待办事项',
    'how to revise a memory without losing history',
  ]) {
    const hit = await search({ query })
    assert.deepEqual(hit.results, [], `「${query}」不该命中`)
  }
})

test('[16] 排序按命中强度：整串命中压过片段命中，即使后者更新', async () => {
  const { store, search } = await openTools()
  const exact = await store.append({ text: '修订只能改链头' })
  const partial = await store.append({ text: '修订 只能改链头（补充：跨进程没有文件锁）' })
  assert.equal(partial.seq > exact.seq, true, '片段命中那条更新')

  const hit = await search({ query: '修订只能改链头' })
  assert.deepEqual(
    hit.results.map((r) => r.memoryId),
    [exact.memoryId, partial.memoryId],
    '整串命中必须先出现',
  )

  // 同强度时按 seq 倒序（新的在前）：后三条都是片段命中、覆盖率相同
  const older = await store.append({ text: '修订 只能改链头（旧，另一个库）' })
  const newer = await store.append({ text: '修订 只能改链头（新，另一个库）' })
  const tied = await search({ query: '修订只能改链头' })
  assert.deepEqual(
    tied.results.slice(1).map((r) => r.memoryId),
    [newer.memoryId, older.memoryId, partial.memoryId],
    '同强度按新到旧',
  )
})
