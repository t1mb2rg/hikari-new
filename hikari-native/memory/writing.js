/**
 * Hikari Native — Memory 的两个写入工具（M2-b）。
 *
 * `write_memory` 写一条新的长期记忆；`revise_memory` 不改旧行，而是追加一条新记录并用
 * `supersedes` 指向它。契约冻结在 `docs/architecture/m2b-memory-writing-interface-freeze.md`：
 * 本文件里的工具名、参数、返回键、错误码前缀一旦落地即为公开契约，改它们要重开审阅。
 *
 * 边界：
 *   - 只依赖 `MemoryStore` 实例（append / all / get / size / lastSeq），**不依赖** World 的
 *     `hikariWorldFindings` service——写入不需要读 findings，读记忆也不是这一片的事。
 *   - 不新增 store 导出、不改 `append` 白名单、不改 `MEMORY_FIELDS`、不新增持久化。
 *   - 工程字段（memoryId / recordedAt / seq）一律由存储层生成（`store.mjs:482-493`）；
 *     工具层连"顺手补一个"都不做，传进去只会被白名单抛 `INVALID_INPUT`。
 *   - 不提供删除 / 覆盖 / 批量修订 / 幂等键 / 去重 / 自动分类 / 自动过期。
 *
 * 两个已知局限（交付时必须留在文档与 commit message 里，不许省）：
 *   1. 模型没有时钟（`docs/architecture/cognition-action-loop-v0-boundary-review.md:68`），
 *      所以 `occurredAt` 等在它不知道时会大量为 `null`——本模块不替它猜，也不回落到 `recordedAt`。
 *   2. 模型无法回读 memoryId：`search_memory` / `read_memory` 只查 World findings。修订能力
 *      实际只在同一上下文内可用，跨 session 接续要等 M2-c。
 *
 * M2-e 追加的一件旁路：被拒绝的写入会往同目录的 `memory.rejections.jsonl` 记一行诊断
 * （见 `rejections.js`）。它不改变校验、不改变错误、不进入检索——只是让"记忆为什么缺"
 * 事后可回答。留痕自身失败时一律吞掉，绝不让调用者看到另一个错误。
 */

import { logRejection, describeRejection } from './rejections.js'

/** `text` 的上限。理由见架构审阅 §2.7：既是输入规模约束，也不是存储原子性的证明。 */
export const MAX_TEXT = 4000
/** `validHint` 的上限：一句自然语言猜测的量级。 */
export const MAX_HINT = 400
/** `source.ref` 的上限。 */
export const MAX_REF = 512

/**
 * 工具层接受的 `source.kind`。
 *
 * **不含 `unknown`**：那是"没有来源"的工程缺省值（`store.mjs:490` 在模型省略 source 时填），
 * 模型显式声明 `unknown` 等于把"我不知道"包装成一条来源声明，没有信息量。
 * schema 的 `enum` 也不含它——两道门都在，任一道单独失效还剩另一道。
 */
export const SOURCE_KINDS = ['finding', 'session', 'file', 'conversation', 'inference']

/** 与 `world/findings.js:68` 同一个规则；记忆引用 finding 时必须指向一个合法 finding id。 */
const FINDING_ID_PATTERN = /^f-[a-z0-9][a-z0-9._-]{0,63}$/u

/**
 * 统一的失败形态：`throw new Error('<CODE>: <一句话>')`。
 *
 * 用普通 `Error` 而不是自定义类，与 `findings.js:290`、`:465` 的既有风格一致；消息开头是错误码，
 * 既给人读也给测试认。每个消息都要能照做（说清下一步），不能只说"非法"。
 */
function fail(code, message) {
  return new Error(`${code}: ${message}`)
}

/** 时间的展示形式：让模型在错误消息里看到自己给的原值（`'123'` 与 `123.5` 要能分辨）。 */
function present(value) {
  if (typeof value === 'string') return JSON.stringify(value)
  return String(value)
}

/**
 * 把输入折叠成"要么是合法值、要么是 null"的形状。**只做折叠，不做校验**。
 *
 * 三条规则（冻结面 §4）：
 *   - 时间字段：省略 / `null` → `null`；其余原样留给 `assertTimestamps` 判。
 *   - `text`：**不 trim**——缩进与空行可能是刻意的，存进去的是模型写的原文。
 *   - `validHint`：`trim()` 之后为空 → `null`（空白猜测等于没有猜测）。
 *   - `source`：整体省略 → `undefined`（交给 `store.append` 落 `{kind:'unknown',ref:null}`）。
 */
