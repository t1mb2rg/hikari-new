/**
 * M1 真实链路探针：用真 `@deepseek-ai/dsh-tools`（ToolRuntime）建注册表，
 * 只把与本次验证无关的 `systemPrompt` / `sessions` / `sessionProjections` 换成最小桩。
 *
 * 验的是「World 关掉 registerMemoryTools、Memory 接管」在真 tools service 上
 * 的工具可见集与生命周期，而不是 mock 的行为。
 */
import { Context } from 'file:///G:/work/LAB/code/_poc/poc01/node_modules/@deepseek-ai/cordis/lib/index.js'
import ToolRuntime from 'file:///G:/work/LAB/code/_poc/poc01/node_modules/@deepseek-ai/dsh-tools/lib/index.js'
import { writeFileSync } from 'node:fs'

const WORLD = 'file:///G:/work/LAB/code/projects/own/hikari-new/hikari-native/world/index.js'
const MEMORY = 'file:///G:/work/LAB/code/projects/own/hikari-new/hikari-native/memory/index.js'
const ROOT = 'G:/work/LAB/code/projects/own/hikari-new'

const world = await import(WORLD)
const memory = await import(MEMORY)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const names = ['record_finding', 'search_memory', 'read_memory']

async function boot() {
  const app = new Context()
  const findingsState = { findings: [], next: 1 }

  // service 必须 provide 在**根 ctx** 上，`new ToolRuntime(app)` 才读得到 ctx.systemPrompt
  app.provide('systemPrompt', { context() {}, tools() {}, tool() {} })
  app.provide('sessions', { get: () => ({ id: 'probe-session' }) })
  app.provide('sessionProjections', {
    register() {},
    stateOf: () => findingsState,
    update() {},
  })
  // 真 ToolRuntime 是 Service 子类，直接构造即在其 ctx 上 provide('tools', this)
  new ToolRuntime(app, {})
  await sleep(60)
  const worldFiber = app.plugin(
    { name: world.name, inject: world.inject, apply: world.apply },
    { root: ROOT, registerMemoryTools: false },
  )
  await sleep(80)

  const memoryFiber = app.plugin({ name: memory.name, inject: memory.inject, apply: memory.apply })
  await sleep(80)

  const tools = app.get('tools')
  const present = Object.fromEntries(names.map((n) => [n, tools.get(n) !== undefined]))
  return { app, tools, worldFiber, memoryFiber, present }
}

const report = {}
{
  const { app, tools, present, memoryFiber } = await boot()
  report.afterLoad = present
  report.definitions = Object.fromEntries(
    names.filter((n) => tools.get(n)).map((n) => {
      const d = tools.get(n)
      return [n, { description: d.description, parameters: JSON.stringify(d.parameters) }]
    }),
  )
  memoryFiber.dispose()
  await sleep(60)
  report.afterMemoryDispose = Object.fromEntries(names.map((n) => [n, tools.get(n) !== undefined]))
  app.dispose?.()
}

// 对照组：World 独占注册（registerMemoryTools 默认 true），比对工具定义是否逐字相同
{
  const app = new Context()
  app.provide('systemPrompt', { context() {}, tools() {}, tool() {} })
  app.provide('sessions', { get: () => ({ id: 'probe-session' }) })
  app.provide('sessionProjections', { register() {}, stateOf: () => ({ findings: [], next: 1 }), update() {} })
  new ToolRuntime(app, {})
  await sleep(60)
  app.plugin({ name: world.name, inject: world.inject, apply: world.apply }, { root: ROOT })
  await sleep(80)
  const tools = app.get('tools')
  report.worldOwned = Object.fromEntries(
    names.filter((n) => tools.get(n)).map((n) => {
      const d = tools.get(n)
      return [n, { description: d.description, parameters: JSON.stringify(d.parameters) }]
    }),
  )
  report.sameDefinition =
    JSON.stringify(report.definitions) === JSON.stringify(report.worldOwned)
  app.dispose?.()
}

try {
  writeFileSync(new URL('./probe-real-tools.json', import.meta.url), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  console.error('probe failed:', error)
  process.exit(1)
}
