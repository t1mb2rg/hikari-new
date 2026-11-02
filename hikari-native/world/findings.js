/**
 * Hikari Native — World findings：第一条认知反馈闭环的 World 面。
 *
 * 职责（设计见 docs/development/hikari-native-feedback-loop-design.md）：
 *   1. 模型通过 `record_finding` 工具写入 `plugin:hikari/finding` 记录；
 *   2. `sessionProjections` 从 Session 日志派生当前认识（lazy fold，重启可恢复）；
 *   3. `systemPrompt.context()` 在每个模型请求注入当前有效发现（per-request，
 *      同一请求只组装一次，容量 3 条 / 1200 字符）。
 *
 * 边界：
 *   - 不新建数据库/长期记忆系统；持久载体就是 Session 日志。
 *   - 模型不能决定 `scope.project`：它由启动时解析出的 git 根填充。
 *   - `tool-evidenced` 只表示「证据存在」，不表示「结论正确」；措辞必须克制。
 */
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const FINDING_RECORD_TYPE = 'plugin:hikari/finding'
export const FINDINGS_PROJECTION_KEY = 'hikari/world.findings'
export const FINDINGS_STATE_VERSION = 1

export const MAX_CONTEXT_FINDINGS = 3
export const MAX_CONTEXT_CHARS = 1200

/** search_memory 的预算：整条返回 800 字符硬上限，单条摘录 120 字符。 */
export const SEARCH_DEFAULT_LIMIT = 4
export const SEARCH_MAX_LIMIT = 20
export const SEARCH_LINE_MAX = 120
export const SEARCH_BUDGET_CHARS = 800

const FINDING_ID_PATTERN = /^f-[a-z0-9][a-z0-9._-]{0,63}$/u
const STATUSES = new Set(['open', 'confirmed', 'refuted', 'resolved'])
const PROVENANCES = new Set(['model-claim', 'tool-evidenced'])
const TRANSITIONS = {
  open: ['confirmed', 'refuted'],
  confirmed: ['resolved', 'refuted'],
  refuted: [],
  resolved: [],
}

function asObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined
}

export function normalizeClaim(claim) {
  return String(claim).trim().replace(/\s+/gu, ' ').slice(0, 300)
}

/**
 * 校验证据引用：seq 必须指向本 Session 日志里真实存在的事件。
 * `tool-result` 的 callId 取 `event.data.message.toolCallId`（与 source.callId 相同）。
 */
export function validateEvidence(session, evidence) {
  if (evidence === undefined) return []
  if (!Array.isArray(evidence)) throw new Error('evidence must be an array')
  const out = []
  for (const item of evidence) {
    const entry = asObject(item)
    if (entry === undefined) throw new Error('evidence entries must be objects')
    const seq = entry.seq
    if (!Number.isInteger(seq) || seq < 0) throw new Error(`evidence seq must be a non-negative integer, got ${String(seq)}`)
    const event = typeof session.eventAt === 'function' ? session.eventAt(seq) : undefined
    if (event === undefined) throw new Error(`evidence seq ${seq} does not exist in this session log`)
    if (entry.kind === 'tool-result') {
      if (event.type !== 'tool/result') throw new Error(`evidence seq ${seq} is "${event.type}", not "tool/result"`)
      const callId = event.data?.message?.toolCallId
      if (typeof entry.callId !== 'string' || entry.callId.length === 0) throw new Error('tool-result evidence requires callId')
      if (callId !== entry.callId) throw new Error(`evidence seq ${seq} toolCallId "${String(callId)}" does not match "${entry.callId}"`)
      out.push({ kind: 'tool-result', seq, callId: entry.callId })
    } else if (entry.kind === 'file') {
      if (typeof entry.path !== 'string' || entry.path.length === 0) throw new Error('file evidence requires path')
      out.push({ kind: 'file', seq, path: entry.path })
    } else {
      throw new Error(`unknown evidence kind "${String(entry.kind)}"`)
    }
  }
  return out
}

/**
 * `tool-evidenced` 需要真实工具结果的 seq/callId，而模型侧看不到 seq。
 * 因此模型只声明「本次判断基于工具结果」，具体引用由插件从同一 Session
 * 日志里取最近一次成功的 `tool/result` 补全——证据仍是真实事件，不是模型
 * 自由文本；找不到就拒绝写入（fail-closed）。
 */
