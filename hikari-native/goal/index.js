/**
 * hikari-goal：她自己许下的、还没做完的事。
 *
 * 边界在 docs/architecture/goal-v0-boundary-freeze.md。这一版只做三件事：
 *
 *   1. 一张只追加的清单（`<stateDir>/hikari/goal/goals.jsonl`）；
 *   2. 三个工具：set_goal / change_goal / list_goals；
 *   3. 一段每请求的注入：把她自己写下的、还没做完的那几条原样摆回她眼前。
 *
 * 不做的（写在这里是因为它们最容易被顺手加上）：自动创建目标、自动拆解或
 * 排期、自动判断完成、优先级排序、把目标推进对话流、导出 Service 或发事件。
 * v0 没有第二个消费者，就不为将来预留结构。
 *
 * 与 findings 的分工也只有一条：她说「我要去做」写 goal，说「我观察到」
 * 写 finding（`hikari-native/world/findings.js`）。两张表互不读写。
 */
import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

export const name = 'hikari-goal'
export const inject = ['tools', 'systemPrompt']

const GOALS_DIR = 'goal'
const GOALS_FILE = 'goals.jsonl'

const MAX_TEXT = 300
const MAX_NOTE = 200
const INJECT_LINES = 5
const INJECT_CHARS = 120
const DEFAULT_LIST = 20
const MAX_LIST = 50

const STATUSES = new Set(['open', 'done', 'dropped'])
const GOAL_ID_PATTERN = /^g-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const DAY_MS = 24 * 60 * 60 * 1000

function fail(code, message) {
  throw new Error(`${code}: ${message}`)
}

function expandTilde(value) {
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homedir(), value.slice(2))
  return value
}

/**
 * 目标清单的位置：`<stateDir>/hikari/goal`。
 *
 * 与 Memory 一样**不看 process.cwd()**：这是全局清单，位置不能随调用方的
 * 工作目录变（对照 `hikari-native/memory/store.mjs:67-92`）。
 */
export function resolveGoalDir({ stateDir, env = process.env } = {}) {
  if (typeof stateDir === 'string' && stateDir.trim().length > 0) {
    const expanded = expandTilde(stateDir.trim())
    if (!isAbsolute(expanded)) {
      fail('GOAL_INVALID_INPUT', `stateDir must be an absolute path, got "${stateDir}": the goal list is global, not per-directory`)
    }
    return join(resolve(expanded), 'hikari', GOALS_DIR)
  }
  const raw = env.DSH_HOME
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const expanded = expandTilde(raw.trim())
    if (!isAbsolute(expanded)) {
      fail('GOAL_INVALID_INPUT', `DSH_HOME must be an absolute path, got "${raw}"`)
    }
    return join(expanded, 'hikari', GOALS_DIR)
  }
  return join(homedir(), '.dsh', 'hikari', GOALS_DIR)
}

function validateRecord(record) {
  const errors = []
  if (typeof record !== 'object' || record === null || Array.isArray(record)) {
    return { ok: false, errors: ['record is not an object'] }
  }
  const known = new Set(['goalId', 'text', 'status', 'note', 'at'])
  for (const key of Object.keys(record)) {
    if (!known.has(key)) errors.push(`unknown field "${key}"`)
  }
  for (const key of known) {
    if (!(key in record)) errors.push(`missing field "${key}"`)
  }
  if (typeof record.goalId !== 'string' || !GOAL_ID_PATTERN.test(record.goalId)) errors.push('goalId must look like "g-<uuid>"')
  if (typeof record.text !== 'string' || record.text.trim().length === 0) errors.push('text must be a non-empty string')
  if (!STATUSES.has(record.status)) errors.push(`status must be one of ${[...STATUSES].join(' / ')}`)
  if (!(record.note === null || typeof record.note === 'string')) errors.push('note must be a string or null')
  if (!Number.isInteger(record.at) || record.at < 0) errors.push('at must be a non-negative integer (epoch ms)')
  return { ok: errors.length === 0, errors }
}

/**
 * 读回整份清单。尾部半行（写到一半断电）当未写完丢掉；中间坏行 fail-closed
 * ——静默丢一条目标比启动失败更糟（对照 `docs/development/m2a-memory-store.md`
 * 的损坏分类表）。
 */
function foldGoals(raw) {
  const goals = new Map()
  if (raw.length === 0) return { goals, endsOpen: false, tailCorrupt: false }
  const endsOpen = !raw.endsWith('\n')
  const lines = raw.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  lines.forEach((line, index) => {
    if (line.trim().length === 0) return
    const isLast = index === lines.length - 1
    let record
    try {
      record = JSON.parse(line)
    } catch {
      if (endsOpen && isLast) return
      fail('GOAL_CORRUPT', `goals.jsonl line ${index + 1} is not JSON; refusing to drop a goal silently`)
    }
    const check = validateRecord(record)
    if (!check.ok) {
      if (endsOpen && isLast) return
      fail('GOAL_CORRUPT', `goals.jsonl line ${index + 1}: ${check.errors.join('; ')}`)
    }
    goals.set(record.goalId, record)
  })
  return { goals, endsOpen, tailCorrupt: endsOpen && raw.length > 0 }
}

