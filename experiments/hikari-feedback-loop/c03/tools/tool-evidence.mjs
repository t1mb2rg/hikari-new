/**
 * C-03 tool-evidence — pure, testable pairing of tool/call and tool/result.
 *
 * The C-02 readscope defect: it recorded every `tool/call` as "已检查",
 * regardless of whether the matching `tool/result` succeeded, was refused,
 * or never arrived. C-03 replaces that with callId-paired evidence:
 *
 *   tool/call    data = { turn, step, callId, name, arguments }   (arguments = JSON string)
 *   tool/result  data = { turn, step, message: { toolCallId, content, isError } }
 *
 * Only a `success` pair may count as "this range was actually inspected".
 * Everything else is explicitly classified, never silently promoted.
 */

export const RESULT_SUCCESS = 'success'
export const RESULT_DENIED = 'denied'
export const RESULT_ERROR = 'error'
export const RESULT_PENDING = 'pending'
export const RESULT_UNKNOWN = 'unknown'

/** Messages emitted by the scoped-fs tool layer when a read is refused. */
const DENIED_MARKERS = ['outside the authorized directory', 'scoped-fs:']

/**
 * @typedef {{ seq: number, callId: string | undefined, name: string, turn: number | undefined, step: number | undefined, rawArguments: unknown, args: unknown }} ToolCall
 * @typedef {{ seq: number, callId: string | undefined, isError: boolean | undefined, content: unknown[], text: string, turn: number | undefined, step: number | undefined }} ToolResult
 */

/**
 * @param {unknown} event
 * @returns {ToolCall | undefined}
 */
export function parseCall(event) {
  if (event?.type !== 'tool/call') return undefined
  const data = event.data ?? {}
  const raw = data.arguments ?? data.input ?? data.args
  let args
  if (typeof raw === 'string') {
    try {
      args = JSON.parse(raw)
    } catch {
      args = undefined
    }
  } else {
    args = raw
  }
  return {
    seq: event.seq,
    callId: typeof data.callId === 'string' ? data.callId : undefined,
    name: typeof data.name === 'string' ? data.name : '(unknown)',
    turn: data.turn,
    step: data.step,
    rawArguments: raw,
    args,
  }
}

/**
 * @param {unknown} event
 * @returns {ToolResult | undefined}
 */
export function parseResult(event) {
  if (event?.type !== 'tool/result') return undefined
  const data = event.data ?? {}
  const message = data.message ?? {}
  const content = Array.isArray(message.content) ? message.content : []
  const text = content
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .filter((piece) => piece.length > 0)
    .join('\n')
  return {
    seq: event.seq,
    callId: typeof message.toolCallId === 'string' ? message.toolCallId : undefined,
    isError: message.isError === true,
    content,
    text,
    turn: data.turn,
    step: data.step,
  }
}

/**
 * Pair tool/call with tool/result strictly by callId.
 *
 * A result whose callId has no matching call is reported as `orphanResult`
 * instead of being attached to the nearest call.
 *
 * @param {readonly unknown[]} events
 */
export function pairToolEvents(events) {
  /** @type {Map<string, ToolCall>} */
  const calls = new Map()
  /** @type {ToolResult[]} */
  const results = []
  /** @type {ToolResult[]} */
  const orphanResults = []
  let callCounter = 0

  for (const event of events) {
    const call = parseCall(event)
    if (call !== undefined) {
      callCounter += 1
      const key = call.callId ?? `__missing_callId_${callCounter}`
      calls.set(key, call)
      continue
    }
    const result = parseResult(event)
    if (result !== undefined) results.push(result)
  }

  /** @type {{ call: ToolCall, result: ToolResult | undefined, status: string }[]} */
  const pairs = []
  const matched = new Set()
  for (const [key, call] of calls) {
    const result = results.find((candidate) => candidate.callId === key)
    if (result === undefined) {
      pairs.push({ call, result: undefined, status: RESULT_PENDING })
      continue
    }
    matched.add(result)
    pairs.push({ call, result, status: classify(call, result) })
  }
  for (const result of results) {
    if (!matched.has(result)) orphanResults.push(result)
  }
  return { pairs, orphanResults }
}

/**
 * Classify one completed pair.
 * @param {ToolCall} call
 * @param {ToolResult} result
 */
export function classify(call, result) {
  if (result.isError !== true) return RESULT_SUCCESS
  const text = result.text
  if (DENIED_MARKERS.some((marker) => text.includes(marker))) return RESULT_DENIED
  if (result.content.length === 0) return RESULT_UNKNOWN
  return RESULT_ERROR
}

/**
 * Extract the requested read range from a call's parsed arguments.
 * @param {ToolCall} call
 * @returns {{ path: string, offset: number, limit: number | undefined } | { kind: 'unknown', reason: string }}
 */
