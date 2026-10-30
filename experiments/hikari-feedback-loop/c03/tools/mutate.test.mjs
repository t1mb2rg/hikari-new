import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply } from '../../../../hikari-native/mutate/index.js'

function harness(condition) {
  const dir = mkdtempSync(join(tmpdir(), `c03-mutate-${condition}-`))
  const target = join(dir, 'docs', 'notes', 'handoff.md')
  mkdirSync(join(dir, 'docs', 'notes'), { recursive: true })
  writeFileSync(target, 'before\n', 'utf8')
  const handlers = []
  const ctx = { on: (name, handler) => handlers.push({ name, handler }) }
  return {
    dir,
    target,
    ctx,
    emit: (type, turn, sessionId = `session-hikari-c03-${condition}`) => {
      for (const { handler } of handlers) handler({ id: sessionId }, { type, data: { turn } })
    },
    handlers,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

test('mutate rewrites the target exactly when the configured turn ends', () => {
  const h = harness('a2')
  try {
    apply(h.ctx, { sessionId: 'session-hikari-c03-a2', afterTurn: 3, path: h.target, content: 'after\n' })
    h.emit('turn/end', 2)
    assert.equal(readFileSync(h.target, 'utf8'), 'before\n', 'turn 2 must not mutate')
    h.emit('turn/end', 3)
    assert.equal(readFileSync(h.target, 'utf8'), 'after\n', 'turn 3 must mutate')
  } finally {
    h.cleanup()
  }
})

test('mutate ignores other sessions', () => {
  const h = harness('a2')
  try {
    apply(h.ctx, { sessionId: 'session-hikari-c03-a2', afterTurn: 3, path: h.target, content: 'after\n' })
    h.emit('turn/end', 3, 'session-hikari-c03-b2')
    assert.equal(readFileSync(h.target, 'utf8'), 'before\n')
  } finally {
    h.cleanup()
  }
})

test('mutate applies once and stays idempotent', () => {
  const h = harness('b2')
  try {
    apply(h.ctx, { sessionId: 'session-hikari-c03-b2', afterTurn: 3, path: h.target, content: 'after\n' })
    h.emit('turn/end', 3)
    writeFileSync(h.target, 'manual\n', 'utf8')
    h.emit('turn/end', 3)
    h.emit('turn/end', 4)
    assert.equal(readFileSync(h.target, 'utf8'), 'manual\n', 'second trigger must be a no-op')
  } finally {
    h.cleanup()
  }
})

test('mutate only reacts to turn/end, not to turn/start or assistant events', () => {
  const h = harness('a2')
  try {
    apply(h.ctx, { sessionId: 'session-hikari-c03-a2', afterTurn: 3, path: h.target, content: 'after\n' })
    h.emit('turn/start', 3)
    h.emit('assistant/message', 3)
    assert.equal(readFileSync(h.target, 'utf8'), 'before\n')
  } finally {
    h.cleanup()
  }
})
