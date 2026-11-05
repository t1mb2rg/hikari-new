/**
 * M2-f：`memory_status`——让模型说得清自己记得什么。
 *
 * 为什么需要它：`search_memories` 能回答"关于 X 我记得什么"，但回答不了"我一共记了几条、
 * 最近记了什么、刚拒了什么、有多少条连发生时间都不知道"。这些恰恰是模型要如实转述给用户
 * 的东西；没有它，模型只能现搜现猜，说出来的话与存储对不上。
 *
 * 边界：
 * - **只读**：只调 `store.all()` 与读 `memory.rejections.jsonl`，不写、不 append、不碰 meta；
 * - **不是第二条提问路径**：它不做匹配，只给汇总与最近若干条；要找内容仍然用 `search_memories`；
 * - **数字现算**：每次调用都从记录重算，不缓存、不落盘，视图（`hikari-native/viewer/render.mjs`）
 *   与它给的数字必须一致，因为两边的算法是同一套定义。
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const REJECTIONS_FILE = 'memory.rejections.jsonl'
const DEFAULT_RECENT = 5
const MAX_RECENT = 20
const SNIPPET_CHARS = 80

const STATUS_DESCRIPTION =
  'Summarize what you currently remember, without searching: how many memories exist, which are ' +
  'current heads and which were revised, how many have no known occurredAt, where they came from, ' +
  'the most recent few, and how many writes were rejected. Use it to answer "what do you remember" ' +
  'honestly, or before deciding whether something is worth writing. Read-only; it does not search.'

function presentRecent(record, supersededBy) {
  const text = record.text.replace(/\s+/gu, ' ').trim()
  const snippet = text.length > SNIPPET_CHARS ? `${text.slice(0, SNIPPET_CHARS)}…` : text
  return {
    memoryId: record.memoryId,
    seq: record.seq,
    recordedAt: record.recordedAt,
    occurredAt: record.occurredAt,
    supersededBy: supersededBy.get(record.memoryId) ?? null,
    snippet,
  }
}

/**
 * 汇总。`rejections` 是已解析的拒绝样本（可能为空数组），`unreadableLines` 是读不出来的行数——
 * 坏行不抛错，但要在数字里看得见（"它不知道的"也是状态的一部分）。
 */
export function summarize(records, rejections, { recent = DEFAULT_RECENT, unreadableLines = 0 } = {}) {
  const ordered = [...records].sort((a, b) => a.seq - b.seq)
  const supersededBy = new Map()
  for (const record of ordered) {
    if (typeof record.supersedes === 'string') supersededBy.set(record.supersedes, record.memoryId)
  }

  const sources = {}
  let unknownWhen = 0
  for (const record of ordered) {
    if (record.occurredAt === null || record.occurredAt === undefined) unknownWhen += 1
    const kind = record.source && typeof record.source.kind === 'string' ? record.source.kind : 'unknown'
    sources[kind] = (sources[kind] ?? 0) + 1
  }

  const byCode = {}
  for (const entry of rejections) byCode[entry.code] = (byCode[entry.code] ?? 0) + 1
  const lastRejection = rejections.length > 0 ? rejections[rejections.length - 1] : null

  const rejectionSummary = { total: rejections.length, byCode, unreadableLines }
  // 最后一次被拒写成平铺的三个键、没有就整组省略：dsh-tools 的表达力有限，不能声明
  // "对象或 null"，也不能留空子 schema（会在真实运行时被 JsonSchemaError 拒掉）。
  if (lastRejection !== null) {
    rejectionSummary.lastAt = lastRejection.at
    rejectionSummary.lastTool = lastRejection.tool
    rejectionSummary.lastCode = lastRejection.code
  }

  return {
    total: ordered.length,
    lastSeq: ordered.length === 0 ? 0 : ordered[ordered.length - 1].seq,
    heads: ordered.filter((record) => !supersededBy.has(record.memoryId)).length,
    revised: ordered.filter((record) => typeof record.supersedes === 'string').length,
    unknownOccurredAt: unknownWhen,
    sources,
    recent: ordered.slice(-recent).reverse().map((record) => presentRecent(record, supersededBy)),
    rejections: rejectionSummary,
  }
}

