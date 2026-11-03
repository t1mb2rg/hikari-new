/**
 * Hikari Native v0 — Project watcher（方向 2：换驱动源）.
 *
 * v1 的读数说得很直白：16 次唤醒里 14 次的窗口只是切回同一个 DSH 标签页，
 * 窗口标题这一类事件本身几乎不携带「项目有没有推进」的信息。所以这一版不再
 * 问「前台是哪个窗口」，改问「这个仓库真的变了没有」——那才是她声称在意的
 * 那件事对应的那类事件。
 *
 * 它只做一件事：定时采样只读的 git 状态（HEAD、分支、工作区脏文件数），与
 * 上一条基线比较，变了就发出与 World 同一种 `hikari/attention/worth` 事件，
 * 因此 Activation 与 agent loop 一行都不用改。
 *
 * 这不是注意力判断。它决定的是「有事发生了」，从不决定「这事重要」。变化意味
 * 着什么、值不值得看下去，留给模型。所以它的阈值只有防抖与去重，没有「值不值
 * 得」的规则——那正是 v0 里 `worth` 这个名字名不副实的原因。
 */
import { git, summarizePorcelain } from '../project-status/index.js'

export const name = 'hikari-project-watch'
export const inject = []

const DEFAULT_INTERVAL_MS = 30_000
const DEFAULT_COOLDOWN_MS = 120_000

function positive(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

/** 一次采样。只读；任何一条 git 失败就整条返回 undefined，宁可漏报也不误报。 */
export async function sampleProject(root) {
  try {
    const [headLine, branch, porcelain] = await Promise.all([
      git(root, ['log', '-1', '--format=%h%x00%s']),
      git(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
      git(root, ['status', '--porcelain']),
    ])
    const [short, subject = ''] = headLine.split('\u0000')
    const changes = summarizePorcelain(porcelain)
    return {
      branch,
      head: { short, subject },
      workingTree: { clean: changes.total === 0, total: changes.total, counts: changes.counts },
    }
  } catch {
    return undefined
  }
}

/** 两次采样之间有意义的差别。只比较这三项，别的都不算「项目变了」。 */
export function diffProject(previous, current) {
  if (previous === undefined || current === undefined) return []
  const changed = []
  if (previous.head.short !== current.head.short) changed.push('head')
  if (previous.branch !== current.branch) changed.push('branch')
  if (previous.workingTree.total !== current.workingTree.total) changed.push('workingTree')
  return changed
}

export function apply(ctx, config) {
  const root = String(config?.root ?? process.cwd())
  const intervalMs = positive(config?.intervalMs, DEFAULT_INTERVAL_MS)
  const cooldownMs = positive(config?.cooldownMs, DEFAULT_COOLDOWN_MS)

  let baseline
  let lastEmittedAt = 0
  let timer
  let stopped = false

  const tick = async () => {
    if (stopped) return
    const current = await sampleProject(root)
    if (current === undefined) return

    // 第一次采样只建立基线：启动时仓库本来就长这样，不构成「变化」。
    if (baseline === undefined) {
      baseline = current
      ctx.logger.info(`hikari project-watch: baseline ${current.head.short} (${current.workingTree.total} changed)`)
      return
    }

    const changed = diffProject(baseline, current)
    const previous = baseline
    baseline = current
    if (changed.length === 0) return

    const now = Date.now()
    if (now - lastEmittedAt < cooldownMs) return
    lastEmittedAt = now

    ctx.emit('hikari/attention/worth', {
      reason: 'project-changed',
      previous,
      current,
      changed,
      root,
      at: now,
    })
    ctx.logger.info(`hikari project-watch: ${changed.join('+')} changed (${previous.head.short} → ${current.head.short})`)
  }

  timer = setInterval(() => { void tick() }, intervalMs)
  ctx.effect(() => () => {
    stopped = true
    clearInterval(timer)
  }, 'hikari.project-watch.timer')

  ctx.logger.info(`hikari project-watch ready (root=${root}, interval=${intervalMs}ms, cooldown=${cooldownMs}ms)`)
}
