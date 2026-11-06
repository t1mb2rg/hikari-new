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

import { buildPanel, defaultGoalPath, renderPanel, readSessions, readZstdFrames } from '../panel/build.mjs'

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
    assert.ok(!/<script/iu.test(html))
    // 没有目标库时照实说，不编一条"要做的事"
    assert.ok(html.includes('还没给自己立过任何承诺'))
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

describe('目标', () => {
  /** 一个目标库：两条还开着、一条已了结；同编号再出现以最后一条为准。 */
  function goalsAt(dir) {
    const file = path.join(dir, 'goal', 'goals.jsonl')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const rows = [
      { goalId: 'g-aaaaaaaa-1111-4111-8111-111111111111', text: '把清单接进自主唤醒', status: 'open', note: null, at: 1793967683137 },
      { goalId: 'g-bbbbbbbb-2222-4222-8222-222222222222', text: '给面板加自动重建', status: 'open', note: '先看清楚再动', at: 1793967683141 },
      { goalId: 'g-bbbbbbbb-2222-4222-8222-222222222222', text: '给面板加自动重建', status: 'done', note: '先看清楚再动', at: 1793967684036 },
      { goalId: 'g-cccccccc-3333-4333-8333-333333333333', text: '盯住那条误记', status: 'open', note: null, at: 1793970610320 },
    ]
    fs.writeFileSync(file, rows.map((row) => `${JSON.stringify(row)}\n`).join(''), 'utf8')
    return file
  }

  test('[9] 目标库：同编号最后一条算数，open 与已收口分开', () => {
    const dir = tempDir('goals')
    const store = path.join(dir, 'store')
    fs.mkdirSync(store, { recursive: true })
    const file = goalsAt(dir)

    // 默认路径由记忆库的兄弟目录推出来，与 hikari-goal 的落盘位置一致
    assert.equal(defaultGoalPath(store), file)

    const panel = buildPanel({
      storeDir: store,
      sessionsDir: path.join(dir, 'no-sessions'),
      tracePath: path.join(dir, 'no-trace.jsonl'),
    })

    assert.equal(panel.goals.exists, true)
    assert.equal(panel.goals.total, 3) // 同一编号折叠后是三条，不是四行
    assert.equal(panel.goals.open.length, 2)
    assert.equal(panel.goals.closed.length, 1)
    assert.equal(panel.home.openGoals, 2)
    assert.equal(panel.home.goals, 3)
    // open 按立下时间升序
    assert.deepEqual(
      panel.goals.open.map((goal) => goal.goalId.slice(2, 10)),
      ['aaaaaaaa', 'cccccccc'],
    )
    // 折掉的那条 bbbb 是 done
    assert.equal(panel.goals.closed[0].status, 'done')
  })

  test('[10] 目标在她自己的面板里看得见，且明说"承诺不是行动"', () => {
    const dir = tempDir('goals-html')
    const store = path.join(dir, 'store')
    fs.mkdirSync(store, { recursive: true })
    goalsAt(dir)

    const html = renderPanel(
      buildPanel({
        storeDir: store,
        sessionsDir: path.join(dir, 'no-sessions'),
        tracePath: path.join(dir, 'no-trace.jsonl'),
      }),
    )

    assert.ok(html.includes('她答应过什么'))
    assert.ok(html.includes('把清单接进自主唤醒'))
    assert.ok(html.includes('盯住那条误记'))
    assert.ok(html.includes('先看清楚再动'))
    assert.ok(html.includes('已经收口的'))
    assert.ok(html.includes('承诺不是行动'))
    // 没做完的事在首页也有一格
    assert.ok(html.includes('还没做完的事'))
  })
})

describe('三种时间各归各的', () => {
  test('[11] 她只醒过、没写东西：被叫醒是新的，自己留下记录还是旧的，环境变化单列', () => {
    const dir = tempDir('wake-time')
    const store = path.join(dir, 'store')
    fs.mkdirSync(store, { recursive: true })
    const memoryFile = path.join(store, 'memory.jsonl')
    fs.writeFileSync(
      memoryFile,
      `${JSON.stringify(
        memoryRecord({
          memoryId: 'm-99999999-9999-4999-8999-999999999999',
          seq: 1,
          text: '早期的一条记忆',
          recordedAt: 1793842597808,
        }),
      )}\n`,
      'utf8',
    )
    fs.utimesSync(memoryFile, new Date(1793842597808), new Date(1793842597808))

    const sessions = tempDir('wake-sessions')
    writeSession(sessions, '--ws--', 'session-hikari', [
      { type: 'user/message', seq: 1, time: 1793980000000, data: { text: '[Hikari 自主观察 09:00] 已经过了 30 分钟' } },
      { type: 'assistant/message', seq: 2, time: 1793980012345, data: { text: '没什么。' } },
    ])

    // 外部改动的轨迹：由感知子系统写，不该算成她的记录
    const trace = path.join(dir, 'trace.jsonl')
    fs.writeFileSync(
      trace,
      `${JSON.stringify({ at: 1793980050000, kind: 'emitted', head: 'abc12345', dirty: true, changed: ['workingTree'] })}\n`,
      'utf8',
    )

    const panel = buildPanel({
      storeDir: store,
      sessionsDir: sessions,
      tracePath: trace,
      now: 1793980100000,
    })

    assert.equal(panel.home.wakes, 1)
    assert.equal(panel.home.lastWake, 1793980000000)
    // 会话日志里最新一条记录（含她自己的回答）
    assert.equal(panel.home.lastTouch, 1793980012345)
    // 她这一轮没写记忆、没写目标、没被拒：她自己留下的记录仍是记忆文件的时间
    assert.equal(panel.home.lastOwnRecord, 1793842597808)
    // 环境变化单列在观察区
    assert.equal(panel.awareness.lastChange, 1793980050000)

    const html = renderPanel(panel)
    assert.ok(html.includes('最后一次被叫醒'))
    assert.ok(html.includes('最后一次留下自己的记录'))
    assert.ok(html.includes('最近一次环境变化'))
    assert.ok(html.includes('感知子系统记的，不是她写的'))
  })
})
