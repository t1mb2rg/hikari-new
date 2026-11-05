// 心跳驱动源的测试：它只负责「到点说一声时间过去了」，判断留给 activation 与模型。
// 跑法：node --test hikari-native/test/heartbeat.test.mjs
//
// 这里用最小替身 ctx（不是真 Cordis）：两个插件只用 on/emit/logger/effect/agents.get，
// 替身能把「定时器有没有被清掉」「事件形状对不对」「唤醒文本里有没有该有的话」全验到。
// 真 Cordis 下的整链路在投运冒烟里验（见 docs/development/hikari-live-run-1.md）。
import assert from 'node:assert/strict'
import test from 'node:test'

import { apply as heartbeatApply, emitBeat, name as heartbeatName, resolveInterval } from '../heartbeat/index.js'
import { apply as activationApply, name as activationName } from '../activation/index.js'

function fakeCtx(agent = { followup() {} }) {
  const handlers = new Map()
  const disposers = []
  const emitted = []
  const logs = []
  return {
    handlers,
    disposers,
    emitted,
    logs,
    agents: { get: () => agent },
    on(name, fn) { handlers.set(name, fn) },
    emit(name, payload) {
      emitted.push({ name, payload })
      const fn = handlers.get(name)
      if (fn !== undefined) fn(payload)
    },
    logger: {
      info(message) { logs.push(message) },
      warn(message) { logs.push(`warn: ${message}`) },
    },
    // 与 Cordis 的 effect 语义一致：立刻执行一次，把返回值当作释放函数。
    effect(fn) { disposers.push(fn()) },
  }
}

test('两个插件的名字与事件名是契约的一部分', () => {
  assert.equal(heartbeatName, 'hikari-heartbeat')
  assert.equal(activationName, 'hikari-activation')
})

test('间隔有下限：写小了抬到 1 分钟，写坏了（负数/非数字）退回 30 分钟', () => {
  assert.equal(resolveInterval({ intervalMs: 1800000 }), 1800000)
  assert.equal(resolveInterval({ intervalMs: 1 }), 60000)
  assert.equal(resolveInterval({ intervalMs: -5 }), 1800000)
  assert.equal(resolveInterval({ intervalMs: 'soon' }), 1800000)
  assert.equal(resolveInterval(undefined), 1800000)
})

test('一次心跳的事件形状：reason / at / intervalMs', () => {
  const ctx = fakeCtx()
  emitBeat(ctx, 1800000)
  assert.equal(ctx.emitted.length, 1)
  const event = ctx.emitted[0]
  assert.equal(event.name, 'hikari/attention/worth')
  assert.equal(event.payload.reason, 'time-passed')
  assert.equal(event.payload.intervalMs, 1800000)
  assert.equal(typeof event.payload.at, 'number')
})

test('发射失败只记 warn，不让定时器炸掉', () => {
  const ctx = fakeCtx()
  ctx.emit = () => { throw new Error('nobody listening') }
  emitBeat(ctx, 60000)
  assert.ok(ctx.logs.some((line) => line.includes('emit failed: nobody listening')))
})

test('到点会发；启动时不发', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const ctx = fakeCtx()
  heartbeatApply(ctx, { intervalMs: 1800000 })
  assert.equal(ctx.emitted.length, 0, '启动时不发：第一次心跳在一个间隔之后')

  t.mock.timers.tick(1800000)
  assert.ok(ctx.emitted.length >= 1, '到点至少发一次')
  assert.equal(ctx.emitted[0].payload.reason, 'time-passed')
})

test('插件卸载后定时器被清掉，不再发事件', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const ctx = fakeCtx()
  heartbeatApply(ctx, { intervalMs: 60000 })
  t.mock.timers.tick(60000)
  const afterFirstTick = ctx.emitted.length
  assert.ok(afterFirstTick >= 1)

  assert.equal(ctx.disposers.length, 1, '定时器通过 ctx.effect 注册，卸载时被清')
  ctx.disposers[0]()
  t.mock.timers.tick(600000)
  assert.equal(ctx.emitted.length, afterFirstTick, '清掉之后不再发')
})

test('激活：time-passed 会叫醒 agent，提示词写清「过了多久」并允许什么都不做', () => {
  const calls = []
  const ctx = fakeCtx({ followup(message) { calls.push(message) } })
  activationApply(ctx, { sessionId: 'session-hikari' })
  ctx.emit('hikari/attention/worth', { reason: 'time-passed', at: Date.now(), intervalMs: 1800000 })

  assert.equal(calls.length, 1)
  const text = calls[0].content[0].text
  assert.match(text, /自主观察/)
  assert.match(text, /已经过了 30 分钟/)
  assert.match(text, /什么都不想做，就说一句「没什么」/)
  assert.match(text, /不要联系用户/)
  assert.equal(calls[0].role, 'user')
})

test('激活：未知理由不叫醒', () => {
  const calls = []
  const ctx = fakeCtx({ followup(message) { calls.push(message) } })
  activationApply(ctx, { sessionId: 'session-hikari' })
  ctx.emit('hikari/attention/worth', { reason: 'something-else' })
  assert.equal(calls.length, 0)
})

test('激活：agent 还没就绪时丢掉这次观察并记一条 warn，不抛错', () => {
  const ctx = fakeCtx()
  ctx.agents = { get: () => undefined }
  activationApply(ctx, { sessionId: 'session-hikari' })
  ctx.emit('hikari/attention/worth', { reason: 'time-passed', at: Date.now(), intervalMs: 60000 })
  assert.ok(ctx.logs.some((line) => line.includes('is not ready')))
})

test('激活：followup 抛错时只记 warn，不让事件冒泡', () => {
  const ctx = fakeCtx({ followup() { throw new Error('boom') } })
  activationApply(ctx, { sessionId: 'session-hikari' })
  ctx.emit('hikari/attention/worth', { reason: 'time-passed', at: Date.now(), intervalMs: 60000 })
  assert.ok(ctx.logs.some((line) => line.includes('followup failed: boom')))
})
