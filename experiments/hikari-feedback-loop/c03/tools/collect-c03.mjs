// C-03 analysis collector.
//
// Reads the twelve captures (session logs + traces + meta) and produces one
// normalized record per run plus a compact summary table. Read-only: it never
// touches workspaces, sessions or traces.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { pairToolEvents, readRangeOf, observedRangeOf, RESULT_SUCCESS } from './tool-evidence.mjs'

const c03 = 'G:\\work\\LAB\\code\\projects\\own\\hikari-new\\experiments\\hikari-feedback-loop\\c03'
const manifest = JSON.parse(readFileSync(join(c03, 'fixtures', 'runs', 'manifest.json'), 'utf8'))

function decodeSession(file) {
  const buf = readFileSync(file)
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
  const offsets = []
  let at = 0
  while ((at = buf.indexOf(magic, at)) !== -1) {
    offsets.push(at)
    at += 4
  }
  const events = []
  for (let k = 0; k < offsets.length; k += 1) {
    const end = k + 1 < offsets.length ? offsets[k + 1] : buf.length
    try {
      const out = zstdDecompressSync(buf.subarray(offsets[k], end))
      for (const line of out.toString('utf8').split('\n')) {
        if (!line.trim()) continue
        try {
          events.push(JSON.parse(line))
        } catch {}
      }
    } catch {}
  }
  return events.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
}

function textOf(message) {
  return (message?.content ?? [])
    .map((part) => (typeof part === 'string' ? part : (part.text ?? '')))
    .join('\n')
}

const FINDING_CONTEXT_MARKERS = ['Hikari 当前认识', '此前的假设，尚未验证', '有工具证据支持，尚未独立验证', '已闭合']
const READSCOPE_MARKER = '本会话已成功读取并返回内容的范围'

