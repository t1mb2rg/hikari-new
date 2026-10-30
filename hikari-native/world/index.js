/**
 * Hikari Native v0 — World + Attention.
 *
 * Keeps the minimal world state (what the user is currently looking at, the
 * previous observation, and the last Hikari turn activity) and decides
 * whether an observed change is worth waking the agent for. The decision
 * happens before `followup()`; `agent/pre-step` cannot replace it.
 *
 * The session-event listener is filtered to Hikari's own session: it never
 * absorbs events from unrelated user conversations.
 *
 * With `config.root` set, this plugin also installs the World findings layer
 * (see ./findings.js): durable `plugin:hikari/finding` records in the session
 * log, a projection that derives the current认识, and a per-request
 * `systemPrompt.context()` section carrying the bounded current findings.
 */
import { installFindings } from './findings.js'

export const name = 'hikari-world'
export const inject = ['sessions', 'sessionProjections', 'systemPrompt', 'tools']

const IGNORED_PROCESSES = new Set([
  'dsh',
  'electron',
  'powershell',
  'pwsh',
  'node',
  'windowsterminal',
  'conhost',
])

const MAX_HISTORY = 20
const DEFAULT_SETTLE_MS = 900
const DEFAULT_COOLDOWN_MS = 45000

function positive(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function signatureOf(snapshot) {
  return `${snapshot.process}\u0000${snapshot.title}`
}

export function apply(ctx, config) {
  const sessionId = typeof config?.sessionId === 'string' && config.sessionId.length > 0
    ? config.sessionId
    : 'session-hikari-v0'
  const settleMs = positive(config?.settleMs, DEFAULT_SETTLE_MS)
  const cooldownMs = positive(config?.cooldownMs, DEFAULT_COOLDOWN_MS)

  const world = {
    current: undefined,
    previous: undefined,
    history: [],
    lastConsumed: undefined,
    lastWokenAt: 0,
    lastTurnEndedAt: 0,
    lastTurnReason: undefined,
    lastAssistantAt: 0,
  }

  let settleTimer
  let started = false

  const clearSettle = () => {
    if (settleTimer !== undefined) {
      clearTimeout(settleTimer)
      settleTimer = undefined
    }
  }

  const settle = () => {
    settleTimer = undefined
    const snapshot = world.current
    if (snapshot === undefined) return
    if (IGNORED_PROCESSES.has(String(snapshot.process).toLowerCase())) return
    if (signatureOf(snapshot) === world.lastConsumed) return

    const now = Date.now()
    if (now - world.lastWokenAt < cooldownMs) return
    if (now - snapshot.at < settleMs) return

    world.lastConsumed = signatureOf(snapshot)
    world.lastWokenAt = now
    ctx.emit('hikari/attention/worth', {
      reason: 'window-changed',
      snapshot,
      previous: world.previous,
      at: now,
    })
    ctx.logger.info(`hikari attention: "${snapshot.title}" (${snapshot.process}) is worth reasoning about`)
  }

  ctx.on('hikari/perception/window', (snapshot) => {
    world.previous = world.current
    world.current = snapshot
    world.history.push(snapshot)
    if (world.history.length > MAX_HISTORY) {
      world.history.splice(0, world.history.length - MAX_HISTORY)
    }

    // The first observation only establishes a baseline; a window that was
    // already in front at startup did not "change".
    if (!started) {
      started = true
      world.lastConsumed = signatureOf(snapshot)
      return
    }
    if (IGNORED_PROCESSES.has(String(snapshot.process).toLowerCase())) return
    clearSettle()
    settleTimer = setTimeout(settle, settleMs)
  })

  ctx.on('session/event', (session, event) => {
    if (session.id !== sessionId) return
    if (event.type === 'turn/end') {
      world.lastTurnEndedAt = Date.now()
      world.lastTurnReason = event.data?.reason?.kind ?? event.data?.reason ?? null
    } else if (event.type === 'assistant/message') {
      world.lastAssistantAt = Date.now()
    }
  })

  ctx.effect(() => () => {
    clearSettle()
  }, 'hikari.world.settle-timer')

  if (typeof config?.root === 'string' && config.root.length > 0) {
    installFindings(ctx, { sessionId, root: config.root, injectContext: config.injectContext !== false })
  }

  ctx.logger.info(`hikari world ready (session=${sessionId}, settle=${settleMs}ms, cooldown=${cooldownMs}ms)`)
}
