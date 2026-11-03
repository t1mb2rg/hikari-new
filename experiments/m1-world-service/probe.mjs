// M1-a 探针 v2：service 的访问方式（ctx.get vs ctx.<name>）、inject 等待、同名 provide。
// 只读、不碰仓库代码、不调模型。
import { Context } from 'file:///G:/work/LAB/code/_poc/poc01/node_modules/@deepseek-ai/cordis/lib/index.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = []

function read(app, name) {
  try {
    const byCtx = app[name]
    if (byCtx !== undefined) return { via: `app[${name}]`, value: typeof byCtx.search === 'function' ? byCtx.search() : byCtx }
  } catch (e) { /* fallthrough */ }
  try {
    const byGet = app.get?.(name)
    if (byGet !== undefined) return { via: `app.get(${name})`, value: typeof byGet.search === 'function' ? byGet.search() : byGet }
  } catch (e) { return { via: 'get-threw', value: e.message.slice(0, 60) } }
  return { via: 'absent', value: null }
}

// ── 场景 1：点分名字 + inject ──
{
  const app = new Context()
  app.plugin({
    name: 'provider',
    apply(ctx) { ctx.provide('hikari.worldFindings', { search: () => ['dotted'] }) },
  })
  let applyRan = false, seen = null
  app.plugin({
    name: 'consumer',
    inject: ['hikari.worldFindings'],
    apply(ctx) {
      applyRan = true
      const B = 'hikari.worldFindings'
      seen = ctx[B] !== undefined ? `bracket:${ctx[B].search()}` : 'bracket-miss'
      if (typeof ctx.get === 'function' && ctx.get(B) !== undefined) seen += '+get-ok'
    },
  })
  await sleep(80)
  log.push(`S1(dotted) applyRan=${applyRan} consumerSaw=${seen} read=${JSON.stringify(read(app, 'hikari.worldFindings'))}`)
}

// ── 场景 2：单段名字 + inject，consumer 先注册 ──
{
  const app = new Context()
  let applyRan = false, seen = null
  app.plugin({
    name: 'consumer2',
    inject: ['hikariWorldFindings'],
    apply(ctx) {
      applyRan = true
      seen = ctx.hikariWorldFindings?.search?.() ?? 'undefined'
    },
  })
  app.plugin({
    name: 'provider2',
    apply(ctx) { ctx.provide('hikariWorldFindings', { search: () => ['flat-late'] }) },
  })
  await sleep(100)
  log.push(`S2(flat,reverse) applyRan=${applyRan} seen=${JSON.stringify(seen)} read=${JSON.stringify(read(app, 'hikariWorldFindings'))}`)
}

// ── 场景 3：两个插件 provide 同名 ──
{
  const app = new Context()
  const errs = []
  for (const [tag, fn] of [['p1', () => 'first'], ['p2', () => 'second']]) {
    app.plugin({
      name: tag,
      apply(ctx) {
        try { ctx.provide('hikariWorldFindings', { search: fn }) } catch (e) { errs.push(`${tag}:${e.message.slice(0, 70)}`) }
      },
    })
  }
  await sleep(100)
  log.push(`S3(dup) errs=${JSON.stringify(errs)} read=${JSON.stringify(read(app, 'hikariWorldFindings'))}`)
}

for (const line of log) console.log(line)
