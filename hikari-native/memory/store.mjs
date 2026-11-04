/**
 * Hikari Native — Memory Store（M2-a）。
 *
 * 职责：Hikari 自己的长期记忆存储层。全局唯一、跨项目、跨 Session，
 * 随 `hikari-memory` 插件的生命周期加载与释放。
 *
 * 边界（任务书 §3、§4）：
 *   - 只做存储：目录、append-only 文件、元数据、内存索引、启动恢复、完整性校验。
 *   - 不提供写入工具，不实现检索，不做自动分类、自动过期、自动注入。
 *   - 不读会话、不读 World 的 findings，不持有任何跨插件的引用。
 *
 * 为什么是「文件 + 内存索引」而不是数据库：M2 §4 比较过四种持久化方案，
 * 独立 append-only 文件是唯一同时满足「不引入新依赖」「可人工审阅」
 * 「写失败不污染已有数据」三个条件的。代价是启动要全量重放，M2 接受。
 */
import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

/** 数据格式版本。改动记录字段的语义时必须 +1，且不写迁移代码（M2 §9.4）。 */
export const MEMORY_SCHEMA_VERSION = 1

export const MEMORY_JSONL = 'memory.jsonl'
export const MEMORY_META = 'memory.meta.json'

/**
 * 一条记忆的全部顶层字段，顺序与 `docs/architecture/memory-core-m2-architecture-v0.1.md` §3.1 一致。
 * 校验按这张表进行：多一个字段、少一个字段都算无效记录。
 */
export const MEMORY_FIELDS = [
  'memoryId',
  'text',
  'occurredAt',
  'recordedAt',
  'validFrom',
  'validTo',
  'validHint',
  'source',
  'supersedes',
  'seq',
]