const runs = []
for (const run of manifest.runs) {
  const metaPath = join(c03, 'captures', `${run.run}.meta.json`)
  const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : null
  const record = {
    run: run.run,
    condition: run.condition,
    sessionId: run.sessionId,
    workspace: run.workspace,
    port: run.port,
    meta,
    valid: false,
    invalidReason: null,
    turns: [],
    calls: [],
    reads: [],
    findings: [],
    findingUpdates: [],
    traceRequests: 0,
    traceRequestsWithFindingContext: 0,
    traceRequestsWithReadscope: 0,
    firstRequestAt: null,
    turn3EndTime: null,
    turn4FirstRequestAt: null,
    fileMtimeAfterMutation: null,
    b2Recheck: null,
    stepCount: 0,
    errorCount: 0,
  }

  if (!meta || meta.status !== 'completed') {
    record.invalidReason = meta ? `status=${meta.status}` : 'no-meta'
    runs.push(record)
    continue
  }
  record.valid = true

  const events = decodeSession(meta.sessionFile)
  record.eventCount = events.length
  record.stepCount = events.filter((e) => e.type === 'step/start').length
  const systemEvent = events.find((e) => e.type === 'system/message')
  record.systemMessageChars = systemEvent ? textOf(systemEvent.data.message).length : 0
  const runtimeEvent = events.find((e) => e.type === 'user/message' && e.data?.source?.kind === 'runtime-context')
  record.runtimeContextChars = runtimeEvent ? textOf(runtimeEvent.data).length : 0

  for (const ev of events) {
    if (ev.type === 'turn/start' || ev.type === 'turn/end') {
      record.turns.push({ type: ev.type, turn: ev.data?.turn, seq: ev.seq, time: ev.time })
    }
    if (ev.type === 'plugin:hikari/finding') {
      const d = ev.data ?? {}
      record.findings.push({
        findingId: d.findingId,
        seq: ev.seq,
        time: ev.time,
        status: d.status,
        provenance: d.provenance,
        evidence: Array.isArray(d.evidence) ? d.evidence : [],
        claim: typeof d.claim === 'string' ? d.claim : '',
      })
    }
    if (ev.type === 'tool/call') {
      record.calls.push({
        seq: ev.seq,
        turn: ev.data?.turn,
        step: ev.data?.step,
        callId: ev.data?.callId,
        name: ev.data?.name,
        args: ev.data?.arguments,
      })
    }
    if (ev.type === 'tool/result' && ev.data?.message?.isError) record.errorCount += 1
  }

  const { pairs } = pairToolEvents(events)
  for (const pair of pairs) {
    if (pair.call?.name !== 'read') continue
    const range = readRangeOf(pair.call)
    const observed = observedRangeOf(pair)
    record.reads.push({
      seq: pair.call.seq,
      turn: pair.call.turn,
      callId: pair.call.callId,
      path: 'kind' in range ? null : range.path,
      offset: 'kind' in range ? null : range.offset,
      limit: 'kind' in range ? null : range.limit,
      ok: pair.status === RESULT_SUCCESS,
      firstLineNo: observed.kind === 'inspected' ? observed.firstLineNo : null,
      lastLineNo: observed.kind === 'inspected' ? observed.lastLineNo : null,
      matchesRequest: observed.kind === 'inspected' ? observed.matchesRequest : null,
      snippet: pair.result?.text ? pair.result.text.replace(/\s+/g, ' ').slice(0, 160) : '',
      containsDecisionLog: pair.result?.text ? pair.result.text.includes('Decision log') : false,
      containsDedupeKey: pair.result?.text ? pair.result.text.includes('dedupeKey') : false,
    })
  }

  // Repeated reads: a successful read whose observed line range overlaps an
  // earlier successful read of the same path.
  const seen = []
  for (const read of record.reads) {
    if (!read.ok || read.path === null) continue
    const start = read.offset ?? 1
    const end = read.lastLineNo ?? (read.firstLineNo ?? start) + (read.limit ?? 2000) - 1
    const overlap = seen.find((s) => s.path === read.path && !(end < s.start || start > s.end))
    read.repeatedOf = overlap ? [overlap.callId, overlap.seq] : null
    if (!overlap) seen.push({ path: read.path, start, end, callId: read.callId, seq: read.seq })
  }

  const turn3End = record.turns.find((t) => t.type === 'turn/end' && t.turn === 3)
  record.turn3EndTime = turn3End?.time ?? null
  record.uniqueFindingIds = new Set(record.findings.map((f) => f.findingId)).size

  const tracePath = join(c03, 'captures', `${run.run}.jsonl`)
  if (existsSync(tracePath)) {
    const lines = readFileSync(tracePath, 'utf8').split('\n').filter(Boolean)
    record.traceRequests = lines.length
    for (const line of lines) {
      let req
      try {
        req = JSON.parse(line)
      } catch {
        continue
      }
      const body = JSON.stringify(req)
      if (FINDING_CONTEXT_MARKERS.some((m) => body.includes(m))) record.traceRequestsWithFindingContext += 1
      if (body.includes(READSCOPE_MARKER)) record.traceRequestsWithReadscope += 1
      if (record.firstRequestAt === null) {
        record.firstRequestAt = req.at
        const systemChars = (req.messages ?? [])
          .filter((m) => m.role === 'system')
          .reduce((sum, m) => sum + textOf(m).length, 0)
        record.firstRequestSystemChars = systemChars
      }
    }
    if (record.turn3EndTime !== null) {
      const after = []
      for (const line of lines) {
        let req
        try {
          req = JSON.parse(line)
        } catch {
          continue
        }
        if (typeof req.at === 'number' && req.at > record.turn3EndTime) after.push(req)
      }
      record.turn4FirstRequestAt = after.length ? after[0].at : null
    }
  }

  // File mtime for A2/B2 runs (the mutation ran after turn 3).
  if (run.condition.endsWith('2')) {
    const handoff = join(run.workspace, 'docs', 'notes', 'handoff.md')
    if (existsSync(handoff)) {
      record.fileMtimeAfterMutation = statSync(handoff).mtimeMs
      record.workspaceHasMutation = readFileSync(handoff, 'utf8').includes('Decision log')
    }
    // B2 hard gate: a successful read of handoff.md after turn 3 whose text
    // contains the mutation content.
    const recheck = record.reads.find(
      (r) => r.turn >= 4 && r.ok && r.path && r.path.replace(/\\/g, '/').endsWith('docs/notes/handoff.md') &&
        (r.containsDecisionLog || r.containsDedupeKey),
    )
    record.b2Recheck = recheck
      ? { ok: true, seq: recheck.seq, callId: recheck.callId, turn: recheck.turn, snippet: recheck.snippet }
      : { ok: false }
  }

  runs.push(record)
}

mkdirSync(join(c03, 'analysis'), { recursive: true })
writeFileSync(join(c03, 'analysis', 'runs.json'), JSON.stringify(runs, null, 2), 'utf8')

// ---- summary -------------------------------------------------------------
const pad = (s, n) => String(s).padEnd(n)
console.log(pad('run', 5), pad('cond', 5), pad('turns', 6), pad('steps', 6), pad('reads', 6), pad('repeat', 7), pad('find', 5), pad('uniq', 5), pad('ctxReq', 7), pad('scopeReq', 9), pad('invalid', 8))
for (const r of runs) {
  if (!r.valid) {
    console.log(pad(r.run, 5), pad(r.condition, 5), pad('-', 6), pad('-', 6), pad('-', 6), pad('-', 7), pad('-', 5), pad('-', 5), pad('-', 7), pad('-', 9), r.invalidReason)
    continue
  }
  const repeat = r.reads.filter((x) => x.repeatedOf).length
  console.log(
    pad(r.run, 5), pad(r.condition, 5), pad(r.turns.filter((t) => t.type === 'turn/end').length, 6),
    pad(r.stepCount, 6), pad(r.reads.length, 6), pad(repeat, 7), pad(r.findings.length, 5), pad(r.uniqueFindingIds, 5),
    pad(r.traceRequestsWithFindingContext, 7), pad(r.traceRequestsWithReadscope, 9), pad(r.valid ? 'ok' : 'invalid', 8),
  )
}
