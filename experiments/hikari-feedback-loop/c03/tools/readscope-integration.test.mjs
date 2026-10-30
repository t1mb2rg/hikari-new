import assert from 'node:assert/strict'
import { test } from 'node:test'
import { render } from '../../../../hikari-native/readscope-v2/index.js'
import { inspectedDigest, pairToolEvents } from './tool-evidence.mjs'

function call(id, name, args, seq) {
  return {
    type: 'tool/call',
    seq,
    time: 1,
    data: { turn: 1, step: 1, callId: id, name, arguments: JSON.stringify(args) },
  }
}

function result(id, text, seq, isError = false) {
  return {
    type: 'tool/result',
    seq,
    time: 2,
    data: {
      turn: 1,
      step: 1,
      message: {
        role: 'tool',
        source: { kind: 'tool', callId: id },
        toolCallId: id,
        content: [{ type: 'text', text }],
        isError,
        id: 'm',
      },
    },
  }
}

test('digest only counts successful, precisely paired reads', () => {
  const events = [
    call('r1', 'read', { file_path: 'docs/a.md' }, 10),
    result('r1', '1: alpha\n2: beta', 11),
    call('r2', 'read', { file_path: '../outside.md' }, 12),
    result('r2', 'scoped-fs: "../outside.md" is outside the authorized directory', 13, true),
    call('r3', 'read', { file_path: 'src/b.js', offset: 5, limit: 2 }, 14),
    result('r3', '6: line six\n7: line seven', 15),
    call('r4', 'read', { file_path: 'pending.md' }, 16),
  ]
  const { pairs } = pairToolEvents(events)
  const digest = inspectedDigest(pairs)
  assert.deepEqual(
    digest.inspected.map((entry) => entry.path),
    ['src/b.js', 'docs/a.md'],
  )
  assert.deepEqual(
    digest.notInspected.map((entry) => [entry.path, entry.status]),
    [
      ['pending.md', 'pending'],
      ['../outside.md', 'denied'],
    ],
  )
})

test('rendered digest separates inspected from refused and never lists pending as checked', () => {
  const events = [
    call('r1', 'read', { file_path: 'docs/a.md' }, 10),
    result('r1', '1: alpha', 11),
    call('r2', 'read', { file_path: '../outside.md' }, 12),
    result('r2', 'scoped-fs: outside', 13, true),
    call('r3', 'read', { file_path: 'pending.md' }, 14),
  ]
  const text = render(events)
  assert.match(text, /本会话已成功读取并返回内容的范围/)
  assert.match(text, /docs\/a\.md/)
  assert.match(text, /被拒绝或失败的读取（不计入已检查）/)
  assert.match(text, /\.\.\/outside\.md（越界拒绝）/)
  assert.doesNotMatch(text, /pending\.md（成功）/)
  assert.doesNotMatch(text, /pending\.md（越界拒绝）/)
  assert.doesNotMatch(text, /禁止|不要重|别重读/)
})

test('a session with only a refused read renders the refused section, no inspected section', () => {
  const events = [call('r1', 'read', { file_path: '../x' }, 10), result('r1', 'scoped-fs: outside', 11, true)]
  const text = render(events)
  assert.doesNotMatch(text, /本会话已成功读取并返回内容的范围/)
  assert.match(text, /被拒绝或失败的读取/)
  assert.match(text, /\.\.\/x（越界拒绝）/)
})

test('digest reflects only the events passed in (session isolation seam)', () => {
  const sessionA = [call('a1', 'read', { file_path: 'only-a.md' }, 10), result('a1', '1: a', 11)]
  const sessionB = [call('b1', 'read', { file_path: 'only-b.md' }, 10), result('b1', '1: b', 11)]
  const textA = render(sessionA)
  const textB = render(sessionB)
  assert.match(textA, /only-a\.md/)
  assert.doesNotMatch(textA, /only-b\.md/)
  assert.match(textB, /only-b\.md/)
  assert.doesNotMatch(textB, /only-a\.md/)
})

test('two reads of the same file with different callIds render twice (re-read stays visible)', () => {
  const events = [
    call('r1', 'read', { file_path: 'docs/a.md' }, 10),
    result('r1', '1: alpha', 11),
    call('r2', 'read', { file_path: 'docs/a.md' }, 12),
    result('r2', '1: alpha', 13),
  ]
  const { pairs } = pairToolEvents(events)
  assert.equal(pairs.length, 2)
  const digest = inspectedDigest(pairs)
  assert.equal(digest.inspected.length, 2)
})