export function readRangeOf(call) {
  if (call.name !== 'read') return { kind: 'unknown', reason: `tool "${call.name}" is not read` }
  const args = call.args
  if (args === null || typeof args !== 'object') {
    return { kind: 'unknown', reason: 'arguments did not parse as an object' }
  }
  const path = args.file_path ?? args.path
  if (typeof path !== 'string' || path.length === 0) {
    return { kind: 'unknown', reason: 'arguments carry no file_path/path' }
  }
  const offset = Number.isSafeInteger(args.offset) && args.offset >= 0 ? args.offset : 0
  const limit = Number.isSafeInteger(args.limit) && args.limit > 0 ? args.limit : undefined
  return { path, offset, limit }
}

/**
 * Cross-check a successful read result against its requested range.
 *
 * The scoped-fs `read` tool renders `"<lineNo>: <text>"` per line, so a
 * successful result must start at `offset + 1` and never exceed `limit`.
 * A mismatch does not change the pair status; it is reported as
 * `matchesRequest: false` together with the observed range.
 *
 * @param {ToolCall} call
 * @param {{ status: string, result?: ToolResult }} pair
 */
export function observedRangeOf(pair) {
  const range = readRangeOf(pair.call)
  if ('kind' in range) return { kind: 'unknown', reason: range.reason, pair }
  if (pair.status !== RESULT_SUCCESS || pair.result === undefined) {
    return { kind: 'not-inspected', status: pair.status, ...range }
  }
  const lines = pair.result.text.split('\n').filter((line) => line.length > 0)
  const numbers = lines
    .map((line) => {
      const match = /^(\d+):/.exec(line)
      return match === null ? undefined : Number(match[1])
    })
    .filter((value) => value !== undefined)
  const firstLineNo = numbers.length > 0 ? numbers[0] : undefined
  const lastLineNo = numbers.length > 0 ? numbers[numbers.length - 1] : undefined
  const expectedFirst = range.offset + 1
  const limitOk = range.limit === undefined || lines.length <= range.limit
  const startOk = firstLineNo === undefined ? false : firstLineNo === expectedFirst
  const contiguous = numbers.every((value, index) => index === 0 || value === numbers[index - 1] + 1)
  return {
    kind: 'inspected',
    ...range,
    lines: lines.length,
    firstLineNo,
    lastLineNo,
    matchesRequest: startOk && limitOk && contiguous,
    startOk,
    limitOk,
    contiguous,
  }
}

/**
 * Resolve the evidence a Finding record points at.
 *
 * Strict rule: a Finding's evidence is only "resolved" when a tool/result
 * pair exists with the exact callId (or the exact recorded seq). There is no
 * fallback to "the most recent successful call" — when the pointer is
 * ambiguous the answer is `unknown`.
 *
 * @param {{ kind?: string, seq?: number, callId?: string }[]} evidence
 * @param {readonly { call: ToolCall, result?: ToolResult, status: string }[]} pairs
 */
export function resolveFindingEvidence(evidence, pairs) {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    return [{ kind: 'unknown', reason: 'finding carries no evidence entries' }]
  }
  return evidence.map((entry) => {
    const byCall = entry.callId === undefined ? undefined : pairs.find((pair) => pair.call.callId === entry.callId)
    const bySeq = entry.seq === undefined ? undefined : pairs.find((pair) => pair.call.seq === entry.seq || pair.result?.seq === entry.seq)
    const pair = byCall ?? bySeq
    if (pair === undefined) {
      return { kind: 'unknown', reason: `no tool/result pair for seq=${entry.seq ?? '?'} callId=${entry.callId ?? '?'}`, entry }
    }
    if (pair.status !== RESULT_SUCCESS) {
      return { kind: 'invalid', status: pair.status, reason: 'the referenced tool call did not succeed', entry }
    }
    return {
      kind: 'resolved',
      seq: pair.call.seq,
      callId: pair.call.callId,
      tool: pair.call.name,
      observed: observedRangeOf(pair),
    }
  })
}

/**
 * Project paired events into the neutral "what was actually inspected" digest.
 * Only successful `read` pairs with a verifiable range are included.
 * Refused/failed/pending reads are reported separately, never merged in.
 *
 * @param {readonly { call: ToolCall, result?: ToolResult, status: string }[]} pairs
 * @param {{ limit?: number }} [options]
 */
export function inspectedDigest(pairs, options = {}) {
  const max = options.limit ?? 12
  const inspected = []
  const notInspected = []
  for (const pair of pairs) {
    const observed = observedRangeOf(pair)
    if (observed.kind === 'inspected') {
      inspected.push(observed)
    } else if (observed.kind === 'not-inspected') {
      notInspected.push({ ...observed, tool: pair.call.name })
    }
  }
  return {
    inspected: inspected.slice(-max).reverse(),
    notInspected: notInspected.slice(-max).reverse(),
  }
}
