#!/usr/bin/env node
// Hikari Desktop · P1 只读面板
//
// 这个文件只做一件事：把散在三处的东西读出来，拼成一个能双击打开的 HTML。
//
//   - 记忆与拒绝：<store>/memory.jsonl、<store>/memory.rejections.jsonl
//   - 认识变化：DSH 会话日志里的 plugin:hikari/finding 记录（多帧 zstd）
//   - 仓库观察：hikari-project-watch 的 trace.jsonl（产线已开）
//
// 边界（见 docs/architecture/hikari-desktop-p0-boundary.md §6）：
//   * 只读。不改记忆、不写回任何数据源、不建第二套真源。
//   * 不常驻、不开服务：跑一次、出一个文件、关掉。
//   * 不订阅事件。"最近被唤醒过几次"是数日志得出的，不是订阅来的。
//   * 不做判断。哪条重要、哪条过期，面板不排也不猜；它只按时间与序号摆出来。
//
// 会话日志格式（session.v4.jsonl.zstd）是多个 zstd 帧首尾相接，不是单个流：
// 必须按魔数 28 b5 2f fd 切帧、逐帧解压，否则只拿到第一帧。

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { buildView, defaultStoreDir } from '../viewer/render.mjs'

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const MEMORY_JSONL = 'memory.jsonl'
const REJECTIONS_FILE = 'memory.rejections.jsonl'
const FINDING_TYPE = 'plugin:hikari/finding'
const WAKE_PREFIX = '[Hikari 自主观察'
const DEFAULT_TRACE = path.join('experiments', 'hikari-project-watch', 'tmp', 'trace.jsonl')
const SNIPPET_CHARS = 120
const TRACE_ROWS = 40

export function defaultSessionsDir(env = process.env, home = homedir()) {
  const root = env.DSH_HOME ?? path.join(home, '.dsh')
  return path.join(root, 'sessions')
}

/** 读一个 JSONL；坏行不抛错，只计数（与 viewer 一致）。 */
function readJsonlFile(file) {
  if (!fs.existsSync(file)) return { records: [], badLines: 0, mtime: null }
  const raw = fs.readFileSync(file, 'utf8')
  const records = []
  let badLines = 0
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    try {
      records.push(JSON.parse(line))
    } catch {
      badLines++
    }
  }
  return { records, badLines, mtime: fs.statSync(file).mtimeMs }
}

/** 按魔数切帧并逐个解压；坏帧只计数。 */
export function readZstdFrames(buffer) {
  const offsets = []
  for (let i = 0; i + 3 < buffer.length; i++) {
    if (
      buffer[i] === ZSTD_MAGIC[0] &&
      buffer[i + 1] === ZSTD_MAGIC[1] &&
      buffer[i + 2] === ZSTD_MAGIC[2] &&
      buffer[i + 3] === ZSTD_MAGIC[3]
    ) {
      offsets.push(i)
    }
  }
  const chunks = []
  let badFrames = 0
  for (let k = 0; k < offsets.length; k++) {
    const start = offsets[k]
    const end = k + 1 < offsets.length ? offsets[k + 1] : buffer.length
    try {
      chunks.push(zlib.zstdDecompressSync(buffer.subarray(start, end)).toString('utf8'))
    } catch {
      badFrames++
    }
  }
  return { chunks, frames: offsets.length, badFrames }
}

function findingOf(record, sessionId) {
  const data = record?.data
  if (data === undefined || data === null) return null
  if (typeof data.findingId !== 'string') return null
  return {
    sessionId,
    findingId: data.findingId,
    seq: typeof record.seq === 'number' ? record.seq : null,
    time: typeof record.time === 'number' ? record.time : null,
    status: typeof data.status === 'string' ? data.status : null,
    claim: typeof data.claim === 'string' ? data.claim : '',
    provenance: typeof data.provenance === 'string' ? data.provenance : null,
  }
}

/**
 * 扫会话日志，取两类东西：
 *   - findings：认识，以及"同一编号再次出现"的状态变化
 *   - wakes：把唤醒提示词当用户消息递进来的次数（activation 的 followup）
 *
 * 逐帧解压很贵（本工作区 99 个会话约 90 MB），所以按文件 mtime 过滤：
 * 只读 sinceMs 之后改动过的会话。没有缓存文件——面板不写任何东西。
 */
