// M2-e 测试：被拒写入的留痕（`memory.rejections.jsonl`）。
// 跑法：node --test hikari-native/test/memory-rejections.test.mjs
//
// 夹具与 `memory-writing.test.mjs` 的 `openTools` 同构：真 `MemoryStore` + 真
// `installMemoryWriteTools`，只把 `ctx.tools.register` 换成一个 Map。留痕是写入路径的旁路，
// 只有在这一层才能同时看到"抛出的错误"、"memory.jsonl"与"rejections 文件"三份真值。
//
// 用例前缀 `[n]` 对应边界稿 §5 的检查项。
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

import { MemoryStore } from '../memory/store.mjs'
import { installMemoryWriteTools } from '../memory/writing.js'
import { installMemoryRecallTools } from '../memory/recall.js'
import { REJECTIONS_FILE } from '../memory/rejections.js'

const storeDirs = []
async function freshStoreDir() {
  const dir = await mkdtemp(join(tmpdir(), 'hikari-memory-rejections-'))
  storeDirs.push(dir)
  return dir
}
after(async () => {
  for (const dir of storeDirs) await rm(dir, { recursive: true, force: true })
})

async function openTools() {
  const storeDir = await freshStoreDir()
  const store = await MemoryStore.open({ storeDir })
  const tools = new Map()
  const register = (definition) => tools.set(definition.name, definition)
  installMemoryWriteTools({ tools: { register } }, store)
  installMemoryRecallTools({ tools: { register } }, store)
  return { store, storeDir, tools }
}

/** 一次被拒的写入：拿回错误码，并断言留痕已经落盘。 */
async function expectRejected(tools, tool, args, code) {
  const definition = tools.get(tool)
  assert.ok(definition, `${tool} 应当已注册`)
  await assert.rejects(
    async () => definition.execute(args),
    (error) => {
      assert.ok(String(error.message).startsWith(`${code}:`), `期望 ${code}，实际 ${error.message}`)
      return true
    },
  )
}

async function rejectionLines(storeDir) {
  const text = await readFile(join(storeDir, REJECTIONS_FILE), 'utf8')
  return text.split('\n').filter((line) => line !== '').map((line) => JSON.parse(line))
}

async function exists(path) {
  try {
    await readFile(path, 'utf8')
    return true
  } catch {
    return false
  }
}

test('[1] 空正文被拒：留一行诊断，字段齐全，且 memory.jsonl 未创建', async () => {
  const { store, storeDir, tools } = await openTools()
  await expectRejected(tools, 'write_memory', { text: '   ' }, 'MEMORY_TEXT_EMPTY')

  const rows = await rejectionLines(storeDir)
  assert.equal(rows.length, 1)
  const [row] = rows
  assert.deepEqual(Object.keys(row).sort(), ['at', 'chars', 'code', 'excerpt', 'keys', 'memoryId', 'tool'])
  assert.equal(row.tool, 'write_memory')
  assert.equal(row.code, 'MEMORY_TEXT_EMPTY')
  assert.deepEqual(row.keys, ['text'])
  assert.equal(row.chars, 3)
  assert.equal(row.memoryId, null)
  assert.equal(row.excerpt, null) // 全空白压平后为空，不记
  assert.equal(typeof row.at, 'number')
  assert.ok(row.at > 0)

  // 留痕不是记忆：本体仍然一行都没有。
  assert.equal(store.size, 0)
  assert.equal(await exists(join(storeDir, 'memory.jsonl')), false)
  await store.close()
})

test('[2] 超长正文被拒：摘要截到 120 字并标记截断，正文字数照实记', async () => {
  const { store, storeDir, tools } = await openTools()
  const long = '记'.repeat(4001)
  await expectRejected(tools, 'write_memory', { text: long }, 'MEMORY_TEXT_TOO_LONG')

  const [row] = await rejectionLines(storeDir)
  assert.equal(row.code, 'MEMORY_TEXT_TOO_LONG')
  assert.equal(row.chars, 4001)
  assert.equal(row.excerpt.length, 121) // 120 个字 + 省略号
  assert.ok(row.excerpt.endsWith('…'))
  await store.close()
})

test('[3] 成功写入不产生留痕', async () => {
  const { store, storeDir, tools } = await openTools()
  await tools.get('write_memory').execute({ text: '一条正常的记忆。' })

  assert.equal(store.size, 1)
  assert.equal(await exists(join(storeDir, REJECTIONS_FILE)), false)
  await store.close()
})

test('[4] 修订目标不存在：留痕带上 tool 与 memoryId，正文摘要仍在', async () => {
  const { store, storeDir, tools } = await openTools()
  await expectRejected(
    tools,
    'revise_memory',
    { memoryId: 'm-00000000-0000-0000-0000-000000000000', text: '改一版。' },
    'MEMORY_SUPERSEDES_UNKNOWN',
  )

  const [row] = await rejectionLines(storeDir)
  assert.equal(row.tool, 'revise_memory')
  assert.equal(row.code, 'MEMORY_SUPERSEDES_UNKNOWN')
  assert.equal(row.memoryId, 'm-00000000-0000-0000-0000-000000000000')
  assert.deepEqual(row.keys, ['memoryId', 'text'])
  assert.equal(row.excerpt, '改一版。')
  assert.equal(store.size, 0)
  await store.close()
})

test('[5] 并发被拒：五条记录按提交顺序逐行落盘，不交错', async () => {
  const { store, storeDir, tools } = await openTools()
  const definition = tools.get('write_memory')
  const attempts = ['甲', '乙', '丙', '丁', '戊'].map((text) =>
    definition.execute({ text: '', validHint: text }).catch((error) => error.message),
  )
  const messages = await Promise.all(attempts)
  assert.equal(messages.length, 5)
  for (const message of messages) assert.ok(message.startsWith('MEMORY_TEXT_EMPTY:'), message)

  // 五条都写"空正文"，靠 validHint 无法区分顺序；改看行数与 JSON 完整性。
  const rows = await rejectionLines(storeDir)
  assert.equal(rows.length, 5)
  for (const row of rows) assert.equal(row.code, 'MEMORY_TEXT_EMPTY')
  await store.close()
})

test('[6] 留痕失败不改变原错误：rejections 路径被占成目录时仍抛 MEMORY_TEXT_EMPTY', async () => {
  const { store, storeDir, tools } = await openTools()
  await mkdir(join(storeDir, REJECTIONS_FILE), { recursive: true })

  await assert.rejects(
    async () => tools.get('write_memory').execute({ text: '' }),
    (error) => {
      assert.ok(String(error.message).startsWith('MEMORY_TEXT_EMPTY:'), error.message)
      return true
    },
  )
  assert.equal(store.size, 0)
  await store.close()
})

test('[7] 留痕不被检索看到：被拒正文留在诊断文件里，search_memories 仍返回空', async () => {
  const { store, storeDir, tools } = await openTools()
  const phrase = '彩虹协议第三版'
  await expectRejected(tools, 'write_memory', { text: `${phrase}${'长'.repeat(4000)}` }, 'MEMORY_TEXT_TOO_LONG')

  // 诊断里确实留了这段话的开头。
  const [row] = await rejectionLines(storeDir)
  assert.ok(row.excerpt.startsWith(phrase))

  // 但检索读的是记忆本体，不是诊断文件，所以搜它必须空。
  const result = await tools.get('search_memories').execute({ query: phrase })
  assert.deepEqual(result, { results: [] })
  assert.equal(store.size, 0)
  await store.close()
})

