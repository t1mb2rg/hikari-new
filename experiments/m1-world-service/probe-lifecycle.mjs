// M1 生命周期探针：插件卸载时 (a) ctx.effect 的 disposer 是否被调用；(b) provide 的 service 是否消失；(c) 重新装载是否恢复。
// 只读、不碰仓库代码。
import { Context } from 'file:///G:/work/LAB/code/_poc/poc01/node_modules/@deepseek-ai/cordis/lib/index.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = []

const app = new Context()
const trace = []

function makePlugin(tag) {
  return {
    name: tag,
    apply(ctx) {
      ctx.effect(() => {
        trace.push(`${tag}:effect-registered`)
        return () => trace.push(`${tag}:effect-disposed`)
      })
      ctx.provide(`svc_${tag}`, { hello: () => tag })
      trace.push(`${tag}:applied`)
    },
  }
}

const f1 = app.plugin(makePlugin('world'))
await sleep(60)
trace.push(`after mount: svc = ${typeof app['svc_world']?.hello}`)

// 卸载
const disposed = typeof f1?.dispose === 'function' ? 'has-dispose' : 'no-dispose'
trace.push(`fiber accessor: ${disposed}`)
if (typeof f1?.dispose === 'function') {
  await f1.dispose()
  await sleep(80)
  trace.push(`after dispose: svc = ${typeof app['svc_world']}`)
}

// 重新装载
const f2 = app.plugin(makePlugin('world'))
await sleep(60)
trace.push(`after remount: svc = ${typeof app['svc_world']?.hello}`)

for (const line of trace) console.log(line)