function normalizeText(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    fail('GOAL_TEXT_EMPTY', 'text is empty; write what you intend to do.')
  }
  const clean = text.trim()
  if (clean.length > MAX_TEXT) {
    fail('GOAL_TEXT_TOO_LONG', `${clean.length} characters; keep it under ${MAX_TEXT} (nothing was truncated).`)
  }
  return clean
}

function normalizeNote(note) {
  if (note === undefined || note === null) return null
  if (typeof note !== 'string') fail('GOAL_INVALID_INPUT', 'note must be a string when given')
  const clean = note.trim()
  if (clean.length === 0) return null
  if (clean.length > MAX_NOTE) {
    fail('GOAL_NOTE_TOO_LONG', `${clean.length} characters; keep the note under ${MAX_NOTE}.`)
  }
  return clean
}

function ageLabel(at, now) {
  const days = Math.floor((now - at) / DAY_MS)
  return days <= 0 ? '今天立的' : `立了 ${days} 天`
}

function shorten(text, limit) {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`
}

/**
 * 注入文本。只回放她写下的原文，按立下的时间排，不排序、不建议、不评价。
 * 空清单返回空串——不输出「你没有目标」这种替她下的结论。
 */
export function renderGoals(records, { now = Date.now(), max = INJECT_LINES } = {}) {
  const open = records.filter((record) => record.status === 'open').sort((a, b) => a.at - b.at)
  if (open.length === 0) return ''
  const shown = open.slice(0, max)
  const lines = shown.map((record) => `- ${record.goalId}（${ageLabel(record.at, now)}）：${shorten(record.text, INJECT_CHARS)}`)
  if (open.length > shown.length) {
    lines.push(`（还有 ${open.length - shown.length} 条没列出，用 list_goals 看全部）`)
  }
  return ['你自己立下、还没做完的事：', ...lines].join('\n')
}

/**
 * 打开清单。写入串行化（同一实例内的并发 append 不会交错）。
 */
export async function openGoals({ stateDir, env = process.env, now = Date.now } = {}) {
  const dir = resolveGoalDir({ stateDir, env })
  const file = join(dir, GOALS_FILE)
  let raw = ''
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const folded = foldGoals(raw)
  const goals = folded.goals
  let endsOpen = folded.endsOpen
  let closed = false
  let pending = Promise.resolve()

  const persist = (record) => {
    const line = `${JSON.stringify(record)}\n`
    const write = async () => {
      if (closed) fail('GOAL_STORE_CLOSED', 'the goal list was closed')
      await mkdir(dir, { recursive: true })
      const prefix = endsOpen ? '\n' : ''
      await appendFile(file, `${prefix}${line}`, 'utf8')
      endsOpen = false
      goals.set(record.goalId, record)
      return record
    }
    const run = pending.then(write, write)
    pending = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  const snapshot = (record) => ({ ...record })

  const api = {
    get dir() {
      return dir
    },
    get file() {
      return file
    },
    get size() {
      return goals.size
    },
    /** 按状态取出（缺省 open），按立下的时间升序，先立的在前。 */
    list({ status = 'open', limit = DEFAULT_LIST } = {}) {
      if (!STATUSES.has(status)) fail('GOAL_INVALID_STATUS', `status must be one of ${[...STATUSES].join(' / ')}, got "${String(status)}"`)
      const size = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), MAX_LIST) : DEFAULT_LIST
      return [...goals.values()]
        .filter((record) => record.status === status)
        .sort((a, b) => a.at - b.at)
        .slice(0, size)
        .map(snapshot)
    },
    openRecords() {
      return [...goals.values()].filter((record) => record.status === 'open').map(snapshot)
    },
    /** 该状态的总条数——不受 list 的 limit 影响，`total` 不能用 list 长度冒充。 */
    count(status = 'open') {
      if (!STATUSES.has(status)) fail('GOAL_INVALID_STATUS', `status must be one of ${[...STATUSES].join(' / ')}, got "${String(status)}"`)
      let n = 0
      for (const record of goals.values()) if (record.status === status) n += 1
      return n
    },
    get(goalId) {
      const record = goals.get(goalId)
      return record === undefined ? undefined : snapshot(record)
    },
    async create({ text, note } = {}) {
      const record = {
        goalId: `g-${randomUUID()}`,
        text: normalizeText(text),
        status: 'open',
        note: normalizeNote(note),
        at: now(),
      }
      return snapshot(await persist(record))
    },
    async update({ goalId, status, note } = {}) {
      if (typeof goalId !== 'string' || goalId.trim().length === 0) {
        fail('GOAL_UNKNOWN_ID', 'goalId is required')
      }
      const current = goals.get(goalId.trim())
      if (current === undefined) {
        fail('GOAL_UNKNOWN_ID', `no goal "${goalId}"; use list_goals to see what you have.`)
      }
      if (!STATUSES.has(status)) {
        fail('GOAL_INVALID_STATUS', `status must be one of ${[...STATUSES].join(' / ')}, got "${String(status)}"`)
      }
      if (status === current.status && note === undefined) {
        return { ...current }
      }
      const record = {
        goalId: current.goalId,
        text: current.text,
        status,
        note: normalizeNote(note),
        at: now(),
      }
      return snapshot(await persist(record))
    },
    close() {
      closed = true
    },
  }
  return api
}

const SET_DESCRIPTION = [
  'Write down one thing you intend to do, so it is still yours tomorrow.',
  'This is your own long-lived commitment list, not the session task goal (create_goal / update_goal): that one ends with the conversation, this one outlives it.',
  'One goal per call, at most 300 characters. Use it when you decide something matters beyond this turn.',
  'Do not write observations here — those are findings (record_finding).',
].join(' ')

const UPDATE_DESCRIPTION = [
  'Change the state of a goal you already wrote: "done" when it is finished, "dropped" when you decide not to do it, "open" to take it back.',
  'Every change appends a new line; nothing is deleted or rewritten.',
  'This is your long-lived list, not the session task goal.',
].join(' ')

const LIST_DESCRIPTION = [
  'List your goals, oldest first. By default only the ones still open.',
  'This is a plain read: it does not suggest what to do next and does not rank them.',
].join(' ')

const GOAL_PARAMETER = {
  type: 'object',
  additionalProperties: false,
  properties: {
    goalId: { type: 'string', description: 'The id returned when the goal was written, like "g-1f2e…".' },
    status: { type: 'string', enum: ['open', 'done', 'dropped'], description: 'Where this goal stands now.' },
    note: { type: 'string', description: 'One line about why it changed (optional, up to 200 characters).' },
  },
  required: ['goalId', 'status'],
}

function outputSchema(properties, required) {
  return { type: 'object', additionalProperties: true, properties, required }
}

function renderValue(value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

export function installGoalTools(ctx, store, { now = Date.now } = {}) {
  ctx.tools.register({
    name: 'set_goal',
    description: SET_DESCRIPTION,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: { type: 'string', description: 'What you intend to do, in your own words (up to 300 characters).' },
        note: { type: 'string', description: 'Why it matters, or where it came from (optional, up to 200 characters).' },
      },
      required: ['text'],
    },
    output: {
      schema: outputSchema(
        { goalId: { type: 'string' }, status: { type: 'string' }, at: { type: 'number' }, chars: { type: 'number' } },
        ['goalId', 'status', 'at', 'chars'],
      ),
      render: (_args, value) => renderValue(value),
    },
    async execute(args) {
      const record = await store.create({ text: args.text, note: args.note })
      return { goalId: record.goalId, status: record.status, at: record.at, chars: record.text.length }
    },
  })

  ctx.tools.register({
    name: 'change_goal',
    description: UPDATE_DESCRIPTION,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: GOAL_PARAMETER.properties,
      required: GOAL_PARAMETER.required,
    },
    output: {
      schema: outputSchema(
        { goalId: { type: 'string' }, status: { type: 'string' }, previousStatus: { type: 'string' }, at: { type: 'number' } },
        ['goalId', 'status', 'previousStatus', 'at'],
      ),
      render: (_args, value) => renderValue(value),
    },
    async execute(args) {
      const before = store.get(args.goalId)
      const record = await store.update({ goalId: args.goalId, status: args.status, note: args.note })
      return { goalId: record.goalId, status: record.status, previousStatus: before.status, at: record.at }
    },
  })

  ctx.tools.register({
    name: 'list_goals',
    description: LIST_DESCRIPTION,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        status: { type: 'string', enum: ['open', 'done', 'dropped'], description: 'Which ones to list; defaults to "open".' },
        limit: { type: 'number', description: 'How many to return (1-50, default 20).' },
      },
      required: [],
    },
    output: {
      schema: outputSchema(
        {
          goals: { type: 'array' },
          total: { type: 'number' },
        },
        ['goals', 'total'],
      ),
      render: (_args, value) => renderValue(value),
    },
    async execute(args) {
      const status = typeof args.status === 'string' ? args.status : 'open'
      const limit = Number.isInteger(args.limit) ? args.limit : DEFAULT_LIST
      if (Number.isInteger(args.limit) && (args.limit < 1 || args.limit > MAX_LIST)) {
        fail('GOAL_INVALID_LIMIT', `limit must be between 1 and ${MAX_LIST}, got ${args.limit}`)
      }
      const records = store.list({ status, limit })
      const nowMs = now()
      return {
        goals: records.map((record) => ({ ...record, ageDays: Math.max(Math.floor((nowMs - record.at) / DAY_MS), 0) })),
        total: store.count(status),
      }
    },
  })
}

export async function apply(ctx, config = {}) {
  const store = await openGoals({ stateDir: config.stateDir })
  ctx.effect(() => () => {
    store.close()
  })

  // 注入排在 findings（order 150）之后：先看她对世界的假设，再看她自己许下的事。
  ctx.systemPrompt.context({
    name: 'hikari:goals',
    order: 160,
    text: () => renderGoals(store.openRecords()),
  })

  installGoalTools(ctx, store)
  ctx.logger.info(`hikari goal ready (dir=${store.dir}, goals=${store.size})`)
}
