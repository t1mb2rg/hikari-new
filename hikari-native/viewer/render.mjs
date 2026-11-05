#!/usr/bin/env node
// Hikari 记忆的只读视图。
//
// 它回答的是"我抬眼能不能看见它"，不是"我再查一下"：
//   · 记忆：按 seq 排的时间线，能展开看原文、来源、修订链；
//   · 拒绝：它想记却没记成的东西——这是"记忆为什么缺一块"的唯一线索；
//   · 未知：发生时间不明、来源回查不到、从没被修订过的孤条。
//
// 三条硬约束（`docs/architecture/hikari-end-state.md` §5.2）：
//   1. 只读——它不写 memory.jsonl，也不碰 meta，只读文件、只渲染；
//   2. 渲染不是真源——所有数字从文件现算，删掉视图记忆本体一点不损失；
//   3. 不做第二套持久化——不建库、不起服务；`--out` 只是把 HTML 写到文件。
//
// 用法：
//   node hikari-native/viewer/render.mjs                      # 读默认 store，写 hikari-view.html
//   node hikari-native/viewer/render.mjs --format text        # 在终端打印
//   node hikari-native/viewer/render.mjs --store <dir> --out <file>

import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MEMORY_JSONL = 'memory.jsonl'
const REJECTIONS_FILE = 'memory.rejections.jsonl'

/**
 * 默认存储目录：与 `hikari-native/memory/store.mjs` 的 `resolveMemoryDir` 同序
 * （`$DSH_HOME` 优先，其次 `~/.dsh`，末尾拼 `hikari/memory`）。这里不复用那个函数，
 * 是因为它属于写入侧；视图只认路径约定，不加载 store。
 */
export function defaultStoreDir(env = process.env, home = homedir()) {
  const base = env.DSH_HOME && env.DSH_HOME.length > 0 ? env.DSH_HOME : join(home, '.dsh')
  return join(base, 'hikari', 'memory')
}

/** 逐行解析；坏行不抛错，只计数——视图要能显示"这里文件坏过"。 */
export function parseJsonl(raw) {
  const entries = []
  let brokenLines = 0
  for (const line of raw.split('\n')) {
    const text = line.trim()
    if (text.length === 0) continue
    try {
      entries.push(JSON.parse(text))
    } catch {
      brokenLines += 1
    }
  }
  return { entries, brokenLines }
}

async function readIfPresent(path) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return null
    throw error
  }
}

export function buildView(records, rejections, options = {}) {
  const ordered = [...records].sort((a, b) => a.seq - b.seq)
  const supersededBy = new Map()
  for (const record of ordered) {
    if (typeof record.supersedes === 'string') supersededBy.set(record.supersedes, record.memoryId)
  }

  const unknownWhen = ordered.filter((record) => record.occurredAt === null || record.occurredAt === undefined)
  const heads = ordered.filter((record) => !supersededBy.has(record.memoryId))
  const revised = ordered.filter((record) => typeof record.supersedes === 'string')
  const kinds = new Map()
  for (const record of ordered) {
    const kind = record.source && typeof record.source.kind === 'string' ? record.source.kind : 'unknown'
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1)
  }

  const codes = new Map()
  for (const entry of rejections) codes.set(entry.code, (codes.get(entry.code) ?? 0) + 1)

  const timeline = [...ordered].reverse().map((record) => ({
    ...record,
    next: supersededBy.get(record.memoryId) ?? null,
  }))

  return {
    storeDir: options.storeDir ?? null,
    now: options.now ?? Date.now(),
    brokenLines: options.brokenLines ?? 0,
    rejectionBrokenLines: options.rejectionBrokenLines ?? 0,
    total: ordered.length,
    heads: heads.length,
    revised: revised.length,
    unknownWhen: unknownWhen.length,
    lastSeq: ordered.length > 0 ? ordered[ordered.length - 1].seq : 0,
    kinds: [...kinds.entries()].sort((a, b) => b[1] - a[1]),
    rejections,
    rejectionCodes: [...codes.entries()].sort((a, b) => b[1] - a[1]),
    timeline,
    unknown: unknownWhen.map((record) => ({ memoryId: record.memoryId, seq: record.seq, recordedAt: record.recordedAt })),
  }
}

