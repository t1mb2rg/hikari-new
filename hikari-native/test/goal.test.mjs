import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, writeFile, appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { apply, inject, name as pluginName, openGoals, renderGoals } from '../goal/index.js'

const dirs = []

async function freshStateDir() {
  const dir = await mkdtemp(join(tmpdir(), 'hikari-goal-'))
  dirs.push(dir)
  return dir
}

test.after(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

async function readLines(file) {
  const raw = await readFile(file, 'utf8')
  return raw.split('\n').filter((line) => line.length > 0)
}

function fakeCtx() {
  const tools = new Map()
  const contexts = []
  const disposers = []
  return {
    tools: {
      register(definition) {
        assert.equal(tools.has(definition.name), false, `tool ${definition.name} registered twice`)
        tools.set(definition.name, definition)
      },
    },
    systemPrompt: {
      context(definition) {
        contexts.push(definition)
      },
    },
    effect(fn) {
      // 与 Cordis 语义一致：立刻执行一次，返回值当作释放函数。
      disposers.push(fn())
    },
    logger: { info() {}, warn() {} },
    get registeredTools() {
      return tools
    },
    get contexts() {
      return contexts
    },
    get disposers() {
      return disposers
    },
  }
}

function rejectsWith(promise, code) {
  return assert.rejects(promise, (error) => {
    assert.match(String(error.message), new RegExp(`^${code}: `))
    return true
  })
}

test('新建目标：字段齐全、文件多一行、id 形如 g-<uuid>', async () => {
  const stateDir = await freshStateDir()
  const store = await openGoals({ stateDir, now: () => 1793900000000 })
  const record = await store.create({ text: '把 memory.jsonl 的损坏恢复路径补上测试' })
  assert.match(record.goalId, /^g-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  assert.equal(record.status, 'open')
  assert.equal(record.note, null)
  assert.equal(record.at, 1793900000000)

  const lines = await readLines(store.file)
  assert.equal(lines.length, 1)
  assert.deepEqual(Object.keys(JSON.parse(lines[0])).sort(), ['at', 'goalId', 'note', 'status', 'text'])
  store.close()
})

test('关掉实例重开，目标还在（跨进程持久）', async () => {
  const stateDir = await freshStateDir()
  const first = await openGoals({ stateDir })
  const created = await first.create({ text: '给面板加自动重建' })
  first.close()

  const second = await openGoals({ stateDir })
  const record = second.get(created.goalId)
  assert.equal(record.text, '给面板加自动重建')
  assert.equal(record.status, 'open')
  second.close()
})

test('状态流转：done 之后历史两行都在，默认列表里不再出现', async () => {
  const stateDir = await freshStateDir()
  const store = await openGoals({ stateDir })
  const created = await store.create({ text: '写 Goal v0 的边界' })
  const updated = await store.update({ goalId: created.goalId, status: 'done', note: '边界文档已交' })
  assert.equal(updated.status, 'done')

  const lines = await readLines(store.file)
  assert.equal(lines.length, 2, '每次变化都追加一行，不覆盖')
  assert.equal(JSON.parse(lines[0]).status, 'open')
  assert.equal(JSON.parse(lines[1]).status, 'done')
  assert.equal(JSON.parse(lines[1]).note, '边界文档已交')

  assert.deepEqual(store.list(), [])
  assert.deepEqual(store.list({ status: 'done' }).map((record) => record.goalId), [created.goalId])
  store.close()
})

test('未知 id 明确报错，且不落盘', async () => {
  const stateDir = await freshStateDir()
  const store = await openGoals({ stateDir })
  await rejectsWith(store.update({ goalId: 'g-00000000-0000-4000-8000-000000000000', status: 'done' }), 'GOAL_UNKNOWN_ID')
  assert.equal(store.size, 0)
  await assert.rejects(store.create({ text: '   ' }), /GOAL_TEXT_EMPTY/)
  await assert.rejects(store.create({ text: 'x'.repeat(301) }), /GOAL_TEXT_TOO_LONG/)
  await assert.rejects(store.create({ text: '合法的', note: 'y'.repeat(201) }), /GOAL_NOTE_TOO_LONG/)
  assert.equal(store.size, 0)
  store.close()
})

test('并发新建 10 条：10 行、id 互不相同、顺序完整', async () => {
  const stateDir = await freshStateDir()
  const store = await openGoals({ stateDir })
  const created = await Promise.all(
    Array.from({ length: 10 }, (_, index) => store.create({ text: `并发目标 ${index + 1}` })),
  )
  assert.equal(new Set(created.map((record) => record.goalId)).size, 10)
  const lines = await readLines(store.file)
  assert.equal(lines.length, 10)
  for (const line of lines) JSON.parse(line)
  store.close()
})

test('注入：只列 open、最多 5 条、按立下时间升序、原文截到 120 字', async () => {
  const stateDir = await freshStateDir()
  const store = await openGoals({ stateDir })
  for (let index = 1; index <= 7; index += 1) {
    await store.create({ text: `第 ${index} 件事` })
  }
  const doneOne = await store.create({ text: '这件已经做完' })
  await store.update({ goalId: doneOne.goalId, status: 'done' })

  const text = renderGoals(store.openRecords(), { now: Date.now() })
  assert.match(text, /^你自己立下、还没做完的事：/)
  assert.match(text, /第 1 件事/)
  assert.doesNotMatch(text, /这件已经做完/, 'done 的不进注入')
  assert.equal(text.split('\n').length, 1 + 5 + 1, '一句引导 + 5 条 + 一句剩余提示')
  assert.match(text, /（还有 2 条没列出，用 list_goals 看全部）/)

  const longOne = '很长的目标'.repeat(40)
  const longStore = await openGoals({ stateDir: await freshStateDir() })
  await longStore.create({ text: longOne })
  const longText = renderGoals(longStore.openRecords(), { now: Date.now() })
  assert.match(longText, /…$/m)
  assert.ok(!longText.includes(longOne), '超过 120 字的部分被截掉')
  store.close()
  longStore.close()
})

test('空清单不注入：返回空串，不替她下「你没有目标」的结论', async () => {
  const stateDir = await freshStateDir()
  const store = await openGoals({ stateDir })
  assert.equal(renderGoals(store.openRecords()), '')
  store.close()
})

test('尾部半行当未写完丢掉，已有的目标照常读', async () => {
  const stateDir = await freshStateDir()
  const store = await openGoals({ stateDir })
  await store.create({ text: '第一条' })
  store.close()
  await appendFile(store.file, '{"goalId":"g-broken', 'utf8')

  const reopened = await openGoals({ stateDir })
  assert.equal(reopened.size, 1)
  assert.equal(reopened.list()[0].text, '第一条')
  const added = await reopened.create({ text: '第二条' })
  const lines = await readLines(reopened.file)
  assert.equal(lines.length, 3, '补了换行，坏尾行单独一行留着')
  assert.equal(JSON.parse(lines[2]).goalId, added.goalId)
  reopened.close()
})

test('中间坏行 fail-closed：拒绝静默丢一条目标', async () => {
  const stateDir = await freshStateDir()
  const store = await openGoals({ stateDir })
  await store.create({ text: '第一条' })
  store.close()
  const raw = await readFile(store.file, 'utf8')
  await writeFile(store.file, `${raw}{"goalId":"g-half\n`, 'utf8')
  await appendFile(store.file, `${raw}`, 'utf8')

  await assert.rejects(openGoals({ stateDir }), /GOAL_CORRUPT/)
})

test('插件形状：三个工具、注入段命名与顺序、注入不含工程推断', async () => {
  const stateDir = await freshStateDir()
  const ctx = fakeCtx()
  await apply(ctx, { stateDir })

  assert.equal(pluginName, 'hikari-goal')
  assert.deepEqual([...inject].sort(), ['systemPrompt', 'tools'])
  assert.deepEqual([...ctx.registeredTools.keys()].sort(), ['change_goal', 'list_goals', 'set_goal'])

  const setGoal = ctx.registeredTools.get('set_goal')
  assert.equal(setGoal.parameters.additionalProperties, false)
  assert.equal('goalId' in setGoal.parameters.properties, false, '工程字段不能由模型填')
  assert.deepEqual(setGoal.parameters.required, ['text'])

  const context = ctx.contexts.find((definition) => definition.name === 'hikari:goals')
  assert.ok(context, '注册了 hikari:goals 注入')
  assert.equal(context.order, 160, '排在 findings（150）之后')
  assert.equal(context.text(), '', '空清单时注入为空')

  const created = await setGoal.execute({ text: '把 goal 接进激活流程' })
  assert.match(created.goalId, /^g-/)
  const rendered = context.text()
  assert.match(rendered, /把 goal 接进激活流程/)
  assert.doesNotMatch(rendered, /优先|建议|下一步/, '注入只回放原文，不给判断')

  ctx.disposers[0]()
  await assert.rejects(setGoal.execute({ text: '关了之后不能再写' }), /GOAL_STORE_CLOSED/)
})

test('目录只写自己的文件：stateDir 下只有 hikari/goal/goals.jsonl，且只注册三个工具与一个注入段', async () => {
  const stateDir = await freshStateDir()
  const ctx = fakeCtx()
  await apply(ctx, { stateDir })
  await ctx.registeredTools.get('set_goal').execute({ text: '写点东西' })

  assert.deepEqual(await readdir(stateDir), ['hikari'], 'stateDir 下只出现 hikari/')  
  assert.equal(ctx.registeredTools.size, 3, '只有三个工具')
  assert.equal(ctx.contexts.length, 1, '只有一个注入段')
  const hikariDir = join(stateDir, 'hikari')
  assert.deepEqual(await readdir(hikariDir), ['goal'])
  assert.deepEqual(await readdir(join(hikariDir, 'goal')), ['goals.jsonl'])
})

test('注入的时间措辞：今天立的 / 立了 N 天（不用「N 天立的」这种半截话）', async () => {
  const stateDir = await freshStateDir()
  const store = await openGoals({ stateDir })
  await store.create({ text: '今天的事' })
  const nowMs = Date.now()
  const today = renderGoals(store.openRecords(), { now: nowMs })
  assert.match(today, /（今天立的）：今天的事/)
  const later = renderGoals(store.openRecords(), { now: nowMs + 3 * 24 * 60 * 60 * 1000 })
  assert.match(later, /（立了 3 天）：今天的事/)
  assert.doesNotMatch(later, /天立的/)
  store.close()
})

test('list_goals 的 total 是全量条数，不随 limit 缩小', async () => {
  const stateDir = await freshStateDir()
  const ctx = fakeCtx()
  await apply(ctx, { stateDir })
  const setGoal = ctx.registeredTools.get('set_goal')
  for (let index = 1; index <= 3; index += 1) {
    await setGoal.execute({ text: '第 ' + index + ' 件事' })
  }
  const listed = await ctx.registeredTools.get('list_goals').execute({ limit: 1 })
  assert.equal(listed.goals.length, 1)
  assert.equal(listed.total, 3, 'total 不受 limit 影响')
  ctx.disposers[0]()
})
