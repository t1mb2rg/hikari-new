/**
 * Hikari Native v0 — 前台窗口的短期缓冲。
 *
 * Perception 每看到一次（进程，标题）变化就记一条。这里只做三件事：
 * 保留最近若干条、按时间窗取回、把标题截短。它**不落盘**——缓冲活在进程
 * 内存里，重启即丢；也不判断"值不值得在意"，那是模型的事。
 *
 * 之所以要有这一层：窗口事件本来是"发生即丢"的（world 只在唤醒决策里用
 * 一次）。可是要让她知道自己这半小时身边发生了什么，就得有人把它攒起来，
 * 等她被叫醒（心跳）时再一起交给她。攒在 Perception 里，是因为它就是那份
 * 观察的来源；Activation 只负责措辞。
 */

/** Perception 向其它插件暴露的只读缓冲（单段名，与 DSH 自身 service 同风格）。 */
export const WINDOW_LOG_SERVICE = 'hikariWindowLog'

/** 最多留多少条。30 分钟高频切换也够；再多就是记账本身成了目的。 */
export const MAX_ENTRIES = 400

/** 标题只留前 60 个码元：够她认出"在做什么"，又不会把整篇正文抄进上下文。 */
export const MAX_TITLE_CHARS = 60

export const DEFAULT_RECAP_MS = 30 * 60 * 1000
export const DEFAULT_RECAP_LIMIT = 5
export const MAX_RECAP_LIMIT = 10
export const MAX_RECAP_APPS = 8

function shorten(title, maxTitle) {
  const flat = typeof title === 'string' ? title.replace(/\s+/gu, ' ').trim() : ''
  if (flat.length === 0) return ''
  return flat.length > maxTitle ? `${flat.slice(0, maxTitle)}…` : flat
}

/**
 * 追加一条观察。返回缓冲本身（方便测试里连写），不抛错。
 * 同一（进程，标题）连续重复不会走到这里——去重在 Perception 的 observe()。
 */
export function appendWindowLog(buffer, entry, options = {}) {
  const max = Number.isInteger(options.max) && options.max > 0 ? options.max : MAX_ENTRIES
  const maxTitle = Number.isInteger(options.maxTitle) && options.maxTitle > 0
    ? options.maxTitle
    : MAX_TITLE_CHARS
  const title = shorten(entry?.title, maxTitle)
  if (title.length === 0) return buffer
  buffer.push({
    at: typeof entry?.at === 'number' ? entry.at : Date.now(),
    process: typeof entry?.process === 'string' && entry.process.length > 0 ? entry.process : 'unknown',
    title,
  })
  while (buffer.length > max) buffer.shift()
  return buffer
}

/**
 * 取回一个时间窗内的观察：多少次、涉及哪些程序、最近几条。
 * `count` 是窗口内的全部条数（不受 `limit` 影响）；`entries` 只给最近
 * `limit` 条，按时间升序——这样调用方拼提示词时不用再排序。
 */
export function summarizeWindowLog(buffer, options = {}) {
  const sinceMs = Number.isFinite(options.sinceMs) && options.sinceMs > 0 ? options.sinceMs : DEFAULT_RECAP_MS
  const now = typeof options.now === 'number' ? options.now : Date.now()
  const limit = Number.isInteger(options.limit) && options.limit > 0
    ? Math.min(options.limit, MAX_RECAP_LIMIT)
    : DEFAULT_RECAP_LIMIT
  const cut = now - sinceMs

  const inside = []
  for (const entry of buffer) {
    if (entry.at >= cut && entry.at <= now) inside.push(entry)
  }

  const apps = []
  for (const entry of inside) {
    if (!apps.includes(entry.process) && apps.length < MAX_RECAP_APPS) apps.push(entry.process)
  }

  return {
    sinceMs,
    now,
    count: inside.length,
    apps,
    firstAt: inside.length > 0 ? inside[0].at : null,
    lastAt: inside.length > 0 ? inside[inside.length - 1].at : null,
    entries: inside.slice(-limit),
  }
}

/**
 * 暴露只读接口。返回的对象被冻结；`recent()` 每次现算，消费者拿不到缓冲本身，
 * 也改不动 Perception 的状态。没有数据时 `count` 为 0，不编内容。
 */
export function provideWindowLog(ctx, buffer) {
  ctx.provide(WINDOW_LOG_SERVICE, Object.freeze({
    recent: (options) => summarizeWindowLog(buffer, options),
    describe: () => ({ entries: buffer.length, maxEntries: MAX_ENTRIES, durable: false }),
  }))
}
