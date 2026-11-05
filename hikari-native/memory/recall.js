/**
 * Hikari Native — Memory 的两个发现工具（M2-c 建，M2-d 改匹配口径）。
 *
 * `search_memories` 在全局记忆里按正文找候选；`get_memory` 按 id 读一条完整记录。
 * 契约冻结在 `docs/architecture/m2c-memory-discovery-interface-freeze.md`（工具名、参数、
 * 返回键、错误码）与 `docs/architecture/m2d-memory-matching-interface-freeze.md`（匹配口径
 * 与排序）：改它们要重开审阅。
 *
 * 边界：
 *   - 只读：只用 `MemoryStore` 的 `all()` 与 `get()`，不 append、不改 `MEMORY_FIELDS`、
 *     不改 `validateRecord`、不新增 store 导出、不新增持久化。
 *   - 与 `tools.js` 的两个检索工具是**不同的存储**：那两个读 World findings（本 session
 *     的日志投影），这里读跨项目跨 session 的长期记忆文件。名字只差一个字母，所以两个
 *     description 的第一句都写明了作用域。
 *   - `supersededBy` 是**派生键**：每次读取时从现有 `supersedes` 反查得到，不落盘
 *     （落盘会被 `store.mjs:105-158` 的十字段校验直接拒收）。
 *   - 不做传递闭包（`docs/architecture/memory-core-m2-architecture-v0.1.md:383`）、
 *     不做分词、不做语义/向量检索、不做跨语言、不检查 `source.ref` 可达性、不自动注入。
 *
 * 两个已知局限（交付时留在文档与 commit message 里）：
 *   1. 检索是全表扫（`store.mjs:259-261` 的 `all()` 是 O(n)），记录上万条后需要索引。
 *   2. `occurredAt` 长期大量为 `null`（模型没有时钟），时间窗会漏掉这些记录——这是
 *      有意为之：不知道何时发生，就不该被时间窗挑出来。
 */

/** 候选摘要的正文长度：够认出是哪一条，又不会把存储塞回上下文。 */
export const SNIPPET_CHARS = 120
/** 一页的缺省条数。 */
export const DEFAULT_LIMIT = 10
/** 一页的上限。 */
export const MAX_LIMIT = 20
/** 中文侧片段覆盖率的下限（M2-d 冻结面 §2.1）：19 条 query 上 0 误命中的那条线。 */
export const MIN_COVERAGE = 0.25
/** 只有拉丁词元、没走快速路径时的强度——证据只有一个词，刻意压低。 */
const LATIN_ONLY_STRENGTH = 0.5
/** 片段路径的强度上限：低于 1，让「整串命中」始终排在最前。 */
const MAX_FRAGMENT_STRENGTH = 0.99