export function readSessions(sessionsDir, { sinceMs = null, maxSessions = 400 } = {}) {
  const empty = {
    findings: [],
    wakes: 0,
    sessions: 0,
    scanned: 0,
    frames: 0,
    records: 0,
    bytes: 0,
    badFrames: 0,
    badLines: 0,
  }
  if (!fs.existsSync(sessionsDir)) return { ...empty, missing: true }

  // 会话日志有两种摆放：<sessions>/<session>/session.v4.jsonl.zstd
  // 与 <sessions>/<workspace-hash>/<session>/session.v4.jsonl.zstd。两种都认。
  const dirs = []
  const pushIfSession = (candidate) => {
    const file = path.join(candidate, 'session.v4.jsonl.zstd')
    if (fs.existsSync(file)) dirs.push({ sessionId: path.basename(candidate), file })
  }
  for (const entry of fs.readdirSync(sessionsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const first = path.join(sessionsDir, entry.name)
    pushIfSession(first)
    for (const inner of fs.readdirSync(first, { withFileTypes: true })) {
      if (!inner.isDirectory()) continue
      pushIfSession(path.join(first, inner.name))
    }
  }
  const sessions = dirs.length
  const selected = dirs
    .map((item) => ({ ...item, mtime: fs.statSync(item.file).mtimeMs }))
    .filter((item) => sinceMs === null || item.mtime >= sinceMs)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, maxSessions)

  const out = { ...empty, sessions }
  for (const item of selected) {
    const buffer = fs.readFileSync(item.file)
    out.scanned++
    out.bytes += buffer.length
    const { chunks, frames, badFrames } = readZstdFrames(buffer)
    out.frames += frames
    out.badFrames += badFrames
    for (const chunk of chunks) {
      for (const line of chunk.split('\n')) {
        if (line === '') continue
        out.records++
        if (line.includes(FINDING_TYPE)) {
          let record
          try {
            record = JSON.parse(line)
          } catch {
            out.badLines++
            continue
          }
          const finding = findingOf(record, item.sessionId)
          if (finding !== null) out.findings.push(finding)
          continue
        }
        if (line.includes(WAKE_PREFIX) && line.includes('"type":"user/message"')) {
          out.wakes++
        }
      }
    }
  }
  return out
}

/**
 * 把同一 (会话, 编号) 的追加记录合成一个实体。
 *
 * finding 的 f-NNN 只在会话内唯一：session-hikari 的 f-001 与另一个会话的
 * f-001 不是一回事。所以身份是 (sessionId, findingId) 双键，不是编号本身。
 */
export function summarizeFindings(findings) {
  const byKey = new Map()
  for (const finding of findings) {
    const key = `${finding.sessionId}::${finding.findingId}`
    const slot = byKey.get(key)
    if (slot === undefined) {
      byKey.set(key, { ...finding, history: [finding] })
    } else {
      slot.history.push(finding)
      slot.claim = finding.claim === '' ? slot.claim : finding.claim
      slot.status = finding.status ?? slot.status
      slot.seq = finding.seq ?? slot.seq
      slot.time = finding.time ?? slot.time
    }
  }

  const entities = []
  for (const slot of byKey.values()) {
    const history = slot.history
      .filter((item) => item.status !== null)
      .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
    const transitions = []
    for (let i = 1; i < history.length; i++) {
      const before = history[i - 1]
      const after = history[i]
      if (before.status === after.status) continue
      transitions.push({
        from: before.status,
        to: after.status,
        at: after.time,
        // 两次记录之间的间隔：会话语义下的"她多久改了主意"
        deltaMs: before.time !== null && after.time !== null ? after.time - before.time : null,
      })
    }
    entities.push({
      sessionId: slot.sessionId,
      findingId: slot.findingId,
      claim: slot.claim,
      status: history.length > 0 ? history[history.length - 1].status : slot.status,
      recordedAt: history.length > 0 ? history[history.length - 1].time : slot.time,
      firstAt: history.length > 0 ? history[0].time : null,
      records: slot.history.length,
      transitions,
    })
  }
  entities.sort((a, b) => (b.recordedAt ?? 0) - (a.recordedAt ?? 0))
  return entities
}

export function readTrace(tracePath, { rows = TRACE_ROWS } = {}) {
  const { records, mtime } = readJsonlFile(tracePath)
  const meaningful = records.filter((row) => row?.kind !== 'quiet')
  return {
    path: tracePath,
    exists: mtime !== null,
    total: records.length,
    meaningful: meaningful.length,
    recent: meaningful.slice(-rows).reverse(),
    mtime,
  }
}

