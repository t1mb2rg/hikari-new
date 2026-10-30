/**
 * hikari-trace — experimental-only request recorder.
 *
 * Hooks the `llm/stream` waterfall (the documented interception point) and
 * appends one JSON line per real model request to `config.path`. It observes
 * the final request object built by `dsh-agent-loop` (messages + tools +
 * toolHistory) and never mutates it.
 *
 * This plugin is NOT enabled by the production `cordis.patch.yml`; it exists
 * only for `experiments/hikari-feedback-loop` diagnoses.
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export const name = 'hikari-trace'
export const inject = ['llm']

function summarizeContent(content) {
  if (!Array.isArray(content)) return []
  return content.map((part) => {
    if (typeof part?.text === 'string') {
      return { type: part.type ?? 'text', len: part.text.length, text: part.text.slice(0, 1600) }
    }
    if (part?.type === 'tool-call') {
      const args = part.args ?? part.arguments ?? part.input
      return {
        type: 'tool-call',
        name: part.name,
        callId: part.callId ?? part.id,
        args: typeof args === 'string' ? args.slice(0, 400) : JSON.stringify(args ?? null).slice(0, 400),
      }
    }
    return { type: part?.type ?? 'unknown' }
  })
}

function summarizeMessages(messages) {
  if (!Array.isArray(messages)) return []
  return messages.map((message) => ({
    id: message?.id,
    role: message?.role,
    toolCallId: message?.toolCallId,
    isError: message?.isError,
    source: message?.source?.kind,
    content: summarizeContent(message?.content),
  }))
}

/**
 * Register the recorder.
 * @param {import('cordis').Context} ctx
 * @param {{ path?: string }} [config]
 */
export function apply(ctx, config) {
  const raw = config?.path
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('hikari-trace: config.path is required (absolute dump path)')
  }
  const path = resolve(raw)
  mkdirSync(dirname(path), { recursive: true })
  let index = 0
  ctx.on('llm/stream', (options, next) => {
    try {
      index += 1
      const tools = Array.isArray(options?.tools) ? options.tools.map((tool) => tool?.name) : undefined
      const record = {
        index,
        at: Date.now(),
        provider: options?.provider,
        model: options?.model,
        sessionId: options?.sessionId,
        tools,
        hasToolHistory: options?.toolHistory !== undefined,
        messages: summarizeMessages(options?.messages),
      }
      appendFileSync(path, `${JSON.stringify(record)}\n`, 'utf8')
    } catch (error) {
      console.error('[hikari-trace] failed to record request:', error)
    }
    return next()
  })
}
