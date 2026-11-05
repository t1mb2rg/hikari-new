// M2-f 测试：memory_status 的读数为真、只读、且与视图同源。
// 跑法：node --test hikari-native/test/memory-status.test.mjs
//
// 夹具与 `memory-recall.test.mjs` 的 `openTools` 同构：真 `MemoryStore` + 真的
// `installMemoryStatusTool`，只把 `ctx.tools.register` 换成 Map（生命周期在 `memory.test.mjs` 里验）。
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

import { MemoryStore } from '../memory/store.mjs'
import { installMemoryStatusTool, normalizeStatusInput, summarize } from '../memory/status.js'
import { buildView } from '../viewer/render.mjs'

const storeDirs = []
async function freshStoreDir() {
  const dir = await mkdtemp(join(tmpdir(), 'hikari-memory-status-'))
  storeDirs.push(dir)
  return dir
}
after(async () => {
  for (const dir of storeDirs) await rm(dir, { recursive: true, force: true })
})

async function openStatus() {
  const storeDir = await freshStoreDir()
  const store = await MemoryStore.open({ storeDir })
  const tools = new Map()
  installMemoryStatusTool({ tools: { register: (definition) => tools.set(definition.name, definition) } }, store)
  return { store, storeDir, status: tools.get('memory_status').execute, tool: tools.get('memory_status') }
}

test('[1] 空库：数字全是 0，不编造任何一条', async () => {
  const { store, status } = await openStatus()
  const view = await status({})
  assert.equal(view.total, 0)
  assert.equal(view.lastSeq, 0)
  assert.equal(view.heads, 0)
  assert.equal(view.revised, 0)
  assert.equal(view.unknownOccurredAt, 0)
  assert.deepEqual(view.sources, {})
  assert.deepEqual(view.recent, [])
  assert.deepEqual(view.rejections, { total: 0, byCode: {}, unreadableLines: 0 })
  await store.close()
})

test('[2] 写入后：总数、链头、来源分布、最近几条（新在上）都对', async () => {
  const { store, status } = await openStatus()
  const first = await store.append({ text: '第一条：修订只能改链头。', occurredAt: 1793800000000, source: { kind: 'file', ref: 'a.js:1' } })
  const second = await store.append({ text: '第二条：没有发生时间。', source: { kind: 'inference', ref: null } })
  const view = await status({})
  assert.equal(view.total, 2)
  assert.equal(view.lastSeq, 2)
  assert.equal(view.heads, 2)
  assert.equal(view.revised, 0)
  assert.equal(view.unknownOccurredAt, 1)
  assert.deepEqual(view.sources, { file: 1, inference: 1 })
  assert.deepEqual(
    view.recent.map((entry) => entry.memoryId),
    [second.memoryId, first.memoryId],
  )
  assert.equal(view.recent[0].occurredAt, null)
  assert.equal(view.recent[0].supersededBy, null)
  assert.match(view.recent[0].snippet, /^第二条/)
  await store.close()
})

test('[3] 修订后：链头减一、被修订者带 supersededBy、修订者带 seq', async () => {
  const { store, status } = await openStatus()
  const first = await store.append({ text: '旧版本。' })
  const second = await store.append({ text: '新版本。', supersedes: first.memoryId })
  const view = await status({})
  assert.equal(view.total, 2)
  assert.equal(view.heads, 1)
  assert.equal(view.revised, 1)
  assert.equal(view.recent[0].memoryId, second.memoryId)
  assert.equal(view.recent[0].supersededBy, null)
  assert.equal(view.recent[1].memoryId, first.memoryId)
  assert.equal(view.recent[1].supersededBy, second.memoryId)
  await store.close()
})

test('[4] recent 参数的边界：非法与越界都退回安全值', () => {
  assert.deepEqual(normalizeStatusInput({ recent: 3 }), { recent: 3 })
  assert.deepEqual(normalizeStatusInput({ recent: 100 }), { recent: 20 })
  assert.deepEqual(normalizeStatusInput({ recent: 0 }), { recent: 5 })
  assert.deepEqual(normalizeStatusInput({ recent: 2.5 }), { recent: 5 })
  assert.deepEqual(normalizeStatusInput({ recent: '9' }), { recent: 5 })
  assert.deepEqual(normalizeStatusInput(undefined), { recent: 5 })
})

test('[5] 拒绝样本：计数、错误码分布、最后一次是谁；坏行只计数', async () => {
  const { store, storeDir, status } = await openStatus()
  const lines = [
    { at: 1793800000000, tool: 'write_memory', code: 'MEMORY_TEXT_EMPTY', keys: ['text'], chars: 0, memoryId: null, excerpt: null },
    { at: 1793800001000, tool: 'revise_memory', code: 'MEMORY_SUPERSEDES_UNKNOWN', keys: ['memoryId', 'text'], chars: 5, memoryId: 'm-nope', excerpt: '改一版' },
    { at: 1793800002000, tool: 'write_memory', code: 'MEMORY_TEXT_EMPTY', keys: ['text'], chars: 0, memoryId: null, excerpt: null },
  ]
  await writeFile(
    join(storeDir, 'memory.rejections.jsonl'),
    `${lines.map((line) => JSON.stringify(line)).join('\n')}\nnot json\n`,
    'utf8',
  )
  const view = await status({})
  assert.equal(view.rejections.total, 3)
  assert.deepEqual(view.rejections.byCode, { MEMORY_TEXT_EMPTY: 2, MEMORY_SUPERSEDES_UNKNOWN: 1 })
  assert.equal(view.rejections.lastAt, 1793800002000)
  assert.equal(view.rejections.lastTool, 'write_memory')
  assert.equal(view.rejections.lastCode, 'MEMORY_TEXT_EMPTY')
  assert.equal(view.rejections.unreadableLines, 1)
  // 留痕不属于记忆本体：总数与链头不受影响
  assert.equal(view.total, 0)
  await store.close()
})

