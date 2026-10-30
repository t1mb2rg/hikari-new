import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  RESULT_DENIED,
  RESULT_ERROR,
  RESULT_PENDING,
  RESULT_SUCCESS,
  RESULT_UNKNOWN,
  classify,
  inspectedDigest,
  observedRangeOf,
  pairToolEvents,
  parseCall,
  parseResult,
  readRangeOf,
  resolveFindingEvidence,
} from './tool-evidence.mjs'

/** Build a real-shaped tool/call event. */
function call(id, name, args, extra = {}) {
  return {
    type: 'tool/call',
    seq: extra.seq ?? 10,
    time: 1,
    data: {
      turn: 1,
      step: 1,
      callId: id,
      name,
      arguments: typeof args === 'string' ? args : JSON.stringify(args),
      ...extra.data,
    },
  }
}

/** Build a real-shaped tool/result event. */
function result(id, text, options = {}) {
  return {
    type: 'tool/result',
    seq: options.seq ?? 11,
    time: 2,
    data: {
      turn: 1,
      step: 1,
      message: {
        role: 'tool',
        source: { kind: 'tool', callId: id },
        toolCallId: id,
        content: [{ type: 'text', text }],
        isError: options.isError === true,
        id: 'msg',
      },
    },
    sourceEventSeqs: [10],
    surfaceOp: 'append',
  }
}

test('parseCall extracts callId/name/args from a real tool/call event', () => {
  const parsed = parseCall(call('call_1', 'read', { file_path: 'a.txt', offset: 2, limit: 5 }))
  assert.equal(parsed.callId, 'call_1')
  assert.equal(parsed.name, 'read')
  assert.deepEqual(parsed.args, { file_path: 'a.txt', offset: 2, limit: 5 })
})

test('parseCall keeps unparsable arguments as undefined instead of guessing', () => {
  const parsed = parseCall(call('call_2', 'read', '{not json'))
  assert.equal(parsed.args, undefined)
  assert.equal(parsed.rawArguments, '{not json')
})

test('success pair: observed range matches the requested offset/limit', () => {
  const events = [
    call('c1', 'read', { file_path: 'inside.txt', offset: 0 }, { seq: 20 }),
    result('c1', '1: INSIDE_ROOT_OK_42', { seq: 21 }),
  ]
  const { pairs, orphanResults } = pairToolEvents(events)
  assert.equal(orphanResults.length, 0)
  assert.equal(pairs.length, 1)
  assert.equal(pairs[0].status, RESULT_SUCCESS)
  const observed = observedRangeOf(pairs[0])
  assert.equal(observed.kind, 'inspected')
  assert.equal(observed.path, 'inside.txt')
  assert.equal(observed.lines, 1)
  assert.equal(observed.firstLineNo, 1)
  assert.equal(observed.matchesRequest, true)
})

test('success pair with offset: first rendered line number is offset+1', () => {
  const events = [
    call('c2', 'read', { file_path: 'big.txt', offset: 40, limit: 3 }, { seq: 30 }),
    result('c2', '41: forty-one\n42: forty-two\n43: forty-three', { seq: 31 }),
  ]
  const { pairs } = pairToolEvents(events)
  const observed = observedRangeOf(pairs[0])
  assert.equal(observed.startOk, true)
  assert.equal(observed.lines, 3)
  assert.equal(observed.matchesRequest, true)
})

test('range mismatch is reported, not silently accepted', () => {
  const events = [
    call('c3', 'read', { file_path: 'a.txt', offset: 10, limit: 2 }, { seq: 40 }),
    result('c3', '1: wrong start\n2: wrong start', { seq: 41 }),
  ]
  const { pairs } = pairToolEvents(events)
  const observed = observedRangeOf(pairs[0])
  assert.equal(observed.kind, 'inspected')
  assert.equal(observed.matchesRequest, false)
  assert.equal(observed.startOk, false)
})

test('refused read is classified as denied and never counts as inspected', () => {
  const events = [
    call('c4', 'read', { file_path: '../outside/secret.txt' }, { seq: 50 }),
    result('c4', 'scoped-fs: "../outside/secret.txt" is outside the authorized directory', { seq: 51, isError: true }),
  ]
  const { pairs } = pairToolEvents(events)
  assert.equal(pairs[0].status, RESULT_DENIED)
  const observed = observedRangeOf(pairs[0])
  assert.equal(observed.kind, 'not-inspected')
  const digest = inspectedDigest(pairs)
  assert.equal(digest.inspected.length, 0)
  assert.equal(digest.notInspected.length, 1)
  assert.equal(digest.notInspected[0].status, RESULT_DENIED)
})

