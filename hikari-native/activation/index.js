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

export function apply(ctx, config) {
  const sessionId = typeof config?.sessionId === 'string' && config.sessionId.length > 0
    ? config.sessionId
    : 'session-hikari-v0'

  const activate = (event) => {
    if (event?.reason !== 'window-changed') return

    const agent = ctx.agents.get(sessionId)
    if (agent === undefined) {
      ctx.logger.warn(`hikari activation: agent ${sessionId} is not ready; observation dropped`)
      return
    }
    if (typeof agent.followup !== 'function') {
      ctx.logger.warn(`hikari activation: agent ${sessionId} has no followup(); observation dropped`)
      return
    }

    const message = {
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: renderPrompt(event) }],
      source: { kind: 'user' },
    }

    try {
      agent.followup(message)
      ctx.logger.info(`hikari activation: woke agent ${sessionId} for "${event.snapshot?.title ?? 'unknown window'}"`)
    } catch (error) {
      ctx.logger.warn(`hikari activation: followup failed: ${error.message}`)
    }
  }

  ctx.on('hikari/attention/worth', activate)
  ctx.logger.info(`hikari activation ready (agent=${sessionId})`)
}