export function normalizeInput(args) {
  const raw = args === null || typeof args !== 'object' ? {} : args
  const hint = typeof raw.validHint === 'string' ? raw.validHint.trim() : raw.validHint
  return {
    text: raw.text,
    occurredAt: raw.occurredAt === undefined || raw.occurredAt === null ? null : raw.occurredAt,
    validFrom: raw.validFrom === undefined || raw.validFrom === null ? null : raw.validFrom,
    validTo: raw.validTo === undefined || raw.validTo === null ? null : raw.validTo,
    validHint: hint === undefined || hint === null || hint === '' ? null : hint,
    source: raw.source === undefined || raw.source === null ? undefined : raw.source,
  }
}

/** `text`：trim 后非空、原文长度不超过 `MAX_TEXT`。超长一律拒绝，绝不截断。 */
export function assertText(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw fail('MEMORY_TEXT_EMPTY', 'text is empty; write the memory in your own words.')
  }
  if (text.length > MAX_TEXT) {
    throw fail(
      'MEMORY_TEXT_TOO_LONG',
      `${text.length} characters; keep it under ${MAX_TEXT} (nothing was truncated).`,
    )
  }
}

/** `validHint`：按 trim 后长度判；非字符串也是无效提示，不是"没有提示"。 */
export function assertHint(hint) {
  if (hint === null) return
  if (typeof hint !== 'string') {
    throw fail('MEMORY_HINT_TOO_LONG', `validHint must be one short sentence of text (under ${MAX_HINT}).`)
  }
  if (hint.length > MAX_HINT) {
    throw fail(
      'MEMORY_HINT_TOO_LONG',
      `validHint is ${hint.length} characters; keep the guess to one short sentence (under ${MAX_HINT}).`,
    )
  }
}

/**
 * 时间：整数、非负、区间不倒挂、`occurredAt` 不晚于**此刻**。
 *
 * 最后一条是**输入合理性检查，不是记录上的不变量**。磁盘上的 `recordedAt` 由存储层的
 * `#now()` 生成（`store.mjs:486`），而 `#now` 可注入（`store.mjs:224`）；这里用的是调用时刻的
 * 墙钟 `Date.now()`，两者在同一进程里也可能差几毫秒，注入假时钟时能差任意多。所以：
 *   - 它检查的是"模型提交的 occurredAt 是否晚于它此刻提交的墙钟时刻"；
 *   - 它**不能**可靠识别秒与毫秒的混淆：把秒当毫秒解释得到 1970 年（极早），这条检查发现不了；
 *     单位正确性主要依赖工具描述里的约束；
 *   - 它**不**承诺磁盘上 `recordedAt >= occurredAt`，测试里也不要断言那个不等式。
 */
export function assertTimestamps(input) {
  for (const field of ['occurredAt', 'validFrom', 'validTo']) {
    const value = input[field]
    if (value === null) continue
    if (!Number.isInteger(value) || value < 0) {
      throw fail(
        'MEMORY_INVALID_TIME',
        `${field} must be Unix epoch MILLISECONDS, not ${present(value)}. ` +
          'Modern values are typically 13 digits; do not convert seconds to milliseconds by guessing.',
      )
    }
  }
  if (input.validFrom !== null && input.validTo !== null && input.validTo < input.validFrom) {
    throw fail('MEMORY_INVALID_RANGE', `validTo ${input.validTo} is before validFrom ${input.validFrom}.`)
  }
  if (input.occurredAt !== null && input.occurredAt > Date.now()) {
    throw fail(
      'MEMORY_INVALID_TIME_ORDER',
      'occurredAt is after the current time; either the value has a unit problem, or the event has not happened yet.',
    )
  }
}

/**
 * `source` 的跨字段规则（冻结面 §4 的表）。
 *
 * 返回**规范化后的对象**（`ref` 已 trim；`inference` 补 `ref: null`）。必须显式给 `ref`，
 * 因为存储层的 `validateRecord` 要求 `source` 自带 `kind` 与 `ref` 两个键（`store.mjs:134-147`），
 * 缺 `ref` 会被当成"非法记录"而不是"没有引用"。
 */