const MEMORY_ID_PATTERN = /^m-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** 展开 `~`、`~/`、`~\`；其它形式原样返回。对应 DSH 的 `expandHomePath`。 */
function expandTilde(path) {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/**
 * 解析全局记忆目录。
 *
 * 优先级与 DSH 自己的 `resolveDshHome` 一致（那一份在
 * `@deepseek-ai/dsh-home-paths` 里，本仓库没有这个依赖，CI 上也装不到，
 * 所以这里按同样规则实现了一遍——不是重新发明，是对齐）：
 *   1. 显式配置（测试与实验用这个把数据写到临时目录）
 *   2. `$DSH_HOME`（空白视为未设，否则会解析到当前工作目录）
 *   3. `~/.dsh`
 * 之后再拼 `hikari/memory`。
 *
 * 注意：这里**不看 `process.cwd()`**。任务书 §3.3 要求「不得依赖当前工作目录
 * 或项目仓库路径决定全局记忆位置」——这一行就是那条约束的实现。
 */
export function resolveMemoryDir({ storeDir, env = process.env } = {}) {
  if (typeof storeDir === 'string' && storeDir.trim().length > 0) {
    const expanded = expandTilde(storeDir.trim())
    // 显式配置也必须不依赖 cwd：相对路径会随调用方的工作目录变，而这是全局记忆。
    if (!isAbsolute(expanded)) {
      throw new MemoryStoreError(
        'INVALID_INPUT',
        `storeDir 必须是绝对路径，收到 "${storeDir}"：全局记忆不能建在当前工作目录下`,
      )
    }
    return resolve(expanded)
  }
  const raw = env.DSH_HOME
  const home = typeof raw === 'string' && raw.trim().length > 0
    ? resolve(expandTilde(raw.trim()))
    : join(homedir(), '.dsh')
  return join(home, 'hikari', 'memory')
}

function isNullableTimestamp(value) {
  return value === null || (Number.isInteger(value) && value >= 0)
}

/**
 * 校验一条记录的形状。
 *
 * 返回 `{ ok, errors }` 而不是抛错：恢复时要逐个统计问题，抛错只能报第一个。
 * 严格到「多字段也算错」，因为 schema 漂移最常见的形态就是某个版本多写了一个字段，
 * 放宽会把两个版本的数据混成一套。
 */
export function validateRecord(record) {
  const errors = []
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    return { ok: false, errors: ['记录不是对象'] }
  }

  const keys = Object.keys(record)
  for (const key of MEMORY_FIELDS) {
    if (!keys.includes(key)) errors.push(`缺少字段 ${key}`)
  }
  for (const key of keys) {
    if (!MEMORY_FIELDS.includes(key)) errors.push(`未知字段 ${key}`)
  }

  if (typeof record.memoryId !== 'string' || !MEMORY_ID_PATTERN.test(record.memoryId)) {
    errors.push('memoryId 必须是 m-<uuid> 形式')
  }
  if (typeof record.text !== 'string' || record.text.trim().length === 0) {
    errors.push('text 必须是非空字符串')
  }
  if (!isNullableTimestamp(record.occurredAt)) errors.push('occurredAt 必须是 null 或非负整数')
  if (!Number.isInteger(record.recordedAt) || record.recordedAt < 0) {
    errors.push('recordedAt 必须是非负整数')
  }
  if (!isNullableTimestamp(record.validFrom)) errors.push('validFrom 必须是 null 或非负整数')
  if (!isNullableTimestamp(record.validTo)) errors.push('validTo 必须是 null 或非负整数')
  if (record.validHint !== null && typeof record.validHint !== 'string') {
    errors.push('validHint 必须是 null 或字符串')
  }
  const source = record.source
  if (source === null || typeof source !== 'object' || Array.isArray(source)) {
    errors.push('source 必须是 { kind, ref } 对象')
  } else {
    if (typeof source.kind !== 'string' || source.kind.trim().length === 0) {
      errors.push('source.kind 必须是非空字符串')
    }
    if (source.ref !== null && typeof source.ref !== 'string') {
      errors.push('source.ref 必须是 null 或字符串')
    }
    for (const key of Object.keys(source)) {
      if (key !== 'kind' && key !== 'ref') errors.push(`source 未知字段 ${key}`)
    }
  }
  if (record.supersedes !== null) {
    if (typeof record.supersedes !== 'string' || !MEMORY_ID_PATTERN.test(record.supersedes)) {
      errors.push('supersedes 必须是 null 或 m-<uuid> 形式')
    }
  }
  if (!Number.isInteger(record.seq) || record.seq < 1) {
    errors.push('seq 必须是正整数')
  }

  return { ok: errors.length === 0, errors }
}

/** 存储层错误。带 `code` 是为了让调用方与测试能区分「可修复」与「必须停用」。 */
export class MemoryStoreError extends Error {
  constructor(code, message, details) {
    super(message)
    this.name = 'MemoryStoreError'
    this.code = code
    this.details = details
  }
}

function emptyMeta(now) {
  return {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    createdAt: now,
    recordCount: 0,
    lastSeq: 0,
    tailCorrupt: null,
    // 已确认损坏、且已经报告过的行号。这些行跳过后不再报错，但也不删除——
    // 文件本身从不重写，坏字节留在原地，只是不参与索引。
    corruptLines: [],
  }
}

/** 两条记录除 `seq` 外是否逐字段相同——用于判断重复 id 是重放还是硬冲突。 */
function sameContent(a, b) {
  if (a.text !== b.text) return false
  if (a.occurredAt !== b.occurredAt) return false
  if (a.validFrom !== b.validFrom) return false
  if (a.validTo !== b.validTo) return false
  if (a.validHint !== b.validHint) return false
  if (a.supersedes !== b.supersedes) return false
  if (a.source?.kind !== b.source?.kind) return false
  if (a.source?.ref !== b.source?.ref) return false
  return true
}

export class MemoryStore {
  #dir
  #metaPath
  #jsonlPath
  #records = new Map()
  #seqOrder = []
  #lastSeq = 0
  #meta
  #damage
  #needsNewline = false
  #now
  #closed = false

  constructor(options) {
    this.#dir = options.dir
    this.#jsonlPath = join(this.#dir, MEMORY_JSONL)
    this.#metaPath = join(this.#dir, MEMORY_META)
    this.#meta = options.meta
    this.#damage = options.damage
    this.#lastSeq = options.meta.lastSeq
    this.#needsNewline = options.needsNewline
    this.#now = options.now ?? Date.now
  }

  get dir() {
    return this.#dir
  }

  get size() {
    return this.#records.size
  }

  get lastSeq() {
    return this.#lastSeq
  }

  get closed() {
    return this.#closed
  }

  /**
   * 启动时发现的问题。`tailCorrupt` 非空不代表原文件被改过——本实现从不重写
   * `memory.jsonl`，残片留在原地，只是不参与索引。
   */
  get damage() {
    return {
      tailCorrupt: this.#damage.tailCorrupt,
      skippedDuplicates: this.#damage.skippedDuplicates,
      skippedCorruptLines: this.#damage.skippedCorruptLines,
      metaRepaired: this.#damage.metaRepaired,
    }
  }

  /** 按写入顺序返回全部记录的只读快照（不含内部引用）。 */
  all() {
    return this.#seqOrder.map((id) => Object.freeze({ ...this.#records.get(id) }))
  }

  get(memoryId) {
    const record = this.#records.get(memoryId)
    return record === undefined ? undefined : Object.freeze({ ...record })
  }

  /**
   * 打开（或创建）存储。
   *
   * 恢复顺序故意是「先 meta 后 jsonl」：meta 便宜、jsonl 贵，先花一次小代价
   * 把 schema 不兼容拦在门外，不必先把大文件读完才发现不该读。
   */
  static async open({ storeDir, env, now } = {}) {
    const dir = resolveMemoryDir({ storeDir, env })
    const clock = now ?? Date.now
    await mkdir(dir, { recursive: true })

    const metaPath = join(dir, MEMORY_META)
    const jsonlPath = join(dir, MEMORY_JSONL)

    const damage = { tailCorrupt: null, skippedDuplicates: 0, skippedCorruptLines: 0, metaRepaired: false }

    // 1. meta：不存在就当作全新存储；存在但版本不符则拒绝启动（不迁移、不猜）。
    let meta
    try {
      const text = await readFile(metaPath, 'utf8')
      meta = JSON.parse(text)
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw new MemoryStoreError('META_UNREADABLE', `无法读取 ${MEMORY_META}：${error.message}`, {
          path: metaPath,
        })
      }
      meta = emptyMeta(clock())
    }

    if (meta.schemaVersion !== MEMORY_SCHEMA_VERSION) {
      throw new MemoryStoreError(
        'SCHEMA_INCOMPATIBLE',
        `记忆存储的 schemaVersion 是 ${String(meta.schemaVersion)}，本版本只支持 ${MEMORY_SCHEMA_VERSION}；` +
        '按 M2 §9.4 拒绝启动而不是就地迁移，原文件未改动',
        { path: metaPath, found: meta.schemaVersion, expected: MEMORY_SCHEMA_VERSION },
      )
    }

    // 2. jsonl：不存在就是空存储。
    let raw = ''
    try {
      raw = await readFile(jsonlPath, 'utf8')
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw new MemoryStoreError('JSONL_UNREADABLE', `无法读取 ${MEMORY_JSONL}：${error.message}`, {
          path: jsonlPath,
        })
      }
      raw = ''
    }

    const records = new Map()
    const seqOrder = []
    let lastSeq = 0
    let needsNewline = false

    const lines = raw.split('\n')
    // 末尾的空串是文件以换行结尾的正常产物，不是一行内容。
    const lastIndex = lines.length - 1
    const hasTrailingNewline = lines[lastIndex] === ''

    // 上一次启动报告过的损坏行。文件从不重写，所以坏字节还在原地、行号也稳定
    // （append-only 只往后长）。已经报告过的行继续跳过，但不重复报错——
    // 否则一条残片会让存储从此永远启动失败。
    const knownCorrupt = new Set(Array.isArray(meta.corruptLines) ? meta.corruptLines : [])
    const stillCorrupt = []

    for (let i = 0; i <= lastIndex; i += 1) {
      const line = lines[i]
      if (line.trim().length === 0) continue
      const lineNo = i + 1
      const isLastContentLine = i === lastIndex || (hasTrailingNewline && i === lastIndex - 1)
      const bytes = Buffer.byteLength(line, 'utf8')

      const skipKnown = () => {
        stillCorrupt.push(lineNo)
        damage.skippedCorruptLines += 1
      }

      let parsed
      try {
        parsed = JSON.parse(line)
      } catch {
        if (knownCorrupt.has(lineNo)) {
          skipKnown()
          continue
        }
        if (isLastContentLine) {
          // 只有「最后一个非空行」才允许当残片处理：它后面没有别的记录，
          // 跳过它不影响任何其它数据。中间行坏掉说明中间丢了内容，不能猜。
          damage.tailCorrupt = { line: lineNo, bytes }
          stillCorrupt.push(lineNo)
          needsNewline = !hasTrailingNewline
          break
        }
        throw new MemoryStoreError(
          'CORRUPT_MIDDLE_LINE',
          `${MEMORY_JSONL} 第 ${lineNo} 行不是合法 JSON，且后面还有记录；` +
          '按任务书「无法安全恢复的数据明确报错并保留原始文件」，停用存储而不跳过',
          { path: jsonlPath, line: lineNo },
        )
      }

      const { ok, errors } = validateRecord(parsed)
      if (!ok) {
        if (knownCorrupt.has(lineNo)) {
          skipKnown()
          continue
        }
        if (isLastContentLine) {
          damage.tailCorrupt = { line: lineNo, bytes }
          stillCorrupt.push(lineNo)
          needsNewline = !hasTrailingNewline
          break
        }
        throw new MemoryStoreError(
          'INVALID_MIDDLE_RECORD',
          `${MEMORY_JSONL} 第 ${lineNo} 行记录无效（${errors.join('；')}），且后面还有记录`,
          { path: jsonlPath, line: lineNo, errors },
        )
      }

      const existing = records.get(parsed.memoryId)
      if (existing !== undefined) {
        if (!sameContent(existing, parsed)) {
          throw new MemoryStoreError(
            'DUPLICATE_MEMORY_ID',
            `memoryId ${parsed.memoryId} 出现两次且内容不同（第 ${lineNo} 行）；` +
            '同一个 id 装两段不同的记忆，猜哪一个对都是在编，只能报错',
            { path: jsonlPath, line: lineNo, memoryId: parsed.memoryId },
          )
        }
        // 内容完全相同的重复 id 视为重放：保留后者即可，计数上报，不静默。
        damage.skippedDuplicates += 1
        records.set(parsed.memoryId, parsed)
        continue
      }

      records.set(parsed.memoryId, parsed)
      seqOrder.push(parsed.memoryId)
      if (parsed.seq > lastSeq) lastSeq = parsed.seq
    }

    // 3. meta 与 jsonl 对不上：以 jsonl 为准重建。meta 里的 recordCount/lastSeq
    //    都只是 jsonl 的派生值，没有任何信息是 jsonl 推不出来的——所以不存在
    //    「以 meta 为准」能救回一条记忆的情形。
    if (meta.recordCount !== records.size || meta.lastSeq !== lastSeq) {
      damage.metaRepaired = true
    }
    const repairedMeta = {
      ...meta,
      schemaVersion: MEMORY_SCHEMA_VERSION,
      createdAt: meta.createdAt ?? clock(),
      recordCount: records.size,
      lastSeq,
      tailCorrupt: damage.tailCorrupt,
      corruptLines: [...stillCorrupt].sort((a, b) => a - b),
    }
    await writeFile(metaPath, `${JSON.stringify(repairedMeta, null, 2)}\n`, 'utf8')

    const store = new MemoryStore({
      dir,
      meta: repairedMeta,
      damage,
      needsNewline,
      now: clock,
    })
    store.#records = records
    store.#seqOrder = seqOrder
    return store
  }

  /**
   * 追加一条记录。`recordedAt`、`memoryId`、`seq` 由存储层生成，调用方给不了。
   *
   * 顺序是「先写文件、再改内存」：写失败时内存索引仍然干净，不会出现
   * 「索引里有、文件里没有」这种下次重启就会对不上的状态。
   */
  async append(input) {
    if (this.#closed) {
      throw new MemoryStoreError('STORE_CLOSED', '存储已关闭，不能再追加记录')
    }
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      throw new MemoryStoreError('INVALID_INPUT', 'append 需要一个对象参数')
    }
    const allowed = ['text', 'occurredAt', 'validFrom', 'validTo', 'validHint', 'source', 'supersedes']
    for (const key of Object.keys(input)) {
      if (!allowed.includes(key)) {
        throw new MemoryStoreError('INVALID_INPUT', `append 不接受字段 ${key}（由存储层生成的字段不能手填）`)
      }
    }

    const record = {
      memoryId: `m-${randomUUID()}`,
      text: input.text,
      occurredAt: input.occurredAt ?? null,
      recordedAt: this.#now(),
      validFrom: input.validFrom ?? null,
      validTo: input.validTo ?? null,
      validHint: input.validHint ?? null,
      source: input.source ?? { kind: 'unknown', ref: null },
      supersedes: input.supersedes ?? null,
      seq: this.#lastSeq + 1,
    }

    const { ok, errors } = validateRecord(record)
    if (!ok) {
      throw new MemoryStoreError('INVALID_RECORD', `记录无效：${errors.join('；')}`, { errors })
    }
    if (record.supersedes !== null && !this.#records.has(record.supersedes)) {
      throw new MemoryStoreError(
        'SUPERSEDES_UNKNOWN',
        `supersedes 指向不存在的记忆 ${record.supersedes}`,
        { supersedes: record.supersedes },
      )
    }

    // 上次启动时发现末尾有无换行的残片：先补一个换行把它封成独立一行，
    // 否则新记录会与残片粘成一行，下次启动会读到一条坏记录。
    const prefix = this.#needsNewline ? '\n' : ''
    await appendFile(this.#jsonlPath, `${prefix}${JSON.stringify(record)}\n`, 'utf8')
    this.#needsNewline = false

    this.#records.set(record.memoryId, record)
    this.#seqOrder.push(record.memoryId)
    this.#lastSeq = record.seq

    this.#meta = {
      ...this.#meta,
      recordCount: this.#records.size,
      lastSeq: this.#lastSeq,
      tailCorrupt: this.#damage.tailCorrupt,
    }
    await writeFile(this.#metaPath, `${JSON.stringify(this.#meta, null, 2)}\n`, 'utf8')

    return Object.freeze({ ...record })
  }

  /**
   * 释放。本实现每次写入都自己开关文件（`appendFile`），不持有句柄，
   * 所以这里没有需要关闭的系统资源；它只标记状态，让「卸载后再写」变成显式错误。
   * 之所以保留这个方法：插件卸载路径需要一个确定的收尾点，将来加了句柄或缓存
   * 也能从这里接上。
   */
  async close() {
    this.#closed = true
  }
}

/** 只读地检查一个目录下是否存在存储文件（不创建、不修复）。诊断与测试用。 */
export async function inspectStoreDir(dir) {
  const result = { dir, exists: false, hasJsonl: false, hasMeta: false, bytes: 0 }
  try {
    await stat(dir)
    result.exists = true
  } catch {
    return result
  }
  for (const [key, name] of [['hasJsonl', MEMORY_JSONL], ['hasMeta', MEMORY_META]]) {
    try {
      const info = await stat(join(dir, name))
      result[key] = info.isFile()
      if (key === 'hasJsonl') result.bytes = info.size
    } catch {
      // 不存在就是 false，调用方自己决定这是不是问题
    }
  }
  return result
}
