import { randomUUID } from 'node:crypto'

/**
 * Hikari Native v0 — Agent Activation.
 *
 * Consumes Attention decisions and wakes the DSH agent configured by
 * `agent-loop`. The agent is created and owned by DSH; this plugin never
 * creates or disposes it, so reloading Activation does not end the agent.
 */
export const name = 'hikari-activation'
export const inject = ['agents']

function renderPrompt(event) {
  const snapshot = event.snapshot ?? {}
  const previous = event.previous ?? {}
  const at = new Date(typeof event.at === 'number' ? event.at : Date.now())
  const clock = at.toLocaleTimeString('zh-CN', { hour12: false })
  return [
    `[Hikari 自主观察 ${clock}]`,
    `前台窗口从「${previous.title ?? '（未知）'}」切换到「${snapshot.title ?? '（未知）'}」（进程 ${snapshot.process ?? '未知'}）。`,
    '',
    '这次切换让你想起了你在意的那件事吗？自己判断，不要套用规则。',
    '- 如果毫无关系（他只是在闲聊、听歌、切回来看看），就说无关，并用一句话说清为什么无关。',
    '- 如果有关，或者你拿不准，就自己去找：读文件、搜关键词。找到之后写下你发现了什么；如果想知道的东西现有条件查不到，就把它写出来。',
    '',
    '这是你自己的观察循环。不要联系用户。',
  ].join('\n')
}

function renderProjectPrompt(event) {
  const at = new Date(typeof event.at === 'number' ? event.at : Date.now())
  const clock = at.toLocaleTimeString('zh-CN', { hour12: false })
  const previous = event.previous ?? {}
  const current = event.current ?? {}
  const changed = Array.isArray(event.changed) ? event.changed : []

  const lines = [`[Hikari 自主观察 ${clock}]`, '仓库状态变了。', '']
  if (changed.includes('head')) {
    lines.push(`- 提交：${previous.head?.short ?? '?'} → ${current.head?.short ?? '?'}（${current.head?.subject ?? '无标题'}）`)
  }
  if (changed.includes('branch')) {
    lines.push(`- 分支：${previous.branch ?? '?'} → ${current.branch ?? '?'}`)
  }
  if (changed.includes('workingTree')) {
    lines.push(`- 工作区：${previous.workingTree?.total ?? '?'} 个改动 → ${current.workingTree?.total ?? '?'} 个`)
  }
  lines.push(
    '',
    '这是你一直在看的那个项目。变了什么、意味着什么、值不值得继续看下去，你自己判断。',
    '- 如果这个变化和你在意的事无关，就说无关，一句话说清为什么。',
    '- 如果有关，或者你拿不准，就自己去看：读提交、读文件、搜关键词。看到什么就写什么。',
    '- 想知道但现有条件查不到的，直接写出来。',
    '',
    '这是你自己的观察循环。不要联系用户。',
  )
  return lines.join('\n')
}

export function apply(ctx, config) {
  const sessionId = typeof config?.sessionId === 'string' && config.sessionId.length > 0
    ? config.sessionId
    : 'session-hikari-v0'

  const activate = (event) => {
    const reason = event?.reason
    if (reason !== 'window-changed' && reason !== 'project-changed') return

    const agent = ctx.agents.get(sessionId)
    if (agent === undefined) {
      ctx.logger.warn(`hikari activation: agent ${sessionId} is not ready; observation dropped`)
      return
    }
    if (typeof agent.followup !== 'function') {
      ctx.logger.warn(`hikari activation: agent ${sessionId} has no followup(); observation dropped`)
      return
    }

    const text = reason === 'project-changed' ? renderProjectPrompt(event) : renderPrompt(event)
    const message = {
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    }

    try {
      agent.followup(message)
      const what = reason === 'project-changed'
        ? `project ${(event.changed ?? []).join('+')}`
        : `window "${event.snapshot?.title ?? 'unknown'}"`
      ctx.logger.info(`hikari activation: woke agent ${sessionId} for ${what}`)
    } catch (error) {
      ctx.logger.warn(`hikari activation: followup failed: ${error.message}`)
    }
  }

  ctx.on('hikari/attention/worth', activate)
  ctx.logger.info(`hikari activation ready (agent=${sessionId})`)
}