function stamp(ms) {
  if (typeof ms !== 'number') return '—'
  const date = new Date(ms)
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}Z`
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function renderText(view) {
  const lines = []
  lines.push(`Hikari 记忆 · ${view.storeDir ?? '(未指定 store)'}`)
  lines.push(`  记忆 ${view.total} 条（链头 ${view.heads}，被修订过 ${view.revised}），最新 seq ${view.lastSeq}`)
  lines.push(`  发生时间未知 ${view.unknownWhen} 条 · 拒绝样本 ${view.rejections.length} 条`)
  if (view.brokenLines > 0) lines.push(`  ⚠ memory.jsonl 有 ${view.brokenLines} 行读不出来`)
  if (view.kinds.length > 0) lines.push(`  来源：${view.kinds.map(([kind, count]) => `${kind}×${count}`).join(' · ')}`)
  lines.push('')
  for (const record of view.timeline) {
    const head = record.next === null ? '' : ` → 已修订为 ${record.next}`
    const when = record.occurredAt === null || record.occurredAt === undefined ? '发生时间未知' : stamp(record.occurredAt)
    lines.push(`[seq ${record.seq}] ${record.memoryId} · 记录于 ${stamp(record.recordedAt)} · ${when}${head}`)
    lines.push(`  ${record.text.replaceAll('\n', ' ').slice(0, 160)}`)
  }
  if (view.rejections.length > 0) {
    lines.push('')
    lines.push(`拒绝样本（${view.rejections.length}）`)
    for (const entry of view.rejections.slice(-10).reverse()) {
      lines.push(`  ${stamp(entry.at)} · ${entry.tool} · ${entry.code}${entry.excerpt ? ` · 「${entry.excerpt.slice(0, 60)}」` : ''}`)
    }
  }
  return lines.join('\n')
}

export function renderHtml(view) {
  const cards = view.timeline
    .map((record) => {
      const when =
        record.occurredAt === null || record.occurredAt === undefined
          ? '<span class="unknown">发生时间未知</span>'
          : stamp(record.occurredAt)
      const source =
        record.source && typeof record.source.kind === 'string'
          ? `${record.source.kind}${record.source.ref ? `:${record.source.ref}` : ''}`
          : 'unknown'
      const links = []
      if (typeof record.supersedes === 'string') links.push(`修订自 <a href="#${record.supersedes}">${record.supersedes}</a>`)
      if (record.next !== null) links.push(`已被 <a href="#${record.next}">${record.next}</a> 修订`)
      const range = []
      if (record.validFrom !== null && record.validFrom !== undefined) range.push(`自 ${stamp(record.validFrom)}`)
      if (record.validTo !== null && record.validTo !== undefined) range.push(`至 ${stamp(record.validTo)}`)
      if (typeof record.validHint === 'string' && record.validHint.length > 0) range.push(record.validHint)
      return `<article class="card" id="${escapeHtml(record.memoryId)}">
  <header><code>${escapeHtml(record.memoryId)}</code><span class="seq">seq ${record.seq}</span></header>
  <p class="text">${escapeHtml(record.text)}</p>
  <dl>
    <dt>记录于</dt><dd>${stamp(record.recordedAt)}</dd>
    <dt>发生</dt><dd>${when}</dd>
    <dt>来源</dt><dd><code>${escapeHtml(source)}</code></dd>
    ${range.length > 0 ? `<dt>有效期</dt><dd>${escapeHtml(range.join(' · '))}</dd>` : ''}
    ${links.length > 0 ? `<dt>链</dt><dd>${links.join(' · ')}</dd>` : ''}
  </dl>
</article>`
    })
    .join('\n')

  const rejections =
    view.rejections.length === 0
      ? '<p class="empty">没有被拒的样本。</p>'
      : [...view.rejections]
          .reverse()
          .map(
            (entry) => `<article class="reject">
  <header><code>${escapeHtml(entry.code)}</code><span class="seq">${escapeHtml(entry.tool)}</span></header>
  <p class="text">${entry.excerpt ? escapeHtml(entry.excerpt) : '<span class="unknown">（没有正文摘要）</span>'}</p>
  <dl><dt>时间</dt><dd>${stamp(entry.at)}</dd><dt>键</dt><dd>${escapeHtml((entry.keys ?? []).join(', '))}</dd><dt>字数</dt><dd>${entry.chars ?? '—'}</dd>${entry.memoryId ? `<dt>目标</dt><dd><code>${escapeHtml(entry.memoryId)}</code></dd>` : ''}</dl>