/** 切词与切片段共用：标点/符号/空白。 */
const SEPARATOR = /[\s\p{P}\p{S}]+/u
/** 拉丁词元（含代码里常见的 `_ . # / -`）。 */
const LATIN_WORD = /^[a-z0-9_.#/-]+$/u

/**
 * 统一的失败形态：`throw new Error('<CODE>: <一句话>')`。
 *
 * 与 `writing.js:48` 同一个风格：普通 `Error`、错误码作消息前缀，测试判前缀不判类。
 */
function fail(code, message) {
  return new Error(`${code}: ${message}`)
}

/** 把原值展示给模型看（`'123'` 与 `123.5` 要能分辨）。 */
function present(value) {
  if (typeof value === 'string') return JSON.stringify(value)
  return String(value)
}

function isAbsent(value) {
  return value === undefined || value === null
}

/**
 * `since` / `until`：省略或 `null` → `null`；非 null 时必须是非负整数。
 *
 * 不折叠非数字（与 `writing.js` 的时间字段同一口径）：`'123'` 这类输入要明确报错，
 * 否则模型会以为时间窗生效了。记录侧也只接受非负整数（`hikari-native/memory/store.mjs:125-130`）。
 */
function normalizeBound(raw, field) {
  if (isAbsent(raw)) return null
  if (!Number.isInteger(raw) || raw < 0) {
    throw fail(
      'MEMORY_INVALID_TIME',
      `${field} must be Unix epoch MILLISECONDS, not ${present(raw)}. ` +
      'Use a 13-digit millisecond timestamp, or omit the field.',
    )
  }
  return raw
}

/**
 * 检索参数规范化（冻结面 §5）。**校验与夹取都在这里**，`matchMemories` 只做纯过滤。
 */
export function normalizeSearchInput(args) {
  const raw = args === null || typeof args !== 'object' ? {} : args

  const query = typeof raw.query === 'string' ? raw.query.trim() : ''
  if (typeof raw.query !== 'string' || query === '') {
    throw fail('MEMORY_QUERY_EMPTY', 'query is empty; search with the words you are trying to remember.')
  }

  const since = normalizeBound(raw.since, 'since')
  const until = normalizeBound(raw.until, 'until')
  if (since !== null && until !== null && since > until) {
    throw fail('MEMORY_INVALID_RANGE', `until ${until} is before since ${since}.`)
  }

  // `limit` 是上限不是承诺：超界夹到边界、不报错（任务书 §7.6）。非数字同样按缺省处理。
  const limit = Number.isInteger(raw.limit) ? Math.min(MAX_LIMIT, Math.max(1, raw.limit)) : DEFAULT_LIMIT
  const nextOffset = Number.isInteger(raw.nextOffset) ? Math.max(0, raw.nextOffset) : 0

  return {
    query,
    since,
    until,
    headOnly: raw.headOnly === true,
    limit,
    nextOffset,
  }
}

function tokensOf(text) {
  return text.split(SEPARATOR).filter((chunk) => chunk !== '')
}

/**
 * 非拉丁片段内的相邻字符对（bigram）；长度为 1 的片段取该字本身。
 *
 * 只取非拉丁部分：拉丁字母的 bigram 在代码词里遍地都是（`supersedes`、`store`、
 * `delete`、`script`），拿它们算覆盖率会把无关 query 顶过线——这是 M2-d 探针抓到的
 * 主要误命中来源（`experiments/m2d-matching/matching-probe.md`）。
 */
function cjkFragmentsOf(text) {
  const out = new Set()
  for (const chunk of text.split(SEPARATOR)) {
    if (chunk === '' || LATIN_WORD.test(chunk)) continue
    if (chunk.length === 1) {
      out.add(chunk)
      continue
    }
    for (let i = 0; i + 1 < chunk.length; i += 1) out.add(chunk.slice(i, i + 2))
  }
  return out
}

/**
 * 一条 query 与一条正文的匹配强度（M2-d 冻结面 §2.1）。返回 `0..1`，不命中返回 `null`。
 *
 * 顺序：
 *   1. 整串子串命中 → `1`（快速路径，也是最强的命中）；
 *   2. 拉丁词元必须被正文某个词元包含（`revise` 能中 `revise_memory`，`typescript`
 *      不能中 `script`）；任一词元不满足 → `null`；
 *   3. 中文侧片段覆盖率 ≥ `MIN_COVERAGE` 才算命中，强度即覆盖率（上限 `0.99`）；
 *   4. 只有拉丁词元、且快速路径未中 → `LATIN_ONLY_STRENGTH`。
 *
 * 不做分词、不做语义：这是字面口径，换义词（`两次修改同一条记忆`）与跨语言问法仍然
 * 命中不了，留给 M2-e。
 */
export function matchStrength(query, text) {
  const q = String(query).toLowerCase()
  const t = String(text).toLowerCase()
  if (t.includes(q)) return 1

  const latinTokens = tokensOf(q).filter((token) => LATIN_WORD.test(token))
  if (latinTokens.length > 0) {
    const textTokens = tokensOf(t)
    for (const token of latinTokens) {
      if (!textTokens.some((candidate) => candidate.includes(token))) return null
    }
  }

  const fragments = cjkFragmentsOf(q)
  if (fragments.size === 0) return latinTokens.length > 0 ? LATIN_ONLY_STRENGTH : null

  const textFragments = cjkFragmentsOf(t)
  let hit = 0
  for (const fragment of fragments) if (textFragments.has(fragment)) hit += 1
  const coverage = hit / fragments.size
  if (coverage < MIN_COVERAGE) return null
  return Math.min(coverage, MAX_FRAGMENT_STRENGTH)
}

/**
 * 一次性建 `Map<被替代的 id, 替代它的 id>`。记录按 `seq` 递增 replay，一条旧记录只会有
 * 一个直接后继（`writing.js:272-282` 的链头判定保证了这点）。
 */
export function indexSupersedes(records) {
  const supersededBy = new Map()
  for (const record of records) {
    if (record.supersedes !== null) supersededBy.set(record.supersedes, record.memoryId)
  }
  return supersededBy
}

/**
 * 过滤 + 排序。返回**全部**命中（分页交给调用者），因为 `nextOffset` 要判断"还有没有"。
 *
 * 顺序固定：匹配强度 → 时间窗 → `headOnly` → 排序「强度倒序、同强度 `seq` 倒序」
 * （M2-d 冻结面 §2.2）。时间窗对 `occurredAt === null` 一律不命中——不知道何时发生的
 * 记录，不该被"某段时间内"挑出来。
 *
 * 强度不落盘：每次检索现算。记录上没有 `score` 字段，也不该有。
 */
export function matchMemories(records, input, supersededBy = indexSupersedes(records)) {
  const matched = []
  for (const record of records) {
    const strength = matchStrength(input.query, record.text)
    if (strength === null) continue
    if (input.since !== null || input.until !== null) {
      if (record.occurredAt === null) continue
      if (input.since !== null && record.occurredAt < input.since) continue
      if (input.until !== null && record.occurredAt > input.until) continue
    }
    if (input.headOnly && supersededBy.has(record.memoryId)) continue
    matched.push({ record, strength })
  }
  // 先看命中强度，再按 seq 倒序（`occurredAt` 大量为 null，不能用来排）。
  matched.sort((a, b) => b.strength - a.strength || b.record.seq - a.record.seq)
  return matched.map((entry) => entry.record)
}

/** 摘要：`text` 的前 120 个 UTF-16 码元；截断时补 `…`（不计入 120）。 */
export function snippetOf(text) {
  if (text.length <= SNIPPET_CHARS) return text
  return `${text.slice(0, SNIPPET_CHARS)}…`
}

/** 候选五键：id、摘要、何时发生、有效期猜测、是否已被修订。不给全文、不给来源。 */
export function presentCandidate(record, supersededBy) {
  return {
    memoryId: record.memoryId,
    snippet: snippetOf(record.text),
    occurredAt: record.occurredAt,
    validHint: record.validHint,
    supersededBy: supersededBy.get(record.memoryId) ?? null,
  }
}

/**
 * 读一条完整记录：十字段按 `MEMORY_FIELDS` 的顺序展开，外加派生键 `supersededBy`。
 *
 * 不做传递闭包：只给直接前驱的 id（`supersedes` 本身）与直接后继（`supersededBy`）；
 * 邻居的正文不返回，要沿链走就让模型自己再调一次。
 */
export function presentMemory(record, supersededBy) {
  return {
    memoryId: record.memoryId,
    text: record.text,
    occurredAt: record.occurredAt,
    recordedAt: record.recordedAt,
    validFrom: record.validFrom,
    validTo: record.validTo,
    validHint: record.validHint,
    source: record.source,
    supersedes: record.supersedes,
    seq: record.seq,
    supersededBy: supersededBy.get(record.memoryId) ?? null,
  }
}

/** `get_memory` 的 id 校验：先判前缀（`f-` 一定不在记忆里），再查存在性。 */
function assertKnownMemory(store, rawId) {
  if (typeof rawId !== 'string' || rawId.trim() === '') {
    throw fail(
      'MEMORY_UNKNOWN_ID',
      `no memory ${present(rawId)}; use search_memories to find one.`,
    )
  }
  const memoryId = rawId.trim()
  if (memoryId.startsWith('f-')) {
    throw fail('MEMORY_NOT_A_MEMORY', `"${memoryId}" is a World finding, not a memory; use read_memory for findings.`)
  }
  const record = store.get(memoryId)
  if (record === undefined) {
    throw fail('MEMORY_UNKNOWN_ID', `no memory "${memoryId}"; use search_memories to find one.`)
  }
  return record
}

const SEARCH_DESCRIPTION =
  'Search your own long-term memories — the ones written with write_memory, across all projects and sessions. ' +
  'Case-insensitive literal match: an exact substring hit ranks highest; otherwise Latin words in the query must ' +
  'appear in the text and the query\'s Chinese fragments must mostly appear in it too (no segmentation, no ' +
  'synonyms, no semantic search — paraphrase and English queries over Chinese text will not match). Results are ' +
  'ordered by match strength, then newest first. Returns short candidates only: id, a snippet, when it happened, ' +
  'an optional validity hint, and whether a later memory already replaced it. Never returns full text — call ' +
  'get_memory with one id to read it completely. Memories with an unknown occurredAt (null) are not matched by a ' +
  'time window. This is a different store from search_memory (World findings for the current project).'

const GET_DESCRIPTION =
  'Read one of your long-term memories in full by memoryId, including the memory it replaces (supersedes) and the ' +
  'memory that replaced it (supersededBy), if any. Use search_memories first to find the id; the id is also ' +
  'returned by write_memory and revise_memory. This reads the long-term memory store, not World findings.'

/** 两个工具共用的"时间可能为 null"写法：省略 `type`，只在 description 说明（dsh-tools 不接受类型数组）。 */
const NULLABLE_TIME = {
  occurredAt: { description: 'Unix epoch milliseconds, or null when unknown.' },
  validFrom: { description: 'Unix epoch milliseconds, or null.' },
  validTo: { description: 'Unix epoch milliseconds, or null (unknown, not "forever").' },
  validHint: { description: 'Free-form note about when it was true, or null.' },
}

/**
 * 注册两个发现工具。
 *
 * 与 `installMemoryTools` / `installMemoryWriteTools` 并列，拿的是 `MemoryStore`。注册走
 * `ctx.tools.register`，回收由调用者的 fiber 负责（`ctx.effect`）——"卸载后工具消失"不需要
 * 手写注销，和另外两组工具同一机制。
 */
export function installMemoryRecallTools(ctx, store) {
  ctx.tools.register({
    name: 'search_memories',
    description: SEARCH_DESCRIPTION,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: {
          type: 'string',
          description:
            'What to look for in the memory text. A close phrase works best; Latin words and Chinese ' +
            'characters from the text all help. Required.',
        },
        since: {
          type: 'number',
          description: 'Unix epoch MILLISECONDS; keep memories whose occurredAt is at or after it.',
        },
        until: {
          type: 'number',
          description: 'Unix epoch MILLISECONDS; keep memories whose occurredAt is at or before it.',
        },
        headOnly: { type: 'boolean', description: 'When true, skip memories that a later memory already revised.' },
        limit: { type: 'number', description: 'Maximum candidates (1-20, default 10). A cap, not a promise.' },
        nextOffset: {
          type: 'number',
          description: 'Skip this many matches, to browse further in the same query.',
        },
      },
      required: ['query'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          results: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                memoryId: { type: 'string' },
                snippet: { type: 'string' },
                occurredAt: NULLABLE_TIME.occurredAt,
                validHint: NULLABLE_TIME.validHint,
                supersededBy: { description: 'memoryId of the memory that revised this one, or null.' },
              },
              required: ['memoryId', 'snippet', 'occurredAt', 'validHint', 'supersededBy'],
            },
          },
          nextOffset: {
            type: 'number',
            description: 'Pass this back to continue browsing; only present when more matches may exist.',
          },
        },
        required: ['results'],
      },
      render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    // 只读、同步：与 `record_finding` 同风格，execute 直接 return 对象，不包队列。
    execute(args) {
      const input = normalizeSearchInput(args)
      const records = store.all()
      const supersededBy = indexSupersedes(records)
      const matched = matchMemories(records, input, supersededBy)
      const page = matched.slice(input.nextOffset, input.nextOffset + input.limit)
      const results = page.map((record) => presentCandidate(record, supersededBy))
      const consumed = input.nextOffset + results.length
      // 只在"还有更多"时给这个键（不是给 null）：模型据此决定要不要继续翻页。
      return consumed < matched.length ? { results, nextOffset: consumed } : { results }
    },
  })

  ctx.tools.register({
    name: 'get_memory',
    description: GET_DESCRIPTION,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        memoryId: { type: 'string', description: 'The memory id, e.g. "m-3f2a…-…".' },
      },
      required: ['memoryId'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          memoryId: { type: 'string' },
          text: { type: 'string' },
          occurredAt: NULLABLE_TIME.occurredAt,
          recordedAt: { type: 'number' },
          validFrom: NULLABLE_TIME.validFrom,
          validTo: NULLABLE_TIME.validTo,
          validHint: { description: 'Free-form note, or null.' },
          source: { description: '{kind, ref} — where this memory came from; ref may be null.' },
          supersedes: { description: 'memoryId this one replaces, or null.' },
          seq: { type: 'number' },
          supersededBy: {
            description: 'memoryId that replaced this one, or null when this is the current version.',
          },
        },
        required: [
          'memoryId', 'text', 'occurredAt', 'recordedAt', 'validFrom', 'validTo',
          'validHint', 'source', 'supersedes', 'seq', 'supersededBy',
        ],
      },
      render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute(args) {
      const record = assertKnownMemory(store, args === null || typeof args !== 'object' ? undefined : args.memoryId)
      return presentMemory(record, indexSupersedes(store.all()))
    },
  })
}