export function assertSource(source) {
  if (source === undefined) return undefined
  if (source === null || typeof source !== 'object' || Array.isArray(source)) {
    throw fail('MEMORY_INVALID_SOURCE', 'source must be an object like { kind, ref }.')
  }
  for (const key of Object.keys(source)) {
    if (key !== 'kind' && key !== 'ref') {
      throw fail('MEMORY_INVALID_SOURCE', `source has unknown field "${key}"; only kind and ref are allowed.`)
    }
  }
  const kind = source.kind
  if (typeof kind !== 'string' || kind.trim().length === 0) {
    throw fail('MEMORY_INVALID_SOURCE', 'source.kind is required; omit source entirely if there is none.')
  }
  if (!SOURCE_KINDS.includes(kind)) {
    throw fail(
      'MEMORY_INVALID_SOURCE',
      `kind "${kind}" is not one of ${SOURCE_KINDS.join(' / ')}; ` +
        'omit source entirely when you do not know where it came from.',
    )
  }

  const rawRef = source.ref
  if (rawRef !== undefined && rawRef !== null && typeof rawRef !== 'string') {
    throw fail('MEMORY_INVALID_SOURCE', `source.ref must be text, not ${typeof rawRef}.`)
  }
  const ref = typeof rawRef === 'string' ? rawRef.trim() : null

  if (kind === 'inference') {
    if (ref !== null) {
      throw fail(
        'MEMORY_INVALID_SOURCE',
        'kind "inference" takes no ref; there is no direct evidence to point at.',
      )
    }
    return { kind, ref: null }
  }

  if (ref === null || ref.length === 0) {
    throw fail(
      'MEMORY_INVALID_SOURCE',
      `kind "${kind}" needs a ref; ` +
        (kind === 'finding'
          ? 'use the finding id from search_memory, like "f-004".'
          : kind === 'session'
            ? 'use "<sessionId>#<seq>".'
            : kind === 'file'
              ? 'use a path with an optional line, like "hikari-new/hikari-native/world/findings.js:149".'
              : 'use the conversation (session) id.'),
    )
  }
  if (ref.length > MAX_REF) {
    throw fail(
      'MEMORY_INVALID_SOURCE',
      `ref must be 1-${MAX_REF} characters; this one is ${ref.length}.`,
    )
  }
  if (kind === 'finding' && !FINDING_ID_PATTERN.test(ref)) {
    throw fail(
      'MEMORY_INVALID_SOURCE',
      `"${ref}" is not a finding id; finding ids look like "f-004".`,
    )
  }
  return { kind, ref }
}

/** 把校验过的输入转成 `store.append` 的参数：只给 `append` 认识的字段。 */
function toAppendInput(input, extra = {}) {
  const payload = { text: input.text }
  if (input.occurredAt !== null) payload.occurredAt = input.occurredAt
  if (input.validFrom !== null) payload.validFrom = input.validFrom
  if (input.validTo !== null) payload.validTo = input.validTo
  if (input.validHint !== null) payload.validHint = input.validHint
  if (input.source !== undefined) payload.source = input.source
  return { ...payload, ...extra }
}

/**
 * 存储层仍然拒绝时（schema 漂移、只读文件系统、陈旧 schema……）的兜底翻译。
 *
 * 为什么保留原始 code 与 message：工具层的校验已经覆盖了模型的错误输入，走到这里说明是
 * 工程侧的问题，把 `INVALID_RECORD` / `STORE_CLOSED` 之类的原始信息丢掉，排查时就没有线索了。
 */
function storeRejected(error) {
  const code = error && error.code ? String(error.code) : 'UNKNOWN'
  const message = error && error.message ? String(error.message) : String(error)
  return fail('MEMORY_STORE_REJECTED', `store said ${code}: ${message}`)
}

/** 一次写入的返回：四个键，够模型确认写入并接续下一次调用。 */
function presentWrite(record) {
  return {
    memoryId: record.memoryId,
    seq: record.seq,
    recordedAt: record.recordedAt,
    chars: typeof record.text === 'string' ? record.text.length : 0,
  }
}

/**
 * 修订目标的三道拒绝（冻结面 §6 第 1、2 条）。
 *
 * 必须在**同一个串行队列**里与随后的 `append` 一起执行：分开判、分开写，两次并发修订会各自
 * 认定"目标没有后继"，然后写出两条都指向同一旧记录的记录，形成分叉。
 */