</article>`,
          )
          .join('\n')

  const unknown =
    view.unknown.length === 0
      ? '<p class="empty">每一条记忆都知道自己发生在什么时候。</p>'
      : `<ul>${view.unknown.map((record) => `<li><a href="#${escapeHtml(record.memoryId)}">${escapeHtml(record.memoryId)}</a> · 记录于 ${stamp(record.recordedAt)}</li>`).join('')}</ul>`

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>Hikari 记忆</title>
<style>
:root{--bg:#12131a;--card:#1b1d27;--line:#2b2e3c;--fg:#e6e8f0;--dim:#9aa1b5;--warn:#e0a44b;--ok:#6fcf97}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.65 ui-sans-serif,system-ui,"Segoe UI","Microsoft YaHei",sans-serif}
header.top{padding:28px 32px 12px;border-bottom:1px solid var(--line)}
h1{margin:0 0 6px;font-size:20px;font-weight:600}
.sub{color:var(--dim);font-size:13px}
.stats{display:flex;gap:28px;flex-wrap:wrap;padding:16px 32px;border-bottom:1px solid var(--line)}
.stat b{display:block;font-size:22px;font-weight:600}
.stat span{color:var(--dim);font-size:12px}
main{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:24px;padding:24px 32px 64px}
@media (max-width:1000px){main{grid-template-columns:1fr}}
h2{font-size:14px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);margin:0 0 12px}
.card,.reject{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin-bottom:12px}
.card header,.reject header{display:flex;justify-content:space-between;gap:12px;align-items:baseline;margin-bottom:8px}
code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12.5px;color:#b8c0d8}
.seq{color:var(--dim);font-size:12px}
.text{margin:0 0 10px;white-space:pre-wrap;word-break:break-word}
dl{display:grid;grid-template-columns:64px 1fr;gap:2px 10px;margin:0;font-size:13px}
dt{color:var(--dim)}dd{margin:0;word-break:break-word}
.unknown{color:var(--warn)}
.empty{color:var(--dim);font-size:13px}
a{color:#8fb4ff;text-decoration:none}a:hover{text-decoration:underline}
ul{margin:0;padding-left:18px;font-size:13px}
hr{border:0;border-top:1px solid var(--line);margin:20px 0}
</style></head>
<body>
<header class="top">
  <h1>Hikari 记忆</h1>
  <div class="sub">${escapeHtml(view.storeDir ?? '(未指定 store)')} · 渲染于 ${stamp(view.now)} · 只读</div>
</header>
<div class="stats">
  <div class="stat"><b>${view.total}</b><span>记忆</span></div>
  <div class="stat"><b>${view.heads}</b><span>链头</span></div>
  <div class="stat"><b>${view.revised}</b><span>被修订过</span></div>
  <div class="stat"><b class="${view.unknownWhen > 0 ? 'unknown' : ''}">${view.unknownWhen}</b><span>发生时间未知</span></div>
  <div class="stat"><b>${view.rejections.length}</b><span>拒绝样本</span></div>
  <div class="stat"><b>${view.lastSeq}</b><span>最新 seq</span></div>
</div>
<main>
  <section>
    <h2>记忆 · 新的在上</h2>
    ${cards || '<p class="empty">还没有任何记忆。</p>'}
  </section>
  <aside>
    <h2>它不知道的</h2>
    ${unknown}
    <hr>
    <h2>拒绝样本 · 想记却没记成</h2>
    ${rejections}
    <hr>
    <h2>来源分布</h2>
    ${view.kinds.length === 0 ? '<p class="empty">—</p>' : `<ul>${view.kinds.map(([kind, count]) => `<li>${escapeHtml(kind)} × ${count}</li>`).join('')}</ul>`}
    ${view.brokenLines > 0 ? `<p class="unknown">⚠ memory.jsonl 有 ${view.brokenLines} 行读不出来</p>` : ''}
    ${view.rejectionBrokenLines > 0 ? `<p class="unknown">⚠ memory.rejections.jsonl 有 ${view.rejectionBrokenLines} 行读不出来</p>` : ''}
  </aside>
</main>
</body></html>
`
}

export async function loadView({ storeDir, now = Date.now() } = {}) {
  const dir = resolve(storeDir ?? defaultStoreDir())
  const memoryRaw = await readIfPresent(join(dir, MEMORY_JSONL))
  if (memoryRaw === null) {
    throw new Error(
      `no ${MEMORY_JSONL} under ${dir} — pass --store <dir>, or write a memory first (nothing is invented here).`,
    )
  }
  const memory = parseJsonl(memoryRaw)
  const rejectionRaw = await readIfPresent(join(dir, REJECTIONS_FILE))
  const rejection = rejectionRaw === null ? { entries: [], brokenLines: 0 } : parseJsonl(rejectionRaw)
  return buildView(memory.entries, rejection.entries, {
    storeDir: dir,
    now,
    brokenLines: memory.brokenLines,
    rejectionBrokenLines: rejection.brokenLines,
  })
}

function parseArgs(argv) {
  const options = { format: 'html', out: null, store: null }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--format') options.format = argv[++index]
    else if (arg === '--out') options.out = argv[++index]
    else if (arg === '--store') options.store = argv[++index]
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`unknown argument: ${arg}`)
  }
  return options
}

const USAGE = `usage: node hikari-native/viewer/render.mjs [--store <dir>] [--format html|text] [--out <file>]

  --store   记忆存储目录（默认 $DSH_HOME/hikari/memory 或 ~/.dsh/hikari/memory）
  --format  html（默认，写文件）或 text（打印到终端）
  --out     html 的输出路径（默认 ./hikari-view.html）

只读：不写 memory.jsonl、不碰 meta、不起服务。`

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(`${USAGE}\n`)
    return
  }
  if (options.format !== 'html' && options.format !== 'text') throw new Error(`unknown --format: ${options.format}`)
  const view = await loadView({ storeDir: options.store })
  if (options.format === 'text') {
    process.stdout.write(`${renderText(view)}\n`)
    return
  }
  const out = resolve(options.out ?? 'hikari-view.html')
  await writeFile(out, renderHtml(view), 'utf8')
  process.stdout.write(`${out}\n`)
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (invokedDirectly) {
  await main()
}
