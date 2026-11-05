// Hikari Desktop · P1 只读面板的测试
//
// 这里不测"好不好看"，只测三件事：
//   1. 读得对不对：记忆链、拒绝、认识的状态变化、唤醒次数、仓库轨迹。
//   2. 说实话：未知时间不写成 1970，没数据就说没数据，不编。
//   3. 不越界：产物是一个自包含 HTML——没有脚本、没有外链、不写数据源。

import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { buildPanel, renderPanel, readSessions, readZstdFrames } from '../panel/build.mjs'

const run = promisify(execFile)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLI = path.join(HERE, '..', 'panel', 'build.mjs')
const tempDirs = []

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

function tempDir(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `hikari-panel-${label}-`))
  tempDirs.push(dir)
  return dir
}

function memoryRecord({ memoryId, seq, text, recordedAt, occurredAt = null, supersedes = null }) {
  return {
    memoryId,
    text,
    occurredAt,
    recordedAt,
    validFrom: null,
    validTo: null,
    validHint: null,
    source: { kind: 'file', ref: 'hikari-native/memory/writing.js:253' },
    supersedes,
    seq,
  }
}

/** 会话日志是多个 zstd 帧首尾相接；测试里也照这个形状造。 */
function framesOf(records) {
  const lines = records.map((record) => `${JSON.stringify(record)}\n`).join('')
  return zlib.zstdCompressSync(Buffer.from(lines, 'utf8'))
}

function writeSession(sessionsDir, workspace, sessionId, records) {
  const dir = path.join(sessionsDir, workspace, sessionId)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'session.v4.jsonl.zstd'), framesOf(records))
  return dir
}

function finding({ seq, time, findingId, status, claim }) {
  return {
    type: 'plugin:hikari/finding',
    seq,
    time,
    data: { findingId, claim, status, provenance: 'model-claim', evidence: [], recordedAt: time },
  }
}

/** 一条记忆够用：测认识与唤醒时不需要真记忆。 */
function storeWithChain() {
  const store = tempDir('store')
  const first = memoryRecord({
    memoryId: 'm-9cf20a36-1bb9-4d9d-a0d8-c2fa061a759b',
    seq: 1,
    text: 'Hikari 的 Memory 修订约定：修订只能改链头，旧记录永不改。',
    recordedAt: 1793842597808,
  })
  const second = memoryRecord({
    memoryId: 'm-124371ee-e4cb-4ffb-a1d1-386bf23a1e62',
    seq: 2,
    text: 'Hikari 的 Memory 修订约定（第二版）：修订只能改链头。',
    recordedAt: 1793843299376,
    supersedes: first.memoryId,
  })
  fs.writeFileSync(
    path.join(store, 'memory.jsonl'),
    `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`,
    'utf8',
  )
  fs.writeFileSync(
    path.join(store, 'memory.rejections.jsonl'),
    `${JSON.stringify({
      at: 1793843300000,
      tool: 'write_memory',
      code: 'MEMORY_TEXT_EMPTY',
      keys: ['text'],
      chars: 0,
      memoryId: null,
      excerpt: null,
    })}\n`,
    'utf8',
  )
  return store
}