test('other tool error is classified as error', () => {
  const events = [
    call('c5', 'read', { file_path: 'missing.txt' }, { seq: 60 }),
    result('c5', 'ENOENT: no such file or directory', { seq: 61, isError: true }),
  ]
  const { pairs } = pairToolEvents(events)
  assert.equal(pairs[0].status, RESULT_ERROR)
})

test('call without result stays pending', () => {
  const events = [call('c6', 'read', { file_path: 'pending.txt' }, { seq: 70 })]
  const { pairs } = pairToolEvents(events)
  assert.equal(pairs[0].status, RESULT_PENDING)
  assert.equal(observedRangeOf(pairs[0]).kind, 'not-inspected')
})

test('result without call is an orphan, not attached to the nearest call', () => {
  const events = [call('c7', 'read', { file_path: 'a.txt' }, { seq: 80 }), result('c8', 'some text', { seq: 81 })]
  const { pairs, orphanResults } = pairToolEvents(events)
  assert.equal(pairs.length, 1)
  assert.equal(pairs[0].status, RESULT_PENDING)
  assert.equal(orphanResults.length, 1)
  assert.equal(orphanResults[0].callId, 'c8')
})

test('readRangeOf stays unknown for non-read tools and missing path', () => {
  assert.equal(readRangeOf({ callId: 'x', name: 'grep', args: { pattern: 'x' } }).kind, 'unknown')
  assert.equal(readRangeOf({ callId: 'x', name: 'read', args: {} }).kind, 'unknown')
})

test('resolveFindingEvidence never falls back to the most recent successful call', () => {
  const events = [
    call('old', 'read', { file_path: 'a.txt' }, { seq: 100 }),
    result('old', '1: old', { seq: 101 }),
    call('new', 'read', { file_path: 'b.txt' }, { seq: 102 }),
    result('new', '1: new', { seq: 103 }),
  ]
  const { pairs } = pairToolEvents(events)
  const resolved = resolveFindingEvidence([{ kind: 'tool-result', seq: 999, callId: 'missing' }], pairs)
  assert.equal(resolved[0].kind, 'unknown')
})

test('resolveFindingEvidence resolves an explicit successful callId', () => {
  const events = [
    call('c9', 'read', { file_path: 'a.txt', offset: 0 }, { seq: 110 }),
    result('c9', '1: A', { seq: 111 }),
  ]
  const { pairs } = pairToolEvents(events)
  const resolved = resolveFindingEvidence([{ kind: 'tool-result', seq: 110, callId: 'c9' }], pairs)
  assert.equal(resolved[0].kind, 'resolved')
  assert.equal(resolved[0].callId, 'c9')
  assert.equal(resolved[0].observed.path, 'a.txt')
})

test('resolveFindingEvidence marks evidence pointing at a refused call as invalid', () => {
  const events = [
    call('c10', 'read', { file_path: '../x' }, { seq: 120 }),
    result('c10', 'scoped-fs: "../x" is outside the authorized directory', { seq: 121, isError: true }),
  ]
  const { pairs } = pairToolEvents(events)
  const resolved = resolveFindingEvidence([{ kind: 'tool-result', seq: 120, callId: 'c10' }], pairs)
  assert.equal(resolved[0].kind, 'invalid')
  assert.equal(resolved[0].status, RESULT_DENIED)
})

test('empty evidence is unknown, not silently assumed', () => {
  assert.equal(resolveFindingEvidence([], []).length, 1)
  assert.equal(resolveFindingEvidence([], [])[0].kind, 'unknown')
})

test('classify returns unknown for an error with empty content', () => {
  const parsedCall = parseCall(call('c11', 'read', { file_path: 'x' }))
  const parsedResult = parseResult({
    type: 'tool/result',
    seq: 130,
    data: { turn: 1, step: 1, message: { toolCallId: 'c11', content: [], isError: true } },
  })
  assert.deepEqual(parsedResult.content, [])
  assert.equal(classify(parsedCall, parsedResult), RESULT_UNKNOWN)
})
