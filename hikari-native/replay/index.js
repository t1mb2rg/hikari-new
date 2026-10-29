import { readFileSync } from 'node:fs'

/**
 * Hikari Native v1 — Replay.
 *
 * Feeds a frozen list of real window observations back into the attention
 * event so that a v1 run sees the same observations as v0. The events are
 * emitted in order, one after the previous turn ends, so the agent never
 * queues more than one observation at a time.
 *
 * This plugin exists only for the v0/v1 comparison experiment. It does not
 * read the desktop and it does not decide anything.
 *
 * Revision note (after run 1): the first version bounded the whole replay by
 * `timeoutMs + startDelayMs`, which killed the run while turn 1 was still
 * exploring — only 1 of 16 events was ever emitted. The bound is now an idle
 * guard that resets on every turn/end.
 */
export const name = 'hikari-replay'
export const inject = ['agents']

function loadEvents(path) {
  const raw = readFileSync(path, 'utf8')
  const parsed = JSON.parse(raw)
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`hikari replay: ${path} contains no events`)
  }
  return parsed
}

export function apply(ctx, config) {
  const sessionId = typeof config?.sessionId === 'string' && config.sessionId.length > 0
    ? config.sessionId
    : 'session-hikari-v1'
  const eventsPath = config?.eventsPath
  const startDelayMs = Number.isInteger(config?.startDelayMs) ? config.startDelayMs : 10000
  const gapMs = Number.isInteger(config?.gapMs) ? config.gapMs : 2000
  const idleTimeoutMs = Number.isInteger(config?.idleTimeoutMs) ? config.idleTimeoutMs : 600000

  if (typeof eventsPath !== 'string' || eventsPath.length === 0) {
    ctx.logger.warn('hikari replay: no eventsPath configured; replay disabled')
    return
  }

  const events = loadEvents(eventsPath)
  let index = 0
  let emitted = 0
  let finished = false
  let armed = false
  let idleTimer

  const armIdle = () => {
    if (idleTimer !== undefined) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => finish(`idle for ${idleTimeoutMs}ms with no turn/end`), idleTimeoutMs)
  }

  const finish = (reason) => {
    if (finished) return
    finished = true
    if (idleTimer !== undefined) clearTimeout(idleTimer)
    idleTimer = undefined
    ctx.logger.info(`hikari replay: finished (${reason}); emitted ${emitted}/${events.length}`)
  }

  const emitNext = () => {
    if (finished) return
    if (index >= events.length) {
      finish('all events emitted')
      return
    }
    const event = events[index]
    index += 1
    emitted += 1
    // Keep the original observation timestamp so the rendered clock matches
    // v0 line for line; the replay itself happens in real time.
    const at = typeof event.at === 'number' ? event.at : Date.now()
    ctx.logger.info(`hikari replay: [${emitted}/${events.length}] ${event.previousTitle} -> ${event.snapshotTitle} (${event.process})`)
    try {
      ctx.emit('hikari/attention/worth', {
        reason: 'window-changed',
        snapshot: {
          title: event.snapshotTitle,
          process: event.process,
          at,
        },
        previous: { title: event.previousTitle },
        at,
      })
    } catch (error) {
      ctx.logger.warn(`hikari replay: emit failed: ${error.message}`)
    }
    armIdle()
  }

  // Wait for the DSH agent to exist before the first observation; a wake-up
  // that arrives before the agent is created is dropped by activation.
  const arm = () => {
    if (armed || finished) return
    const agent = ctx.agents.get(sessionId)
    if (agent === undefined) {
      setTimeout(arm, 500)
      return
    }
    armed = true
    armIdle()
    ctx.logger.info(`hikari replay: agent ${sessionId} ready; starting in ${startDelayMs}ms (${events.length} events)`)
    setTimeout(emitNext, startDelayMs)
  }

  const onSessionEvent = (session, event) => {
    if (!armed || finished) return
    if (session?.id !== sessionId) return
    if (event?.type !== 'turn/end') return
    setTimeout(emitNext, gapMs)
  }

  ctx.on('session/event', onSessionEvent)

  ctx.effect(() => () => {
    if (idleTimer !== undefined) clearTimeout(idleTimer)
    finished = true
  }, 'hikari.replay.timer')

  arm()
  ctx.logger.info(`hikari replay ready (agent=${sessionId}, events=${events.length}, idleTimeout=${idleTimeoutMs}ms)`)
}