test('[6] 只读：调用前后 memory.jsonl 逐字节相同，size 不变', async () => {
  const { store, storeDir, status } = await openStatus()
  await store.append({ text: '一条记忆。' })
  const before = await readFile(join(storeDir, 'memory.jsonl'), 'utf8')
  const sizeBefore = store.size
  await status({ recent: 20 })
  await status({})
  assert.equal(await readFile(join(storeDir, 'memory.jsonl'), 'utf8'), before)
  assert.equal(store.size, sizeBefore)
  await store.close()
})

test('[7] 它与视图同源：同一批记录算出的数字一致', async () => {
  const { store, status } = await openStatus()
  const first = await store.append({ text: '一。' })
  await store.append({ text: '二。', occurredAt: 1793800000000 })
  await store.append({ text: '三。', supersedes: first.memoryId })
  const view = await status({})
  const rendered = buildView(store.all(), [], { storeDir: 'x', now: 1793900000000 })
  assert.equal(view.total, rendered.total)
  assert.equal(view.heads, rendered.heads)
  assert.equal(view.revised, rendered.revised)
  assert.equal(view.unknownOccurredAt, rendered.unknownWhen)
  assert.equal(view.lastSeq, rendered.lastSeq)
  await store.close()
})

test('[8] 工具形状：名字、只暴露 recent、输出渲染为 JSON 文本', async () => {
  const { store, tool } = await openStatus()
  assert.equal(tool.name, 'memory_status')
  assert.deepEqual(Object.keys(tool.parameters.properties), ['recent'])
  assert.equal(tool.parameters.additionalProperties, false)
  assert.equal(tool.parameters.required, undefined)
  const rendered = tool.output.render({}, { total: 0 })
  assert.equal(rendered[0].type, 'text')
  assert.match(rendered[0].text, /"total": 0/)
  await store.close()
})

test('[9] summarize 的纯函数口径：按 seq 排序、snippet 截断、来源缺失记 unknown', () => {
  const records = [
    { memoryId: 'm-b', seq: 2, text: 'x'.repeat(200), occurredAt: null, recordedAt: 2, source: null, supersedes: null },
    { memoryId: 'm-a', seq: 1, text: 'a', occurredAt: 1, recordedAt: 1, source: { kind: 'file' }, supersedes: null },
  ]
  const view = summarize(records, [], { recent: 5 })
  assert.deepEqual(view.recent.map((entry) => entry.memoryId), ['m-b', 'm-a'])
  assert.equal(view.recent[0].snippet.length, 81)
  assert.ok(view.recent[0].snippet.endsWith('…'))
  assert.deepEqual(view.sources, { unknown: 1, file: 1 })
  assert.equal(view.unknownOccurredAt, 1)
})

// dsh-tools 的 `assertSupportedJsonSchema` 只接受有限表达力：每个子 schema 必须带
// `type`（字符串，不能是数组），`additionalProperties` 只能是布尔值。这两条在真机上
// 会让整个插件不激活，而单元夹具（只存 definition、不校验）是绿的——所以在这里守住。
function schemaProblems(schema, at = 'schema', problems = []) {
  if (schema === null || typeof schema !== 'object') return problems
  if (Array.isArray(schema.type) || (schema.type !== undefined && typeof schema.type !== 'string')) {
    problems.push(`${at}.type must be a string`)
  }
  if ('additionalProperties' in schema && typeof schema.additionalProperties !== 'boolean') {
    problems.push(`${at}.additionalProperties must be a boolean`)
  }
  const children = [
    ...Object.entries(schema.properties ?? {}).map(([key, value]) => [`${at}.properties.${key}`, value]),
    ...(schema.items === undefined ? [] : [[`${at}.items`, schema.items]]),
    ...(schema.oneOf ?? []).map((value, index) => [`${at}.oneOf[${index}]`, value]),
  ]
  if (at !== 'schema' && Object.keys(schema).length === 0) {
    problems.push(`${at} must not be an empty schema`)
  }
  for (const [childAt, child] of children) schemaProblems(child, childAt, problems)
  return problems
}

test('[10] schema 只用 dsh-tools 支持的表达力（子 schema 带 type、additionalProperties 是布尔）', async () => {
  const { store, tool } = await openStatus()
  const problems = [...schemaProblems(tool.parameters, 'parameters'), ...schemaProblems(tool.output.schema, 'output')]
  assert.deepEqual(problems, [])
  await store.close()
})
