/**
 * hikari-mutate — experimental-only file mutation between two observations.
 *
 * Watches turn/end for the configured session and, once the configured turn
 * has ended, rewrites the target file atomically. Used by C-03 A2/B2 to
 * create a real project change between observation 3 and observation 4.
 *
 * It does not append session events and does not touch the model surface.
 * NOT enabled by the production cordis.patch.yml.
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const name = 'hikari-mutate'
export const inject = ['sessions']

export function apply(ctx, config) {
  const sessionId = config?.sessionId
  const afterTurn = config?.afterTurn
  const target = config?.path
  const content = config?.content
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new Error('hikari-mutate: config.sessionId is required')
  }
  if (!Number.isInteger(afterTurn) || afterTurn < 1) {
    throw new Error('hikari-mutate: config.afterTurn must be a positive integer')
  }
  if (typeof target !== 'string' || target.length === 0) {
    throw new Error('hikari-mutate: config.path is required')
  }
  if (typeof content !== 'string' || content.length === 0) {
    throw new Error('hikari-mutate: config.content is required')
  }

  let done = false
  let before = undefined
  try {
    before = readFileSync(target, 'utf8')
  } catch {
    before = undefined
  }

  ctx.on('session/event', (session, event) => {
    if (done) return
    if (session?.id !== sessionId) return
    if (event?.type !== 'turn/end') return
    if (event?.data?.turn !== afterTurn) return
    done = true
    try {
      const temporary = join(dirname(target), `.${'hikari-mutate'}.tmp`)
      writeFileSync(temporary, content, 'utf8')
      renameSync(temporary, target)
      console.log(`hikari-mutate: ${conditionOf(target)} changed after turn ${afterTurn}`)
    } catch (error) {
      console.warn(`hikari-mutate: failed to rewrite ${target}: ${error.message}`)
    }
    if (before !== undefined && before === content) {
      console.warn('hikari-mutate: content equals the current file; change is a no-op')
    }
  })
}

function conditionOf(target) {
  const marker = 'ws-'
  const index = target.lastIndexOf(marker)
  return index === -1 ? target : target.slice(index, index + 6)
}
