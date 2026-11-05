// M2-e：被拒写入的留痕。
//
// 它**不是记忆记录**：不进 `memory.jsonl`、没有 `memoryId`/`seq`、不参与检索，
// `search_memories` 与 `get_memory` 都读不到它。它只是一份运行诊断，回答一个问题：
// 这次写入为什么没成、模型当时想写什么形状。
//
// 两条硬约束（对应冻结边界 §3）：
// 1. 留痕失败**不得改变**调用者看到的错误——异常必须原样抛出，留痕只是旁路。
// 2. 并发追加不得交错——同一进程内的写入走同一个私有队列（与 `store.append` 同款理由）。
//
// 第三条是隐私边界：只记正文摘要（前 120 个字符，压平空白），不记整段正文。
import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'

/** 与 `memory.jsonl` 同目录的独立文件；名字带 `memory.` 前缀，便于和记忆本体一起搬走。 */
export const REJECTIONS_FILE = 'memory.rejections.jsonl'

/** 摘要长度（UTF-16 码元），与检索 snippet 的 120 同口径。 */
export const EXCERPT_CHARS = 120

let tail = Promise.resolve()

function excerptOf(text) {
  if (typeof text !== 'string') return null
  const flat = text.replace(/\s+/gu, ' ').trim()
  if (flat === '') return null
  return flat.length <= EXCERPT_CHARS ? flat : `${flat.slice(0, EXCERPT_CHARS)}…`
}

/** 错误消息的前缀就是错误码（`MEMORY_TEXT_EMPTY: text is empty…`）。 */
function codeOf(error) {
  const message = typeof error?.message === 'string' ? error.message : ''
  const matched = /^([A-Z][A-Z0-9_]+):/.exec(message)
  return matched ? matched[1] : 'MEMORY_UNKNOWN_ERROR'
}

/**
 * 把一次被拒的写入整理成一行记录。
 *
 * 字段刻意少：时间（工程给）、工具名、错误码、模型给的键、正文字数、摘要，
 * 修订再加目标 `memoryId`。不记 `store` 路径，也不记调用栈——那是日志的事。
 */
export function describeRejection(tool, args, error) {
  const input = args !== null && typeof args === 'object' ? args : {}
  const keys = Object.keys(input).sort()
  const text = typeof input.text === 'string' ? input.text : null
  const memoryId = typeof input.memoryId === 'string' ? input.memoryId : null
  return {
    at: Date.now(),
    tool,
    code: codeOf(error),
    keys,
    chars: text === null ? null : text.length,
    memoryId,
    excerpt: excerptOf(text),
  }
}

/**
 * 追加一行拒绝记录。调用者必须自己吞掉这里的失败（见 `writing.js` 的 `logged`）。
 *
 * 返回值是该次追加的 promise：测试要等它落盘，生产路径只在 `await` 后吞错。
 */
export function logRejection(dir, entry) {
  const line = `${JSON.stringify(entry)}\n`
  const run = tail.then(() => appendFile(join(dir, REJECTIONS_FILE), line, 'utf8'))
  tail = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}
