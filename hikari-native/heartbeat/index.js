/**
 * Hikari Native v0 — Heartbeat.
 *
 * 时间驱动源：每隔一段时间说明一次「时间过去了」，不判断值不值得在意。
 * 它只发 `hikari/attention/worth`，与 project-watch 同一种事件、同一个理由字段，
 * 判断留给 activation 与模型。
 *
 * 为什么需要它：v0 里唯一能唤醒 agent 的是 project-watch，而它盯的是仓库 diff——
 * 仓库不变就永不唤醒。于是「她在没有指令时还活着」这件事根本没有机会发生。
 * 心跳补上的正是这个缺席的驱动源。
 *
 * 边界：
 * - 不读、不写任何文件；不维护状态（除自己的定时器）。
 * - 不做「安静时段」「连续几次没动作就降频」这类策略——那是模型或更上层的事。
 *   现在只提供两个参数：间隔与最小间隔，其余交给消费方。
 */
export const name = 'hikari-heartbeat'
export const inject = []

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000
// 下限 1 分钟：防止配置写错把 agent 打成死循环。
const MIN_INTERVAL_MS = 60 * 1000

function positive(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

export function resolveInterval(config) {
  const wanted = positive(config?.intervalMs, DEFAULT_INTERVAL_MS)
  return Math.max(MIN_INTERVAL_MS, Math.round(wanted))
}

/**
 * 发一次心跳。单独导出，测试可以直接调用它验事件形状，
 * 不必依赖定时器的触发次数（Node 的 mock timer 对 setInterval 的
 * 触发次数与实现细节有关，不适合拿来断言）。
 */
export function emitBeat(ctx, intervalMs) {
  try {
    ctx.emit('hikari/attention/worth', {
      reason: 'time-passed',
      at: Date.now(),
      intervalMs,
    })
  } catch (error) {
    ctx.logger.warn(`hikari heartbeat: emit failed: ${error.message}`)
  }
}

export function apply(ctx, config) {
  const intervalMs = resolveInterval(config)
  let timer

  timer = setInterval(() => { emitBeat(ctx, intervalMs) }, intervalMs)
  ctx.effect(() => () => {
    clearInterval(timer)
  }, 'hikari.heartbeat.timer')

  ctx.logger.info(`hikari heartbeat ready (interval=${intervalMs}ms)`)
}
