/**
 * hikari-readscope — experimental-only "what has this session already read" summary.
 *
 * Registers a neutral system-prompt context section listing the files this
 * session has already read (most recent first). It adds no instruction about
 * whether to re-read: it only makes the existing check history visible.
 *
 * The list is rebuilt from the session log lazily, so a restart keeps it.
 *
 * NOT enabled by the production `cordis.patch.yml`; experiments only.
 */
export const name = 'hikari-readscope'
export const inject = ['systemPrompt', 'sessions']

const MAX_ENTRIES = 12

/**
 * Read one tool/call event into a `{ path, offset, limit }` descriptor.
 * @param {unknown} event
 * @returns {{ path: string, offset: number, limit?: number } | undefined}
 */
function readCallOf(event) {
  const data = event?.data ?? {}
  const call = data.call ?? data
  const name = call?.name ?? call?.tool
  if (name !== 'read') return undefined
  const rawArgs = call?.args ?? call?.arguments ?? call?.input
  let parsed
  try {
    parsed = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs
  } catch {
    return undefined
  }
  const path = parsed?.file_path ?? parsed?.path
  if (typeof path !== 'string' || path.length === 0) return undefined
  return { path, offset: parsed?.offset ?? 0, limit: parsed?.limit }
}

export function apply(ctx, config) {
  const sessionId = config?.sessionId
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new Error('hikari-readscope: config.sessionId is required')
  }
  /** @type {{ path: string, offset: number, limit?: number }[]} */
  const recent = []
  let primed = false

  const push = (entry) => {
    if (entry === undefined) return
    recent.unshift(entry)
    if (recent.length > MAX_ENTRIES) recent.length = MAX_ENTRIES
  }

  const prime = () => {
    if (primed) return
    const session = ctx.sessions.get(sessionId)
    if (session === undefined) return
    primed = true
    for (let seq = 0; seq < session.seq; seq += 1) {
      const event = session.eventAt(seq)
      if (event?.type === 'tool/call') push(readCallOf(event))
    }
  }

  ctx.on('session/event', (session, event) => {
    if (session?.id !== sessionId) return
    if (event?.type !== 'tool/call') return
    push(readCallOf(event))
  })

  ctx.systemPrompt.context({
    name: 'hikari:readscope',
    order: 160,
    text: () => {
      prime()
      if (recent.length === 0) return ''
      const lines = recent.map((entry) => {
        const span = entry.limit === undefined ? '' : `，limit ${entry.limit}`
        return `- ${entry.path}（offset ${entry.offset}${span}）`
      })
      return ['本会话已检查过的文件（最近在前，仅记录，不含内容）：', ...lines].join('\n')
    },
  })
}