async function readRejections(dir) {
  let raw
  try {
    raw = await readFile(join(dir, REJECTIONS_FILE), 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return { entries: [], unreadableLines: 0 }
    // 读不了就报"读不了"，而不是假装没有拒绝样本。
    return { entries: [], unreadableLines: -1 }
  }
  const entries = []
  let unreadableLines = 0
  for (const line of raw.split('\n')) {
    const text = line.trim()
    if (text.length === 0) continue
    try {
      entries.push(JSON.parse(text))
    } catch {
      unreadableLines += 1
    }
  }
  return { entries, unreadableLines }
}

export function normalizeStatusInput(args) {
  const raw = args === null || typeof args !== 'object' ? {} : args
  const requested = raw.recent
  const recent =
    typeof requested === 'number' && Number.isInteger(requested) && requested >= 1
      ? Math.min(requested, MAX_RECENT)
      : DEFAULT_RECENT
  return { recent }
}

/**
 * 与 `installMemoryTools` / `installMemoryWriteTools` / `installMemoryRecallTools` 并列。
 * 回收同样交给调用者的 fiber（`ctx.effect`），不手写注销。
 */
export function installMemoryStatusTool(ctx, store) {
  ctx.tools.register({
    name: 'memory_status',
    description: STATUS_DESCRIPTION,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        recent: {
          type: 'number',
          description: `How many recent memories to list (1-${MAX_RECENT}, default ${DEFAULT_RECENT}).`,
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          total: { type: 'number' },
          lastSeq: { type: 'number' },
          heads: { type: 'number', description: 'Memories that no later memory has revised.' },
          revised: { type: 'number' },
          unknownOccurredAt: { type: 'number', description: 'Memories whose occurredAt is null: the time is unknown.' },
          sources: {
            type: 'object',
            description: 'Count per source.kind, e.g. {"file": 2}.',
            additionalProperties: true,
          },
          recent: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                memoryId: { type: 'string' },
                seq: { type: 'number' },
                recordedAt: { type: 'number' },
                occurredAt: { description: 'Unix epoch ms, or null when the time is unknown.' },
                supersededBy: { description: 'memoryId of the memory that revised this one, or null.' },
                snippet: { type: 'string' },
              },
              required: ['memoryId', 'seq', 'recordedAt', 'occurredAt', 'supersededBy', 'snippet'],
            },
          },
          rejections: {
            type: 'object',
            additionalProperties: false,
            properties: {
              total: { type: 'number' },
              byCode: {
                type: 'object',
                description: 'Count per error code, e.g. {"MEMORY_TEXT_EMPTY": 1}.',
                additionalProperties: true,
              },
              unreadableLines: {
                type: 'number',
                description: 'Lines that could not be parsed; -1 when the file exists but cannot be read.',
              },
              lastAt: { type: 'number', description: 'Unix epoch ms of the most recent rejected write; omitted when there is none.' },
              lastTool: { type: 'string', description: 'Tool of the most recent rejected write.' },
              lastCode: { type: 'string', description: 'Error code of the most recent rejected write.' },
            },
            required: ['total', 'byCode', 'unreadableLines'],
          },
        },
        required: ['total', 'lastSeq', 'heads', 'revised', 'unknownOccurredAt', 'sources', 'recent', 'rejections'],
      },
      render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    // 只读、异步（要读一次拒绝文件）；与两个发现工具同风格，不包队列、不写盘。
    async execute(args) {
      const input = normalizeStatusInput(args)
      const { entries, unreadableLines } = await readRejections(store.dir)
      return summarize(store.all(), entries, { recent: input.recent, unreadableLines })
    },
  })
}
