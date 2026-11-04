// M1-b 测试：Memory 接管 search_memory / read_memory，World 保留 findings 数据与 record_finding。
// 跑法：node --test hikari-native/test/memory.test.mjs
//
// 两条验证线，缺一不可：
// 1) 本文件：真 Cordis + 最小替身（sessions / sessionProjections / systemPrompt / 假 tools）。
//    `FakeTools` 继承真 `Service` 基类，所以 `this.ctx` 会像真 dsh-tools 一样重绑定到
//    调用者插件的 ctx，`register()` 里 `this.ctx.effect(...)` 因而绑在 Memory 的 fiber 上——
//    这是「卸载 Memory 后工具消失」能成立的前提，不是手写注销。
// 2) `experiments/m1-world-service/probe-real-tools.mjs`：真 `@deepseek-ai/dsh-tools` 的
//    `ToolRuntime`，验真注册表上的可见集与回滚，以及工具定义逐字不变。
// 两处的结论必须一致；任一处不成立都是契约缺口，不能改成手动注销掩盖。
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'

import { Context, Service } from '@deepseek-ai/cordis'

import { apply as worldApply, name as worldName, inject as worldInject } from '../world/index.js'
import { apply as memoryApply, name as memoryName, inject as memoryInject } from '../memory/index.js'

// 仓库根：本文件在 `hikari-native/test/`，上两级就是根。不写死盘符，CI 上一样跑。
const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/[\\/]+$/, '')
const SESSION_ID = 'session-hikari'

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

/**
 * 假 tools service：用真 Cordis `Service` 基类，好让 `this.ctx` 是**调用者插件**的
 * ctx（Cordis 对 service 的属性访问会重绑定到消费者），从而复现真 dsh-tools 的
 * `register() → this.layers.effect(this.ctx, ...)` 语义：注册随调用者 fiber 回滚。
 * 这是 M1 生命周期测试成立的前提——若换成普通对象，卸载不会回滚注册。
 */
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
        ctx.provide('sessionProjections', {
          register() {},
          stateOf: () => findingsState,
        })
      },
    },
    systemPrompt: {
      name: 'systemPrompt',
      apply(ctx) { ctx.provide('systemPrompt', { context() {} }) },
    },
    tools: {
      name: 'tools',
      apply(ctx) {
        // `Service` 构造函数内部已 `ctx.reflect.provide('tools', this)`，别再调 provide
        holder.tools = new FakeTools(ctx)
      },
    },
  }
  return { plugins, holder }
}

// 每个用例一个独立的临时存储目录。Memory 插件现在会打开真实存储
// （`DSH_HOME/hikari/memory/`），测试若不传 storeDir 就会写到用户主目录里——
// 那是副作用，不是验证。
const storeDirs = []
async function freshStoreDir() {
  const dir = await mkdtemp(join(tmpdir(), 'hikari-memory-plugin-'))
  storeDirs.push(dir)
  return dir
}
after(async () => {
  for (const dir of storeDirs) await rm(dir, { recursive: true, force: true })
})

/**
 * 等到某个条件成立。
 *
 * 为什么需要它：Memory 的 `apply` 现在是 async（要先打开存储），固定毫秒的
 * `setTimeout` 在单文件跑时够用，但全量 `npm test` 并行时会不够——工具还没注册完
 * 断言就已经执行了。轮询等「真的出现」，不猜时间。
 */
async function until(predicate, { timeout = 5000, label = 'condition' } = {}) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (predicate()) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error(`timed out after ${timeout} ms waiting for ${label}`)
}