function flatten(text) {
  return String(text).replace(/\s+/gu, ' ').trim()
}

function snippet(text) {
  const flat = flatten(text)
  return flat.length <= SNIPPET_CHARS ? flat : `${flat.slice(0, SNIPPET_CHARS)}…`
}

function newestOf(...times) {
  const present = times.filter((time) => typeof time === 'number')
  return present.length === 0 ? null : Math.max(...present)
}

/**
 * 拼出面板要显示的全部内容。不做判断：只做计数、排序和"如实标注"。
 */
export function buildPanel({
  storeDir,
  sessionsDir,
  tracePath,
  now = Date.now(),
  sinceDays = 14,
} = {}) {
  const store = storeDir ?? defaultStoreDir()
  const memoryFile = path.join(store, MEMORY_JSONL)
  const rejectionsFile = path.join(store, REJECTIONS_FILE)
  const { records, badLines, mtime: memoryMtime } = readJsonlFile(memoryFile)
  const rejections = readJsonlFile(rejectionsFile)

  const view = buildView(records, rejections.records, { unreadableLines: rejections.badLines })
  const sessions = readSessions(sessionsDir ?? defaultSessionsDir(), {
    sinceMs: now - sinceDays * 24 * 60 * 60 * 1000,
  })
  const entities = summarizeFindings(sessions.findings)
  const trace = readTrace(tracePath ?? path.join(process.cwd(), DEFAULT_TRACE))

  const heads = entities.filter((entity) => entity.transitions.length === 0).length
  const changed = entities.length - heads

  return {
    generatedAt: now,
    store: { dir: store, exists: memoryMtime !== null, badLines },
    home: {
      memories: view.total,
      heads: view.heads,
      revised: view.revised,
      unknownOccurredAt: view.unknownWhen,
      rejections: rejections.records.length,
      findings: entities.length,
      findingsChanged: changed,
      wakes: sessions.wakes,
      // "在线"只能是近似：没有任何进程自报在场，只能看文件最后被谁碰过。
      lastTouch: newestOf(memoryMtime, rejections.mtime, trace.mtime),
    },
    memory: {
      // timeline 已是"新的在上"（buildView 里 reverse 过）
      timeline: view.timeline,
      rejections: view.rejections,
      sources: view.kinds,
    },
    world: {
      entities,
      sessions: sessions.sessions,
      scanned: sessions.scanned,
      frames: sessions.frames,
      records: sessions.records,
      bytes: sessions.bytes,
      badFrames: sessions.badFrames,
      missing: sessions.missing === true,
    },
    awareness: {
      wakes: sessions.wakes,
      trace,
    },
  }
}

// ---------------------------------------------------------------------------
// 渲染：一个自包含的 HTML，无外链、无脚本、无第二份数据
// ---------------------------------------------------------------------------

function escapeHtml(text) {
  return String(text)
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
}