export function latestToolResult(session) {
  if (typeof session?.seq !== 'number' || typeof session.eventAt !== 'function') return undefined
  for (let seq = session.seq - 1; seq >= 0; seq -= 1) {
    const event = session.eventAt(seq)
    if (event === undefined || event.type !== 'tool/result') continue
    if (event.data?.isError === true) continue
    const callId = event.data?.message?.toolCallId
    if (typeof callId !== 'string' || callId.length === 0) continue
    return { kind: 'tool-result', seq, callId }
  }
  return undefined
}

/** 写记录串行化：findingId 分配发生在 append 之前，并发调用不能算出同一个 id。 */
let recordQueue = Promise.resolve()

/** projection apply：只读写侧的完整状态（whole-value），按 findingId 覆盖。 */
export function applyFindingRecord(state, event) {
  if (event === null || typeof event !== 'object') return state
  if (event.type !== FINDING_RECORD_TYPE || event.ignorable !== true) return state
  const data = asObject(event.data)
  if (data === undefined) return state
  if (typeof data.findingId !== 'string' || !FINDING_ID_PATTERN.test(data.findingId)) return state
  if (!STATUSES.has(data.status) || !PROVENANCES.has(data.provenance)) return state
  const scope = asObject(data.scope)
  if (scope === undefined) return state
  const record = {
    findingId: data.findingId,
    scope: { project: String(scope.project ?? ''), sessionId: String(scope.sessionId ?? '') },
    claim: String(data.claim ?? ''),
    status: data.status,
    provenance: data.provenance,
    evidence: Array.isArray(data.evidence) ? data.evidence : [],
    recordedAt: Number.isFinite(data.recordedAt) ? data.recordedAt : event.time,
    seq: event.seq,
  }
  return { ...state, findings: { ...state.findings, [record.findingId]: record } }
}

/**
 * 渲染当前认识。每个请求求值一次；预算 3 条 / 1200 字符。
 * 措辞贯彻「证据存在 ≠ 结论正确」。
 *
 * 可见性提示独立计额（不占 1200 字符预算）：只说明上下文里不止这些有效发现，
 * 不暗示哪些值得读——读不读、读哪条由模型自己判断。
 */
export function renderFindings(findings, { maxFindings = MAX_CONTEXT_FINDINGS, maxChars = MAX_CONTEXT_CHARS } = {}) {
  const current = Object.values(findings ?? {})
    .filter((finding) => finding.status === 'open' || finding.status === 'confirmed')
    .sort((a, b) => b.recordedAt - a.recordedAt)
  const lines = []
  let used = 0
  let shown = 0
  for (const finding of current) {
    if (shown >= maxFindings) break
    const label = finding.status === 'open' ? '此前的假设，尚未验证' : '有工具证据支持，尚未独立验证'
    const line = `- [${finding.findingId} · ${label}] ${finding.claim}`
    if (used + line.length > maxChars) break
    lines.push(line)
    used += line.length
    shown += 1
  }
  const closed = Object.values(findings ?? {}).filter((finding) => finding.status === 'resolved' || finding.status === 'refuted').length
  if (closed > 0) {
    const summary = `- 已闭合 ${closed} 条（不计入当前认识）`
    if (used + summary.length <= maxChars) lines.push(summary)
  }
  const body = lines.length === 0 ? '' : ['Hikari 当前认识（来自本项目的持久发现）：', ...lines].join('\n')
  const hidden = current.length - shown
  if (hidden === 0) return body
  const visibility = `记忆可见性：当前展示 ${shown} 条有效 Finding，另有 ${hidden} 条有效 Finding 未注入，可使用 search_memory 按需检索。`
  return body === '' ? visibility : `${body}\n\n${visibility}`
}

/**
 * 把模型自己写的一句话切成检索词。
 *
 * 不做语义模型、不做词表：英文按词、中文按二字滑窗。检索层只负责「找出候选」，
 * 「值不值得读」留给模型——所以宁可召回宽一点。
 */