describe('读数据', () => {
  test('[1] 记忆与修订链：现行、被修订、未知发生时间都数得对', () => {
    const store = storeWithChain()
    const panel = buildPanel({ storeDir: store, sessionsDir: path.join(store, 'no-sessions'), tracePath: path.join(store, 'no-trace.jsonl') })

    assert.equal(panel.home.memories, 2)
    assert.equal(panel.home.heads, 1)
    assert.equal(panel.home.revised, 1)
    assert.equal(panel.home.unknownOccurredAt, 2)
    assert.equal(panel.home.rejections, 1)
    // 新的在上；旧的那条要能指到取代它的那条
    assert.equal(panel.memory.timeline[0].seq, 2)
    assert.equal(panel.memory.timeline[1].next, 'm-124371ee-e4cb-4ffb-a1d1-386bf23a1e62')
    assert.equal(panel.memory.rejections[0].code, 'MEMORY_TEXT_EMPTY')
  })

  test('[2] 多帧 zstd 要拆开解，只解第一帧会漏记录', () => {
    const sessions = tempDir('sessions')
    const dir = path.join(sessions, '--ws--', 'session-a')
    fs.mkdirSync(dir, { recursive: true })
    const first = framesOf([finding({ seq: 1, time: 1000, findingId: 'f-001', status: 'open', claim: '窗口有变化' })])
    const second = framesOf([
      finding({ seq: 2, time: 217709, findingId: 'f-001', status: 'refuted', claim: '窗口有变化' }),
    ])
    fs.writeFileSync(path.join(dir, 'session.v4.jsonl.zstd'), Buffer.concat([first, second]))

    const decoded = readZstdFrames(fs.readFileSync(path.join(dir, 'session.v4.jsonl.zstd')))
    assert.equal(decoded.frames, 2)
    assert.equal(decoded.badFrames, 0)

    const sessionsRead = readSessions(sessions)
    assert.equal(sessionsRead.findings.length, 2)
    assert.equal(sessionsRead.sessions, 1)
    assert.equal(sessionsRead.scanned, 1)
  })

  test('[3] 认识按（会话, 编号）聚合，状态变化算得出来', () => {
    const sessions = tempDir('sessions')
    writeSession(sessions, '--ws--', 'session-a', [
      finding({ seq: 265, time: 1793637163105, findingId: 'f-001', status: 'open', claim: '窗口标题能读到' }),
      { type: 'user/message', seq: 270, time: 1793637200000, data: { text: '[Hikari 自主观察 09:01] 窗口变了' } },
      finding({ seq: 311, time: 1793637379814, findingId: 'f-001', status: 'refuted', claim: '窗口标题能读到' }),
    ])
    // 同一个编号在另一个会话里是另一个实体
    writeSession(sessions, '--ws--', 'session-b', [
      finding({ seq: 12, time: 1793638000000, findingId: 'f-001', status: 'confirmed', claim: '窗口标题能读到' }),
    ])

    const panel = buildPanel({
      storeDir: path.join(sessions, 'no-store'),
      sessionsDir: sessions,
      tracePath: path.join(sessions, 'no-trace.jsonl'),
    })

    assert.equal(panel.world.entities.length, 2)
    assert.equal(panel.world.scanned, 2)
    assert.equal(panel.awareness.wakes, 1)

    const changed = panel.world.entities.find((entity) => entity.transitions.length > 0)
    assert.equal(changed.sessionId, 'session-a')
    assert.equal(changed.status, 'refuted')
    assert.equal(changed.records, 2)
    assert.equal(changed.transitions[0].from, 'open')
    assert.equal(changed.transitions[0].to, 'refuted')
    assert.equal(changed.transitions[0].deltaMs, 1793637379814 - 1793637163105)

    const steady = panel.world.entities.find((entity) => entity.transitions.length === 0)
    assert.equal(steady.sessionId, 'session-b')
    assert.equal(steady.status, 'confirmed')
  })

  test('[4] 仓库轨迹只把"有变化"的行算进最近事件', () => {
    const dir = tempDir('trace')
    const file = path.join(dir, 'trace.jsonl')
    const rows = [
      { at: 1793800000000, kind: 'baseline', head: 'abc12345', dirty: false },
      { at: 1793800100000, kind: 'quiet', head: 'abc12345', dirty: false },
      { at: 1793800200000, kind: 'emitted', head: 'def67890', dirty: true, changed: ['src/a.js'] },
    ]
    fs.writeFileSync(file, rows.map((row) => `${JSON.stringify(row)}\n`).join(''), 'utf8')

    const panel = buildPanel({
      storeDir: path.join(dir, 'no-store'),
      sessionsDir: path.join(dir, 'no-sessions'),
      tracePath: file,
    })

    assert.equal(panel.awareness.trace.total, 3)
    assert.equal(panel.awareness.trace.meaningful, 2)
    assert.equal(panel.awareness.trace.recent[0].kind, 'emitted')
    assert.equal(panel.awareness.trace.recent.at(-1).kind, 'baseline')
  })

  test('[5] 什么都没有的时候不编：空库、没有日志目录都照实说', () => {
    const dir = tempDir('empty')
    const panel = buildPanel({
      storeDir: path.join(dir, 'missing-store'),
      sessionsDir: path.join(dir, 'missing-sessions'),
      tracePath: path.join(dir, 'missing-trace.jsonl'),
    })

    assert.equal(panel.home.memories, 0)
    assert.equal(panel.home.findings, 0)
    assert.equal(panel.home.wakes, 0)
    assert.equal(panel.home.lastTouch, null)
    assert.equal(panel.world.missing, true)
    assert.equal(panel.awareness.trace.exists, false)
  })
})

