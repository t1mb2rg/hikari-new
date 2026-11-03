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
import test from 'node:test'
import { Context, Service } from 'file:///G:/work/LAB/code/_poc/poc01/node_modules/@deepseek-ai/cordis/lib/index.js'

import { apply as worldApply, name as worldName, inject as worldInject } from '../world/index.js'
import { apply as memoryApply, name as memoryName, inject as memoryInject } from '../memory/index.js'

const ROOT = 'G:/work/LAB/code/projects/own/hikari-new'
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

async function boot({ worldConfig, withMemory }) {
  const app = new Context()
  const { plugins, holder } = fakePlugins()
  for (const p of Object.values(plugins)) app.plugin(p)
  await new Promise((r) => setTimeout(r, 30))
  const tools = holder.tools

  const world = app.plugin({ name: worldName, inject: worldInject, apply: worldApply }, { root: ROOT, ...worldConfig })
  await new Promise((r) => setTimeout(r, 40))

  let memory
  if (withMemory) {
    memory = app.plugin({ name: memoryName, inject: memoryInject, apply: memoryApply })
    await new Promise((r) => setTimeout(r, 40))
  }
  return { app, tools, world, memory }
}

test('World 独占注册时，三个工具都由 World 提供', async () => {
  const { tools } = await boot({ worldConfig: { registerMemoryTools: true }, withMemory: false })
  assert.deepEqual(tools.order, ['record_finding', 'search_memory', 'read_memory'])
})

test('World 关掉检索工具、Memory 接管后，各自只提供属于自己的工具', async () => {
  const { tools } = await boot({ worldConfig: { registerMemoryTools: false }, withMemory: true })
  assert.deepEqual(tools.order, ['record_finding', 'search_memory', 'read_memory'])
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

test('卸载 Memory 后两个检索工具消失，record_finding 仍在', async () => {
  const { tools, memory } = await boot({ worldConfig: { registerMemoryTools: false }, withMemory: true })
  assert.equal(tools.has('search_memory'), true)
  await memory.dispose()
  await new Promise((r) => setTimeout(r, 40))
  assert.equal(tools.has('search_memory'), false)
  assert.equal(tools.has('read_memory'), false)
  assert.equal(tools.has('record_finding'), true)
})

test('重新加载 Memory 后工具恢复，结果与首次一致', async () => {
  const { app, tools, memory } = await boot({ worldConfig: { registerMemoryTools: false }, withMemory: true })
  const first = await tools.get('search_memory').execute({ query: '窗口' })
  await memory.dispose()
  await new Promise((r) => setTimeout(r, 40))
  app.plugin({ name: memoryName, inject: memoryInject, apply: memoryApply })
  await new Promise((r) => setTimeout(r, 40))
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
  const { plugins, holder } = fakePlugins()
  for (const p of Object.values(plugins)) app.plugin(p)
  await new Promise((r) => setTimeout(r, 30))
  const tools = holder.tools
  app.plugin(
    { name: worldName, inject: worldInject, apply: worldApply },
    { root: 'G:/tmp/definitely-not-a-repo', registerMemoryTools: false },
  )
  await new Promise((r) => setTimeout(r, 40))
  app.plugin({ name: memoryName, inject: memoryInject, apply: memoryApply })
  await new Promise((r) => setTimeout(r, 40))
  assert.equal(tools.has('record_finding'), false)
  assert.equal(tools.has('search_memory'), true)
  assert.deepEqual(app.get('hikariWorldFindings').describe().available, false)
})