function tokenizeQuery(query) {
  const text = String(query ?? '').toLowerCase()
  const tokens = new Set()
  for (const match of text.matchAll(/[a-z0-9][a-z0-9_.:/#-]*/gu)) {
    if (match[0].length >= 2) tokens.add(match[0])
  }
  for (const match of text.matchAll(/[\u4e00-\u9fff]+/gu)) {
    const run = match[0]
    if (run.length === 1) {
      tokens.add(run)
      continue
    }
    for (let i = 0; i + 2 <= run.length; i += 1) tokens.add(run.slice(i, i + 2))
  }
  return [...tokens]
}

function formatDay(milliseconds) {
  const date = new Date(Number.isFinite(milliseconds) ? milliseconds : 0)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * 找候选，不返回正文。整条返回受 800 字符硬预算约束；超了从尾部减条数，
 * 不裁剪单条的信息（id / 时间 / 状态 / 长度都是「要不要读」的判断依据）。
 *
 * 分页只提供能力，不自动翻页；也不保证快照一致（两次调用之间新增 Finding 会位移）。
 */
export function searchFindings(findings, { query, limit = SEARCH_DEFAULT_LIMIT, offset = 0 } = {}) {
  const tokens = tokenizeQuery(query)
  // 一句话查询里的多个词，至少要两个同时出现才算相关；否则中文的二字滑窗会把
  // 「完全找不到」这种查询靠一个常见 bigram 蒙到一堆无关记录上。
  const minHits = tokens.length >= 2 ? 2 : 1
  const scored = []
  for (const finding of Object.values(findings ?? {})) {
    const haystack = `${finding.claim ?? ''}\n${finding.findingId ?? ''}`.toLowerCase()
    let score = 0
    for (const token of tokens) if (haystack.includes(token)) score += 1
    if (score === 0 || score < minHits) continue
    scored.push({ finding, score })
  }
  scored.sort((a, b) => b.score - a.score || b.finding.recordedAt - a.finding.recordedAt)

  const total = scored.length
  const start = Math.max(0, Math.floor(offset))
  const cap = Math.min(SEARCH_MAX_LIMIT, Math.max(1, Math.floor(limit)))
  const page = scored.slice(start, start + cap)
  const build = (items) => {
    const shown = items.length
    const hasMore = start + shown < total
    return { results: items, total, shown, hasMore, nextOffset: hasMore ? start + shown : null }
  }

  const results = page.map(({ finding }) => {
    const claim = String(finding.claim ?? '')
    return {
      id: finding.findingId,
      line: claim.length > SEARCH_LINE_MAX ? `${claim.slice(0, SEARCH_LINE_MAX - 1)}…` : claim,
      at: formatDay(finding.recordedAt),
      status: finding.status,
      chars: [...claim].length,
    }
  })

  let answer = build(results)
  while (answer.results.length > 1 && JSON.stringify(answer).length > SEARCH_BUDGET_CHARS) {
    answer = build(answer.results.slice(0, -1))
  }
  return answer
}

function resolveProject(root) {  if (typeof root !== 'string' || root.length === 0) return undefined
  try {
    const base = realpathSync(root)
    const output = execFileSync('git', ['-C', base, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: 5000 }).trim()
    return output.length > 0 ? realpathSync(output) : undefined
  } catch {
    return undefined
  }
}

function nextFindingId(findings) {
  let max = 0
  for (const id of Object.keys(findings)) {
    const match = /^f-(\d+)$/u.exec(id)
    if (match !== null) max = Math.max(max, Number(match[1]))
  }
  return `f-${String(max + 1).padStart(3, '0')}`
}

/**
 * `appendPluginRecord` lives in the host's own `@deepseek-ai/dsh-session`
 * module. A linked workspace plugin cannot resolve that bare specifier, so we
 * resolve it through the host entry and import the exact same module URL —
 * which shares the host's ESM instance (same Session class, same private
 * `#appendRecord` brand).
 */
let appendPluginRecord
let appendPluginRecordLoading

function resolveAppendPluginRecord() {
  if (appendPluginRecord !== undefined) return Promise.resolve(appendPluginRecord)
  if (appendPluginRecordLoading !== undefined) return appendPluginRecordLoading
  appendPluginRecordLoading = (async () => {
    const hosts = []
    if (typeof process.argv?.[1] === 'string') hosts.push(process.argv[1])
    if (typeof process.mainModule?.filename === 'string') hosts.push(process.mainModule.filename)
    for (const host of hosts) {
      try {
        const requireFromHost = createRequire(host)
        const resolved = requireFromHost.resolve('@deepseek-ai/dsh-session')
        const module = await import(pathToFileURL(resolved).href)
        if (typeof module.appendPluginRecord === 'function') {
          appendPluginRecord = module.appendPluginRecord
          return appendPluginRecord
        }
      } catch {
        // try the next host entry
      }
    }
    throw new Error('hikari findings: cannot resolve @deepseek-ai/dsh-session from the host entry')
  })()
  return appendPluginRecordLoading
}

/**
 * 安装 findings：projection + context + record_finding 工具。
 * root 不是 git 仓库时 fail-closed：只保留 projection，不注册 tool/context。
 */
export function installFindings(ctx, { sessionId, root, injectContext = true, append: injectedAppend }) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new Error('hikari findings: sessionId is required')
  }

  ctx.sessionProjections.register({
    key: FINDINGS_PROJECTION_KEY,
    stateVersion: FINDINGS_STATE_VERSION,
    stateSchema: { type: 'object' },
    init: () => ({ findings: {} }),
    apply: applyFindingRecord,
  })

  const currentSession = () => ctx.sessions.get(sessionId)
  const currentFindings = () => {
    const session = currentSession()
    if (session === undefined) return {}
    const state = ctx.sessionProjections.stateOf(session, FINDINGS_PROJECTION_KEY)
    return asObject(state?.findings) ?? {}
  }

  if (injectContext) {
    ctx.systemPrompt.context({
      name: 'hikari:findings',
      order: 150,
      text: () => renderFindings(currentFindings()),
    })
  }

  const project = resolveProject(root)
  if (project === undefined) {
    ctx.logger.warn(`hikari findings: "${String(root)}" is not a git repository; record_finding disabled (fail-closed)`)
    return { project: undefined }
  }

  const record = (args) => {
    const run = recordQueue.then(() => recordOne(args))
    recordQueue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  const recordOne = async (args) => {
    const session = currentSession()
    if (session === undefined) throw new Error(`hikari findings: session "${sessionId}" is not loaded`)
    const findings = currentFindings()
    const claim = normalizeClaim(args.claim)
    if (claim.length === 0) throw new Error('claim must not be empty')

    const requestedId = args.findingId
    const requestedStatus = args.status ?? 'open'
    const requestedProvenance = args.provenance ?? 'model-claim'
    if (!STATUSES.has(requestedStatus)) throw new Error(`unknown status "${String(requestedStatus)}"`)
    if (!PROVENANCES.has(requestedProvenance)) throw new Error(`unknown provenance "${String(requestedProvenance)}"`)
    const evidence = validateEvidence(session, args.evidence)
    if (requestedProvenance === 'tool-evidenced' && !evidence.some((entry) => entry.kind === 'tool-result')) {
      const auto = latestToolResult(session)
      if (auto === undefined) {
        throw new Error('provenance "tool-evidenced" requires a successful tool/result in this session; call a read-only tool first')
      }
      evidence.push(auto)
    }
    const hasToolEvidence = evidence.some((entry) => entry.kind === 'tool-result')
    if (requestedProvenance === 'tool-evidenced' && !hasToolEvidence) {
      throw new Error('provenance "tool-evidenced" requires at least one tool-result evidence entry')
    }

    let findingId
    if (requestedId === undefined) {
      if (requestedStatus !== 'open') throw new Error('a new finding must start as "open"; pass findingId to advance an existing finding')
      if (requestedProvenance !== 'model-claim') throw new Error('a new finding must start as "model-claim"')
      const duplicate = Object.values(findings).find((finding) => normalizeClaim(finding.claim) === claim && (finding.status === 'open' || finding.status === 'confirmed'))
      if (duplicate !== undefined) {
        return {
          findingId: duplicate.findingId,
          seq: duplicate.seq,
          status: duplicate.status,
          evidence: Array.isArray(duplicate.evidence) ? duplicate.evidence : [],
          deduplicated: true,
        }
      }
      findingId = nextFindingId(findings)
    } else {
      if (typeof requestedId !== 'string' || !FINDING_ID_PATTERN.test(requestedId)) throw new Error(`invalid findingId "${String(requestedId)}"`)
      const existing = findings[requestedId]
      if (existing === undefined) throw new Error(`unknown findingId "${requestedId}"; omit findingId to create a new finding`)
      if (!TRANSITIONS[existing.status].includes(requestedStatus)) {
        throw new Error(`illegal status transition ${existing.status} -> ${requestedStatus} for "${requestedId}"`)
      }
      if (existing.status === 'open' && (requestedStatus === 'confirmed' || requestedStatus === 'refuted')) {
        if (requestedProvenance !== 'tool-evidenced') throw new Error('leaving "open" requires provenance "tool-evidenced"')
        if (!hasToolEvidence) throw new Error('leaving "open" requires tool-result evidence')
      }
      if (requestedProvenance === 'tool-evidenced' && !hasToolEvidence) throw new Error('advancing a finding requires tool-result evidence')
      findingId = requestedId
    }

    // 「有工具证据支持」不是装饰：confirmed/resolved 必须携带真实工具证据，
    // 否则渲染层会说谎。
    if (requestedStatus === 'confirmed' || requestedStatus === 'resolved') {
      if (requestedProvenance !== 'tool-evidenced') throw new Error(`status "${requestedStatus}" requires provenance "tool-evidenced"`)
      if (!hasToolEvidence) throw new Error(`status "${requestedStatus}" requires at least one tool-result evidence entry`)
    }

    const data = {
      findingId,
      scope: { project, sessionId },
      claim,
      status: requestedStatus,
      provenance: requestedProvenance,
      evidence,
      recordedAt: Date.now(),
    }
    const append = typeof injectedAppend === 'function' ? injectedAppend : await resolveAppendPluginRecord()
    const seq = await append(session, FINDING_RECORD_TYPE, data)
    // 回显实际写入的记录（含 evidence 指针），让模型能回读「这条发现关联了哪次工具结果」。
    // 不重新推断 evidence，也不产生额外 Session 事件。
    return { findingId, seq, status: requestedStatus, provenance: requestedProvenance, evidence }
  }

  ctx.tools.register({
    name: 'record_finding',
    description:
      'Persist one project finding into the durable session log so later turns (and later processes) can read it. ' +
      'Use it only for a claim about this project. New findings start as status "open" with provenance "model-claim"; ' +
      'advance an existing finding by passing its findingId plus tool evidence. The record never enters the chat surface.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        claim: { type: 'string', description: 'One-sentence claim about the project.' },
        findingId: { type: 'string', description: 'Existing finding id (e.g. "f-001") when advancing a finding. Omit to create a new one.' },
        status: { type: 'string', enum: ['open', 'confirmed', 'refuted', 'resolved'], description: 'New findings must be "open"; later states require findingId and tool evidence.' },
        provenance: { type: 'string', enum: ['model-claim', 'tool-evidenced'], description: '"model-claim" for a hypothesis; "tool-evidenced" only when real tool evidence exists.' },
        evidence: {
          type: 'array',
          description: 'Evidence entries referencing real events of this session.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', enum: ['tool-result', 'file'] },
              seq: { type: 'number', description: 'Event seq in this session log.' },
              callId: { type: 'string', description: 'Tool call id for tool-result evidence.' },
              path: { type: 'string', description: 'File path for file evidence.' },
            },
            required: ['kind', 'seq'],
          },
        },
      },
      required: ['claim'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          findingId: { type: 'string' },
          seq: { type: 'number' },
          status: { type: 'string' },
          provenance: { type: 'string' },
        },
        required: ['findingId'],
      },
      render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      return record(args)
    },
  })

  ctx.tools.register({
    name: 'search_memory',
    description:
      'Search your own persisted findings about this project, using whatever words describe what you are trying to remember. ' +
      'Returns candidates only — id, a short excerpt, when, status and full length — never the full text. ' +
      'Call read_memory with one id to read it completely. Use it when the findings already in your context are not enough; ' +
      'skip it when they are. Searching is your choice, not a required step.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'What you are trying to remember, in your own words.' },
        limit: { type: 'number', description: 'Maximum candidates to return (default 4, max 20). A cap, not a promise.' },
        offset: { type: 'number', description: 'Skip this many matches, to browse further in the same query.' },
      },
      required: ['query'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          results: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                id: { type: 'string' },
                line: { type: 'string' },
                at: { type: 'string' },
                status: { type: 'string' },
                chars: { type: 'number' },
              },
              required: ['id'],
            },
          },
          total: { type: 'number' },
          shown: { type: 'number' },
          hasMore: { type: 'boolean' },
          nextOffset: { type: ['number', 'null'] },
        },
        required: ['results', 'total', 'shown', 'hasMore'],
      },
      render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      return searchFindings(currentFindings(), args)
    },
  })

  ctx.logger.info(`hikari findings ready (session=${sessionId}, project=${project})`)
  return { project }
}