async function boot({ worldConfig, withMemory, logs, expectReady = Boolean(logs) }) {
  const app = new Context()
  const storeDir = await freshStoreDir()
  // ready 走 console.error（见 memory/index.js 的注释：DSH 的 exporter 只放行 warn+），
  // 所以这里截获 stderr，断言「ready 只在两个工具都注册成功之后出现」。
  const originalError = console.error
  if (logs) console.error = (...a) => logs.push(a.map(String).join(' '))
  const { plugins, holder } = fakePlugins()
  for (const p of Object.values(plugins)) app.plugin(p)
  await new Promise((r) => setTimeout(r, 30))
  const tools = holder.tools

  const world = app.plugin({ name: worldName, inject: worldInject, apply: worldApply }, { root: ROOT, ...worldConfig })
  await new Promise((r) => setTimeout(r, 40))

  let memory
  if (withMemory) {
    memory = app.plugin({ name: memoryName, inject: memoryInject, apply: memoryApply }, { storeDir })
    if (expectReady) {
      // 等到 ready 真的打出来再恢复 console.error。用固定窗口时，慢盘上 ready 会迟到、
      // 掉进下一个用例截获的数组里——Windows CI 上实测过（`expected exactly one` 收到两条）。
      await until(() => logs.some((l) => l.includes('[hikari-memory] ready')), { label: 'memory ready line' })
    } else {
      // 冲突用例里 Memory 的 apply 会抛错、永远不打 ready，等它会把用例拖到超时。
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  console.error = originalError
  return { app, tools, world, memory, storeDir }
}

test('World 独占注册时，三个工具都由 World 提供', async () => {
  const { tools } = await boot({ worldConfig: { registerMemoryTools: true }, withMemory: false })
  assert.deepEqual(tools.order, ['record_finding', 'search_memory', 'read_memory'])
})

test('World 关掉检索工具、Memory 接管后，各自只提供属于自己的工具', async () => {
  const { tools } = await boot({ worldConfig: { registerMemoryTools: false }, withMemory: true })
  assert.deepEqual(tools.order, [
    'record_finding',
    'search_memory',
    'read_memory',
    'write_memory',
    'revise_memory',
  ])
  assert.equal(tools.get('record_finding').name, 'record_finding')
  // 两个检索工具的执行体来自 Memory 的 tools.js，输出结构与 World 直调一致
  const search = await tools.get('search_memory').execute({ query: '窗口' })
  assert.equal(search.total, 1)
  assert.equal(search.results[0].id, 'f-001')
  const read = await tools.get('read_memory').execute({ id: 'f-002' })
  assert.equal(read.id, 'f-002')
  assert.equal(read.status, 'confirmed')
})

test('两边同时注册时必然报错，且 Memory 给出可操作的提示', async () => {
  const { tools } = await boot({ worldConfig: { registerMemoryTools: true }, withMemory: true })
  // World 先注册，Memory 的 apply 应当抛错
  assert.deepEqual(tools.order, ['record_finding', 'search_memory', 'read_memory'])
  assert.equal(tools.get('search_memory').description.includes('persisted findings'), true)
  // 抛错发生在 Memory 的 apply 内部：插件未激活，注册表未被二次写入
  const dup = tools.order.filter((n) => n === 'search_memory')
  assert.equal(dup.length, 1)
})

test('卸载 Memory 后四个工具消失，record_finding 仍在', async () => {
  const { tools, memory } = await boot({ worldConfig: { registerMemoryTools: false }, withMemory: true })
  assert.equal(tools.has('search_memory'), true)
  assert.equal(tools.has('write_memory'), true)
  await memory.dispose()
  await new Promise((r) => setTimeout(r, 40))
  assert.equal(tools.has('search_memory'), false)
  assert.equal(tools.has('read_memory'), false)
  assert.equal(tools.has('write_memory'), false)
  assert.equal(tools.has('revise_memory'), false)
  assert.equal(tools.has('record_finding'), true)
})

test('重新加载 Memory 后工具恢复，结果与首次一致', async () => {
  const { app, tools, memory, storeDir } = await boot({ worldConfig: { registerMemoryTools: false }, withMemory: true })
  const first = await tools.get('search_memory').execute({ query: '窗口' })
  await memory.dispose()
  await new Promise((r) => setTimeout(r, 40))
  app.plugin({ name: memoryName, inject: memoryInject, apply: memoryApply }, { storeDir })
  await until(() => tools.has('search_memory'), { label: 'search_memory restored after reload' })
  assert.equal(tools.has('search_memory'), true)
  const again = await tools.get('search_memory').execute({ query: '窗口' })
  assert.deepEqual(again, first)
})

test('Service 只读：改返回值不影响 World 的 findings', async () => {
  const { app } = await boot({ worldConfig: { registerMemoryTools: false }, withMemory: false })
  const svc = app.get('hikariWorldFindings')
  assert.equal(Object.isFrozen(svc), true)
  const hit = svc.search({ query: '窗口' })
  hit.results[0].status = 'TAMPERED'
  assert.equal(findingsState.findings['f-001'].status, 'refuted')
  assert.equal(svc.search({ query: '窗口' }).results[0].status, 'refuted')
})

test('非仓库目录：Memory 仍能激活，record_finding 不存在', async () => {
  const app = new Context()
  const storeDir = await freshStoreDir()
  const { plugins, holder } = fakePlugins()
  for (const p of Object.values(plugins)) app.plugin(p)
  await new Promise((r) => setTimeout(r, 30))
  const tools = holder.tools
  app.plugin(
    { name: worldName, inject: worldInject, apply: worldApply },
    { root: join(ROOT, '__definitely_not_a_repo__'), registerMemoryTools: false },
  )
  await new Promise((r) => setTimeout(r, 40))
  app.plugin({ name: memoryName, inject: memoryInject, apply: memoryApply }, { storeDir })
  // Memory 的 apply 是 async（要 open 存储），固定窗口在慢盘上不够——等工具真的出现。
  await until(() => tools.has('search_memory'), { label: 'search_memory registered' })
  assert.equal(tools.has('record_finding'), false)
  assert.equal(tools.has('search_memory'), true)
  assert.deepEqual(app.get('hikariWorldFindings').describe().available, false)
})

test('接管成功时输出一条 ready 日志，含 provider / tools / source', async () => {
  const logs = []
  await boot({ worldConfig: { registerMemoryTools: false }, withMemory: true, logs })
  const ready = logs.filter((l) => l.includes('[hikari-memory] ready'))
  assert.equal(ready.length, 1, `expected exactly one ready line, got: ${JSON.stringify(logs)}`)
  assert.match(ready[0], /provider=hikari-memory/)
  assert.match(ready[0], /tools=search_memory,read_memory,write_memory,revise_memory/)
  assert.match(ready[0], /source=findings/)
})

test('冲突时抛错且不输出 ready 日志', async () => {
  const logs = []
  await boot({ worldConfig: { registerMemoryTools: true }, withMemory: true, logs, expectReady: false })
  assert.equal(logs.filter((l) => l.includes('[hikari-memory] ready')).length, 0)
})