export function assertReviseTarget(store, memoryId) {
  if (typeof memoryId !== 'string' || memoryId.trim().length === 0) {
    throw fail('MEMORY_SUPERSEDES_UNKNOWN', 'memoryId is required; use the memoryId returned when it was written.')
  }
  const id = memoryId.trim()
  if (id.startsWith('f-')) {
    throw fail(
      'MEMORY_SUPERSEDES_NOT_MEMORY',
      `"${id}" is a World finding, not a memory; memory ids start with "m-".`,
    )
  }
  if (store.get(id) === undefined) {
    throw fail(
      'MEMORY_SUPERSEDES_UNKNOWN',
      `no memory "${id}"; use the memoryId returned when it was written.`,
    )
  }
  // 没有反向索引（缺口 G-4），所以这里全表扫一遍。写入频率是"每天几条"的量级，
  // 为此新增 store 字段或索引不划算——真要索引，等 M2-c 的检索需求一起做。
  const successor = store.all().find((record) => record.supersedes === id)
  if (successor !== undefined) {
    // 消息里必须带后继 id：模型没有检索工具能找回 memoryId，错误消息是它唯一的线索。
    throw fail(
      'MEMORY_SUPERSEDES_NOT_HEAD',
      `"${id}" was already revised by "${successor.memoryId}"; revise "${successor.memoryId}" instead.`,
    )
  }
  return id
}

/**
 * 模块私有的串行队列。
 *
 * 为什么不用 `store.append` 自己的队列：那个队列只串行化**单次写入**，覆盖不了
 * "判链头 → 写入"这个组合（`store.mjs:458-466`）。为什么不用全局变量：队列属于一次
 * `installMemoryWriteTools` 的调用，插件卸载重装后应当是干净的。
 *
 * **局限（不许省略）**：只覆盖单进程。两个进程共写同一个 store 仍然没有文件锁
 * （`docs/development/m2a-memory-store.md` 风险清单第 1 条），跨进程并发修订仍可能分叉。
 */
function createQueue() {
  let tail = Promise.resolve()
  return function enqueue(task) {
    const run = tail.then(task, task)
    tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}

const WRITE_DESCRIPTION =
  'Save one long-term memory that should survive this session and other projects. Use it when ' +
  'something is worth remembering later, not for ordinary conversation state. You write the text; ' +
  'the store assigns the id, the recorded time and the sequence number. Omit any time you do not ' +
  'actually know: absent means unknown, never "now" and never a guess. The record never enters the ' +
  'chat surface.'

const REVISE_DESCRIPTION =
  'Revise one existing memory by appending a new record that supersedes it. The old record is kept ' +
  'forever; nothing is edited or deleted. You must pass the exact memoryId you want to revise, and ' +
  'that memory must be the current version (it must not already have been revised). Pass the full ' +
  'new text — revise_memory never reuses the old text. Source is not inherited: pass it again if the ' +
  'new version still rests on the same evidence.'

const TIME_FIELD_DESCRIPTIONS = {
  occurredAt:
    'When this happened, as Unix epoch MILLISECONDS (e.g. 1762345678901). Modern timestamps are ' +
    'typically 13 digits; older ones may have fewer. Do not convert seconds to milliseconds by ' +
    'guessing. Omit when you do not know the actual time — do not pass the current time.',
  validFrom:
    'When the stated condition starts to hold, Unix epoch MILLISECONDS. Omit when unknown; ' +
    'omit is not "always".',
  validTo:
    'When the stated condition stops holding, Unix epoch MILLISECONDS. Omit when unknown; ' +
    'omit is not "expires immediately".',
}

/** 两个工具共用的 `source` 参数定义（`required` 只有 `kind`：dsh-tools 不能声明 nullable）。 */
const SOURCE_PARAMETER = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: {
      type: 'string',
      enum: SOURCE_KINDS,
      description:
        'What this memory came from. "finding" = a World finding, "session" = a point in a ' +
        'past conversation, "file" = a file in the repo, "conversation" = a whole earlier ' +
        'conversation, "inference" = derived from memories you already have.',
    },
    ref: {
      type: 'string',
      description:
        'The pointer for that kind: a finding id like "f-004", "<sessionId>#<seq>" for a ' +
        'session, "path/to/file.js:149" for a file, a session id for a conversation. ' +
        'Omit for "inference" (there is no direct evidence). Up to 512 characters.',
    },
  },
  required: ['kind'],
}