describe('说实话', () => {
  test('[6] 发生时间未知就写未知，不写成 1970；正文要转义', () => {
    const store = tempDir('store')
    fs.writeFileSync(
      path.join(store, 'memory.jsonl'),
      `${JSON.stringify(
        memoryRecord({
          memoryId: 'm-11111111-1111-1111-1111-111111111111',
          seq: 1,
          text: '她说：<script>alert(1)</script> 不应被执行',
          recordedAt: 1793842597808,
        }),
      )}\n`,
      'utf8',
    )

    const html = renderPanel(
      buildPanel({
        storeDir: store,
        sessionsDir: path.join(store, 'no-sessions'),
        tracePath: path.join(store, 'no-trace.jsonl'),
      }),
    )

    assert.ok(html.includes('发生时间未知'))
    assert.ok(!html.includes('1970'))
    assert.ok(!html.includes('<script>'))
    assert.ok(html.includes('&lt;script&gt;'))
    assert.ok(!html.includes('<script'))
    assert.ok(!/https?:\/\//u.test(html))
    assert.ok(html.includes('还不知道'))
  })

  test('[7] 生成物是自包含的单页：没有外链、没有脚本、没有第二个数据源', () => {
    const store = storeWithChain()
    const sessions = tempDir('sessions')
    writeSession(sessions, '--ws--', 'session-a', [
      finding({ seq: 1, time: 1793637163105, findingId: 'f-001', status: 'open', claim: '窗口标题能读到' }),
      finding({ seq: 2, time: 1793637379814, findingId: 'f-001', status: 'refuted', claim: '窗口标题能读到' }),
    ])
    const trace = path.join(sessions, 'trace.jsonl')
    fs.writeFileSync(trace, `${JSON.stringify({ at: 1793800000000, kind: 'emitted', head: 'abc12345', dirty: false })}\n`)

    const html = renderPanel(buildPanel({ storeDir: store, sessionsDir: sessions, tracePath: trace }))

    assert.ok(html.startsWith('<!doctype html>'))
    assert.ok(html.includes('<code>session-a</code>'))
    assert.ok(html.includes('待验'))
    assert.ok(html.includes('被推翻'))
    assert.ok(html.includes('间隔'))
    assert.ok(!/<script/iu.test(html))
    assert.ok(!/https?:\/\//u.test(html))
    assert.ok(!/<link\b/u.test(html))
    // 只描述事实，不给"这条更重要"这类排序：显式声明它不做判断
    assert.ok(html.includes('不替她判断'))
    assert.ok(!html.includes('优先级'))
  })
})

describe('命令行', () => {
  test('[8] --out 写一个文件，stdout 干净', async () => {
    const store = storeWithChain()
    const out = path.join(tempDir('out'), 'panel.html')
    const { stdout } = await run(process.execPath, [CLI, '--store', store, '--out', out, '--sessions', path.join(store, 'none'), '--trace', path.join(store, 'none.jsonl')])

    assert.equal(stdout.trim(), '')
    const html = fs.readFileSync(out, 'utf8')
    assert.ok(html.includes('记忆条数'))
    assert.ok(html.includes('Hikari 的 Memory 修订约定'))
  })
})
