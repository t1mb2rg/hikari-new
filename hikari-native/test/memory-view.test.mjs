import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, test } from 'node:test'

import { buildView, parseJsonl, renderHtml, renderText } from '../viewer/render.mjs'

const created = []
after(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(created.map((dir) => rm(dir, { recursive: true, force: true })))
})

async function fixtureDir(memoryLines, rejectionLines = []) {
  const dir = await mkdtemp(join(tmpdir(), 'hikari-view-'))
  created.push(dir)
  await writeFile(join(dir, 'memory.jsonl'), `${memoryLines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8')
  if (rejectionLines.length > 0) {
    await writeFile(join(dir, 'memory.rejections.jsonl'), `${rejectionLines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8')
  }
  return dir
}

function record(overrides = {}) {
  return {
    memoryId: 'm-11111111-1111-1111-1111-111111111111',
    text: '约定：修订只能改链头。',
    occurredAt: null,
    recordedAt: 1793842597808,
    validFrom: null,
    validTo: null,
    validHint: null,
    source: { kind: 'file', ref: 'hikari-native/memory/writing.js:253' },
    supersedes: null,
    seq: 1,
    ...overrides,
  }
}

test('[1] 概览数字：链头、被修订、发生时间未知、来源分布', () => {
  const first = record({ seq: 1 })
  const second = record({
    memoryId: 'm-22222222-2222-2222-2222-222222222222',
    text: '约定：修订只能改链头（第二版）。',
    occurredAt: 1793843000000,
    supersedes: first.memoryId,
    seq: 2,
  })
  const view = buildView([first, second], [{ at: 1, tool: 'write_memory', code: 'MEMORY_TEXT_EMPTY', keys: ['text'], chars: 0, memoryId: null, excerpt: null }], {
    storeDir: '/tmp/store',
    now: 1793900000000,
  })
  assert.equal(view.total, 2)
  assert.equal(view.heads, 1)
  assert.equal(view.revised, 1)
  assert.equal(view.unknownWhen, 1)
  assert.equal(view.lastSeq, 2)
  assert.deepEqual(view.kinds, [['file', 2]])
  assert.deepEqual(view.rejectionCodes, [['MEMORY_TEXT_EMPTY', 1]])
  // 时间线新的在上，且旧条能指到后继
  assert.equal(view.timeline[0].memoryId, second.memoryId)
  assert.equal(view.timeline[1].next, second.memoryId)
  assert.equal(view.timeline[0].next, null)
})

test('[2] 坏行不抛错，只计数', () => {
  const { entries, brokenLines } = parseJsonl('{"seq":1}\nnot json\n\n{"seq":2}\n')
  assert.equal(entries.length, 2)
  assert.equal(brokenLines, 1)
})

test('[3] 文本视图：未知时间说成未知，不编造日期', () => {
  const view = buildView([record()], [], { storeDir: '/tmp/store', now: 1793900000000 })
  const text = renderText(view)
  assert.match(text, /发生时间未知 1 条/)
  assert.match(text, /发生时间未知/)
  assert.ok(!text.includes('1970'), 'null occurredAt 不应被渲染成 1970')
})

test('[4] HTML 视图：转义正文、两块都在、无外部资源', () => {
  const view = buildView(
    [record({ text: '<script>alert(1)</script> 与 & 符号' })],
    [{ at: 1793850000000, tool: 'write_memory', code: 'MEMORY_TEXT_TOO_LONG', keys: ['text'], chars: 4001, memoryId: null, excerpt: '彩虹协议…' }],
    { storeDir: '/tmp/store', now: 1793900000000 },
  )
  const html = renderHtml(view)
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
  assert.ok(!html.includes('<script>alert(1)</script>'))
  assert.match(html, /记忆 · 新的在上/)
  assert.match(html, /拒绝样本 · 想记却没记成/)
  assert.match(html, /它不知道的/)
  assert.match(html, /MEMORY_TEXT_TOO_LONG/)
  assert.ok(!/<link |<script src=/.test(html), '不能引用外部资源')
})

test('[5] 命令行：--store/--out 能生成文件，--format text 打印到标准输出', async () => {
  const dir = await fixtureDir([record()])
  const script = resolve('hikari-native/viewer/render.mjs')
  const out = join(dir, 'view.html')

  const html = spawnSync(process.execPath, [script, '--store', dir, '--out', out], { encoding: 'utf8' })
  assert.equal(html.status, 0, html.stderr)
  const written = await readFile(out, 'utf8')
  assert.ok(written.includes('m-11111111-1111-1111-1111-111111111111'))

  const text = spawnSync(process.execPath, [script, '--store', dir, '--format', 'text'], { encoding: 'utf8' })
  assert.equal(text.status, 0, text.stderr)
  assert.match(text.stdout, /记忆 1 条/)
})

test('[6] 存储不存在时报错而不是编内容', () => {
  const script = resolve('hikari-native/viewer/render.mjs')
  const result = spawnSync(process.execPath, [script, '--store', join(tmpdir(), 'hikari-view-missing-dir'), '--format', 'text'], {
    encoding: 'utf8',
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /no memory\.jsonl under/)
})