/**
 * 注册两个写入工具。
 *
 * 与 `installMemoryTools` 并列：它拿 World 的只读 service，这里拿 `MemoryStore`。注册走
 * `ctx.tools.register`，回收由调用者的 fiber 负责（`ctx.effect`），所以"卸载后工具消失"
 * 不需要手写注销——和两个检索工具同一机制。
 */
export function installMemoryWriteTools(ctx, store) {
  const enqueue = createQueue()

  /**
   * 把"被拒"记一行再原样抛出。
   *
   * 只用 `store.dir`（`store.mjs` 的公开 getter），不碰 store 内部；留痕失败吞掉，
   * 保证调用者拿到的永远是最初那条 `MEMORY_*` 错误。
   */
  const logged = (tool, run) =>
    async function executeLogged(args) {
      try {
        return await run(args)
      } catch (error) {
        try {
          await logRejection(store.dir, describeRejection(tool, args, error))
        } catch {
          // 旁路失败不影响写入语义。
        }
        throw error
      }
    }

  ctx.tools.register({
    name: 'write_memory',
    description: WRITE_DESCRIPTION,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: {
          type: 'string',
          description:
            'The memory itself, in your own words. Up to 4000 characters; longer text is rejected, ' +
            'never truncated.',
        },
        occurredAt: { type: 'number', description: TIME_FIELD_DESCRIPTIONS.occurredAt },
        validFrom: { type: 'number', description: TIME_FIELD_DESCRIPTIONS.validFrom },
        validTo: { type: 'number', description: TIME_FIELD_DESCRIPTIONS.validTo },
        validHint: {
          type: 'string',
          description:
            'Your own guess about how long this stays true, in natural language ' +
            '(e.g. "one week unless the CI config changes"). Omit when you have no guess.',
        },
        source: SOURCE_PARAMETER,
      },
      required: ['text'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          memoryId: { type: 'string' },
          seq: { type: 'number' },
          recordedAt: { type: 'number' },
          chars: { type: 'number' },
        },
        required: ['memoryId', 'seq', 'recordedAt', 'chars'],
      },
      render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute: logged('write_memory', async (args) => {
      const input = normalizeInput(args)
      assertText(input.text)
      assertHint(input.validHint)
      assertTimestamps(input)
      const source = assertSource(input.source)
      let record
      try {
        record = await store.append(toAppendInput({ ...input, source }))
      } catch (error) {
        throw storeRejected(error)
      }
      return presentWrite(record)
    }),
  })

  ctx.tools.register({
    name: 'revise_memory',
    description: REVISE_DESCRIPTION,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        memoryId: {
          type: 'string',
          description:
            'The memory to revise, like "m-3f2a…". Must be the current version; a memory that was ' +
            'already superseded is rejected.',
        },
        text: {
          type: 'string',
          description: 'Same as write_memory: the full new text, up to 4000 characters.',
        },
        occurredAt: { type: 'number', description: 'Same as write_memory (Unix epoch milliseconds; omit when unknown).' },
        validFrom: { type: 'number', description: 'Same as write_memory.' },
        validTo: { type: 'number', description: 'Same as write_memory.' },
        validHint: { type: 'string', description: 'Same as write_memory.' },
        source: SOURCE_PARAMETER,
      },
      required: ['memoryId', 'text'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          memoryId: { type: 'string' },
          seq: { type: 'number' },
          recordedAt: { type: 'number' },
          chars: { type: 'number' },
          supersedes: { type: 'string' },
        },
        required: ['memoryId', 'seq', 'recordedAt', 'chars', 'supersedes'],
      },
      render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    // 判链头与写入必须在同一个队列回调里完成，否则两个并发修订会各自看到"目标没有后继"。
    execute: logged('revise_memory', async (args) => {
      return enqueue(async () => {
        const input = normalizeInput(args)
        assertText(input.text)
        assertHint(input.validHint)
        assertTimestamps(input)
        const source = assertSource(input.source)
        // memoryId 是"要改哪条"，不是新记录的字段，所以不参与 normalizeInput（那是写入字段的规范化）。
        const target = assertReviseTarget(store, args === null || typeof args !== 'object' ? undefined : args.memoryId)
        let record
        try {
          // supersedes 由工具层从 memoryId 复制：模型没有地方能自己写它。
          record = await store.append(toAppendInput(input, { supersedes: target }))
        } catch (error) {
          throw storeRejected(error)
        }
        return { ...presentWrite(record), supersedes: target }
      })
    }),
  })
}