function stamp(ms) {
  if (typeof ms !== 'number') return '未知'
  const date = new Date(ms)
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function ago(ms, now) {
  if (typeof ms !== 'number') return '未知'
  const minutes = Math.round((now - ms) / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} 小时前`
  return `${Math.round(hours / 24)} 天前`
}

function gap(ms) {
  if (typeof ms !== 'number' || ms < 0) return '未知'
  const total = Math.round(ms / 1000)
  if (total < 60) return `${total} 秒`
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (minutes < 60) return seconds === 0 ? `${minutes} 分钟` : `${minutes} 分 ${seconds} 秒`
  const hours = Math.floor(minutes / 60)
  return `${hours} 小时 ${minutes % 60} 分`
}

const STATUS_LABEL = {
  open: '待验',
  confirmed: '已确认',
  refuted: '被推翻',
  resolved: '已了结',
}

function stat(value, label, hint = '') {
  return `<div class="stat"><div class="stat-value">${escapeHtml(value)}</div><div class="stat-label">${escapeHtml(label)}</div>${
    hint === '' ? '' : `<div class="stat-hint">${escapeHtml(hint)}</div>`
  }</div>`
}

function renderHome(panel) {
  const { home, store } = panel
  const online =
    home.lastTouch === null
      ? '没有痕迹'
      : `约 ${ago(home.lastTouch, panel.generatedAt)}`

  const cautions = []
  if (!store.exists) {
    cautions.push('记忆库还不存在（生产库目前 recordCount 0）：这一页显示的是"她还没记过"，不是"读取失败"。')
  }
  if (home.unknownOccurredAt > 0) {
    cautions.push(`${home.unknownOccurredAt} 条记忆的发生时间是未知的——她当时不知道现在几点，这里也不替她编。`)
  }
  if (panel.world.missing) {
    cautions.push('没找到会话日志目录：认识变化这一格是空的，不是"她没想过"。')
  }

  return `
<section id="home">
  <h2>她现在</h2>
  <div class="stats">
    ${stat(home.memories, '记忆条数', `${home.heads} 条现行 · ${home.revised} 条被修订`)}
    ${stat(home.findings, '认识的实体', `${home.findingsChanged} 个变过`)}
    ${stat(home.wakes, '最近被唤醒', '按会话日志里的唤醒提示计')}
    ${stat(home.rejections, '被拒写入', '拒绝了什么，记在下面')}
    ${stat(online, '最后一次痕迹', '近似值：看文件最后写入时间')}
  </div>
  <p class="note">这个面板只读。它不向 Hikari 注入任何东西，也不替她判断哪条重要。</p>
  ${cautions.map((text) => `<p class="caution">${escapeHtml(text)}</p>`).join('\n  ')}
</section>`
}

function renderMemory(panel) {
  const rows = panel.memory.timeline
    .map((record) => {
      const occurred =
        record.occurredAt === null
          ? '<span class="unknown">发生时间未知</span>'
          : escapeHtml(stamp(record.occurredAt))
      const relation =
        record.supersedes === null || record.supersedes === undefined
          ? record.next === null || record.next === undefined
            ? '<span class="tag">现行</span>'
            : `<span class="tag old">已被 ${escapeHtml(record.next.slice(0, 12))}… 修订</span>`
          : `<span class="tag">修订了 ${escapeHtml(record.supersedes.slice(0, 12))}…</span>`
      const source =
        record.source?.kind === undefined || record.source?.kind === null
          ? '来源未记'
          : `${escapeHtml(record.source.kind)}${record.source.ref === null ? '' : ` · ${escapeHtml(record.source.ref)}`}`
      return `
    <li>
      <div class="row-head">
        <span class="seq">#${escapeHtml(record.seq)}</span>
        ${relation}
        <span class="time">记于 ${escapeHtml(stamp(record.recordedAt))}</span>
        <span class="time">${occurred}</span>
      </div>
      <p class="text">${escapeHtml(snippet(record.text))}</p>
      <p class="meta">${source} · ${escapeHtml(String(record.text ?? '').length)} 字${record.validHint === null ? '' : ` · 有效提示：${escapeHtml(record.validHint)}`}</p>
    </li>`
    })
    .join('')

  const rejectRows = panel.memory.rejections
    .slice()
    .reverse()
    .map(
      (entry) => `
    <tr>
      <td>${escapeHtml(stamp(entry.at))}</td>
      <td><code>${escapeHtml(entry.tool)}</code></td>
      <td><code>${escapeHtml(entry.code)}</code></td>
      <td class="excerpt">${entry.excerpt === null ? '<span class="unknown">（正文为空白）</span>' : escapeHtml(entry.excerpt)}</td>
    </tr>`,
    )
    .join('')

  return `
<section id="memory">
  <h2>她记住了什么</h2>
  ${
    rows === ''
      ? '<p class="empty">还没有任何记忆。她第一次调用 <code>write_memory</code> 之后，这里会出现第一条。</p>'
      : `<ol class="timeline">${rows}</ol>`
  }
  <h3>拒绝留下的痕迹</h3>
  ${
    rejectRows === ''
      ? '<p class="empty">没有拒绝记录。</p>'
      : `<table class="rejects"><thead><tr><th>时间</th><th>工具</th><th>原因</th><th>摘要</th></tr></thead><tbody>${rejectRows}</tbody></table>`
  }
  <p class="note">被拒的内容不会变成记忆，也不会被她检索到；这里只是"她试过但没被收下"的痕迹。</p>
</section>`
}

function renderWorld(panel) {
  const { entities } = panel.world
  const cards = entities
    .map((entity) => {
      const changes =
        entity.transitions.length === 0
          ? '<p class="meta">没有状态变化</p>'
          : `<ul class="changes">${entity.transitions
              .map(
                (change) =>
                  `<li><span class="tag">${escapeHtml(STATUS_LABEL[change.from] ?? change.from)} → ${escapeHtml(STATUS_LABEL[change.to] ?? change.to)}</span> 间隔 ${escapeHtml(gap(change.deltaMs))}</li>`,
              )
              .join('')}</ul>`
      return `
    <li>
      <div class="row-head">
        <span class="seq">${escapeHtml(entity.findingId)}</span>
        <span class="tag status-${escapeHtml(entity.status ?? 'unknown')}">${escapeHtml(STATUS_LABEL[entity.status] ?? (entity.status ?? '未知'))}</span>
        <span class="time">${escapeHtml(stamp(entity.recordedAt))}</span>
      </div>
      <p class="text">${escapeHtml(entity.claim === '' ? '（没有正文）' : entity.claim)}</p>
      <p class="meta">会话 <code>${escapeHtml(entity.sessionId)}</code> · ${escapeHtml(entity.records)} 条记录</p>
      ${changes}
    </li>`
    })
    .join('')

  return `
<section id="world">
  <h2>她认为世界是什么样</h2>
  ${
    cards === ''
      ? '<p class="empty">没有读到任何认识记录。</p>'
      : `<ol class="findings">${cards}</ol>`
  }
  <p class="note">编号只在会话内唯一：<code>f-001</code> 在不同会话里不是同一条。上面每条都标了会话。
  读的是 ${escapeHtml(panel.world.scanned)} / ${escapeHtml(panel.world.sessions)} 个会话（近 14 天有写入的），
  ${escapeHtml(panel.world.frames)} 帧 / ${escapeHtml(panel.world.records)} 条记录${
    panel.world.badFrames === 0 ? '' : `（${escapeHtml(panel.world.badFrames)} 帧解不开）`
  }。</p>
</section>`
}

function renderAwareness(panel) {
  const { wakes, trace } = panel.awareness
  const rows = trace.recent
    .map(
      (row) => `
    <tr>
      <td>${escapeHtml(stamp(row.at))}</td>
      <td><code>${escapeHtml(row.kind ?? '?')}</code></td>
      <td>${escapeHtml(String(row.head ?? '').slice(0, 8))}</td>
      <td>${row.dirty === true ? '有未提交改动' : row.dirty === false ? '干净' : '—'}</td>
    </tr>`,
    )
    .join('')

  return `
<section id="awareness">
  <h2>她观察到了什么</h2>
  <p class="note">只有一半：仓库变化有结构化轨迹；窗口切换没有落盘，只在她被唤醒时的提示词里留过一句话。</p>
  <div class="stats">
    ${stat(wakes, '被唤醒次数', '近 14 天，按日志计')}
    ${stat(trace.exists ? trace.meaningful : '无', '仓库变化事件', trace.exists ? `共 ${trace.total} 条轨迹，去掉安静时段` : '没找到轨迹文件')}
  </div>
  ${
    rows === ''
      ? '<p class="empty">没有可显示的仓库轨迹。</p>'
      : `<table class="trace"><thead><tr><th>时间</th><th>类型</th><th>HEAD</th><th>工作区</th></tr></thead><tbody>${rows}</tbody></table>`
  }
</section>`
}

function renderActivities() {
  return `
<section id="activities">
  <h2>还有什么没完成</h2>
  <p class="empty">还不知道。</p>
  <p class="note">没有任何地方记着"Hikari 打算做什么、做到哪一步"。会话日志里的工具调用与待办属于宿主，不是她的行动。
  这一格要等未决事项与行动有归属之后才填得出来——在那之前留白，不编。</p>
</section>`
}

export function renderPanel(panel) {
  const generated = stamp(panel.generatedAt)
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>Hikari</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 40px 24px 80px;
    background: #0e1013; color: #dfe3ea;
    font: 15px/1.65 "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
  }
  main { max-width: 880px; margin: 0 auto; }
  header h1 { margin: 0 0 4px; font-size: 26px; letter-spacing: .04em; font-weight: 600; }
  header p { margin: 0; color: #7d8798; font-size: 13px; }
  section { margin-top: 44px; padding-top: 24px; border-top: 1px solid #1d222b; }
  h2 { margin: 0 0 16px; font-size: 18px; font-weight: 600; }
  h3 { margin: 28px 0 10px; font-size: 14px; color: #9aa4b4; font-weight: 600; }
  .stats { display: flex; flex-wrap: wrap; gap: 12px; }
  .stat { flex: 1 1 150px; padding: 14px 16px; background: #151920; border: 1px solid #1f242e; border-radius: 10px; }
  .stat-value { font-size: 22px; font-weight: 600; }
  .stat-label { margin-top: 2px; color: #9aa4b4; font-size: 13px; }
  .stat-hint { margin-top: 4px; color: #66707f; font-size: 12px; }
  ol, ul { list-style: none; margin: 0; padding: 0; }
  .timeline li, .findings li { padding: 14px 0; border-bottom: 1px solid #171c24; }
  .row-head { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; font-size: 12px; color: #7d8798; }
  .seq { font-family: ui-monospace, Consolas, monospace; color: #8fbfe0; }
  .tag { padding: 1px 8px; border-radius: 999px; background: #1c2531; color: #8fbfe0; font-size: 11px; }
  .tag.old { background: #241c1c; color: #c99191; }
  .status-open { background: #1c2531; color: #8fbfe0; }
  .status-confirmed { background: #17251d; color: #86c9a0; }
  .status-refuted { background: #2a1a1a; color: #d99191; }
  .status-resolved { background: #22201a; color: #c9bf86; }
  .text { margin: 8px 0 4px; }
  .meta { margin: 0; color: #6b7585; font-size: 12px; }
  .changes { margin-top: 6px; }
  .changes li { padding: 2px 0; color: #9aa4b4; font-size: 12px; }
  .time { color: #66707f; }
  .unknown { color: #b08a5a; }
  .note { margin: 12px 0 0; color: #66707f; font-size: 12.5px; }
  .caution { margin: 10px 0 0; padding: 8px 12px; background: #1d1a14; border-left: 2px solid #8a6a33; color: #c9b28a; font-size: 12.5px; }
  .empty { color: #7d8798; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th { text-align: left; color: #66707f; font-weight: 500; padding: 6px 8px; border-bottom: 1px solid #1d222b; }
  td { padding: 6px 8px; border-bottom: 1px solid #171c24; vertical-align: top; }
  td.excerpt { color: #9aa4b4; }
  code { font-family: ui-monospace, Consolas, monospace; font-size: 12px; color: #8fbfe0; }
  footer { margin-top: 56px; color: #4e5766; font-size: 12px; }
</style>
</head>
<body>
<main>
  <header>
    <h1>Hikari</h1>
    <p>只读面板 · 生成于 ${escapeHtml(generated)}</p>
  </header>
  ${renderHome(panel)}
  ${renderMemory(panel)}
  ${renderWorld(panel)}
  ${renderAwareness(panel)}
  ${renderActivities()}
  <footer>
    数据：<code>${escapeHtml(panel.store.dir)}</code> 的记忆与拒绝记录、DSH 会话日志里的认识、project-watch 的仓库轨迹。<br>
    这个页面不写任何东西，也没有脚本；关掉它就等于关掉了面板。要更新，重新生成一次。
  </footer>
</main>
</body>
</html>
`
}

const USAGE = `usage: node hikari-native/panel/build.mjs [--store <dir>] [--sessions <dir>] [--trace <file>] [--out <file>] [--since-days <n>]`

function parseArgs(argv) {
  const options = {
    store: null,
    sessions: null,
    trace: null,
    out: null,
    sinceDays: 14,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => {
      i++
      return argv[i]
    }
    if (arg === '--store') options.store = next()
    else if (arg === '--sessions') options.sessions = next()
    else if (arg === '--trace') options.trace = next()
    else if (arg === '--out') options.out = next()
    else if (arg === '--since-days') options.sinceDays = Number(next())
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(`${USAGE}\n`)
      process.exit(0)
    } else {
      throw new Error(`unknown argument: ${arg}\n${USAGE}`)
    }
  }
  return options
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const panel = buildPanel({
    storeDir: options.store ?? defaultStoreDir(),
    sessionsDir: options.sessions ?? defaultSessionsDir(),
    tracePath: options.trace ?? path.join(process.cwd(), DEFAULT_TRACE),
    sinceDays: options.sinceDays,
  })
  const html = renderPanel(panel)
  if (options.out === null) {
    process.stdout.write(html)
  } else {
    fs.writeFileSync(options.out, html, 'utf8')
    process.stderr.write(
      `panel: ${options.out}（记忆 ${panel.home.memories} 条 · 认识 ${panel.home.findings} 条 · 拒绝 ${panel.home.rejections} 条）\n`,
    )
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  })
}
