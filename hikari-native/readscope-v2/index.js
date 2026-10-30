/**
 * hikari-readscope-v2 — experimental-only "what was actually inspected" digest.
 *
 * Differences from v1 (C-02 defect):
 *   - pairs tool/call with tool/result strictly by callId;
 *   - only successful reads with a verifiable range count as inspected;
 *   - refused / failed / pending reads are listed separately and never
 *     merged into the inspected list;
 *   - the rendered range is cross-checked against offset/limit.
 *
 * It still adds no instruction about whether to re-read.
 *
 * NOT enabled by the production `cordis.patch.yml`; experiments only.
 */
import {
  RESULT_SUCCESS,
  inspectedDigest,
  observedRangeOf,
  pairToolEvents,
} from '../../experiments/hikari-feedback-loop/c03/tools/tool-evidence.mjs'

export const name = 'hikari-readscope-v2'
export const inject = ['systemPrompt', 'sessions']

const MAX_ENTRIES = 12

function render(events) {
  const { pairs } = pairToolEvents(events)
  const digest = inspectedDigest(pairs, { limit: MAX_ENTRIES })
  const lines = []
  if (digest.inspected.length > 0) {
    lines.push('本会话已成功读取并返回内容的范围（最近在前，仅记录，不含内容）：')
    for (const entry of digest.inspected) {
      const span = entry.limit === undefined ? '' : `，limit ${entry.limit}`
      const matched = entry.matchesRequest ? '' : '（返回范围与请求不一致）'
      lines.push(`- ${entry.path}（offset ${entry.offset}${span}；实际返回 ${entry.lines} 行，起始行 ${entry.firstLineNo ?? '未知'}）${matched}`)
    }
  }
  const failed = digest.notInspected.filter((entry) => entry.status !== 'pending')
  if (failed.length > 0) {
    lines.push('被拒绝或失败的读取（不计入已检查）：')
    for (const entry of failed) {
      const reason = entry.status === 'denied' ? '越界拒绝' : entry.status === 'error' ? '工具错误' : entry.status
      lines.push(`- ${entry.path}（${reason}）`)
    }
  }
  return lines.join('\n')
}

export function apply(ctx, config) {
  const sessionId = config?.sessionId
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new Error('hikari-readscope-v2: config.sessionId is required')
  }

  /** @type {unknown[]} */
  const events = []
  let primed = false

  const prime = () => {
    if (primed) return
    const session = ctx.sessions.get(sessionId)
    if (session === undefined) return
    primed = true
    for (let seq = 0; seq < session.seq; seq += 1) {
      const event = session.eventAt(seq)
      if (event !== undefined) events.push(event)
    }
  }

  ctx.on('session/event', (session, event) => {
    if (session?.id !== sessionId) return
    if (event?.type !== 'tool/call' && event?.type !== 'tool/result') return
    events.push(event)
  })

  ctx.systemPrompt.context({
    name: 'hikari:readscope',
    order: 160,
    text: () => {
      prime()
      return events.length === 0 ? '' : render(events)
    },
  })
}

export { observedRangeOf, RESULT_SUCCESS }
