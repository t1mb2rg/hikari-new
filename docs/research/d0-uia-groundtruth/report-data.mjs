// Turns the raw reads in out/ into the tables the D0 report needs.
// node report-data.mjs out
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const out = process.argv[2] ?? 'out'
const j = (p) => JSON.parse(readFileSync(join(out, p), 'utf8'))
const exists = (p) => { try { readFileSync(join(out, p)); return true } catch { return false } }

const results = j('results.json')
const STATES = results.results.map((r) => r.state)

const line = (s) => console.log(s)
const hdr = (s) => { line(''); line('='.repeat(78)); line(s); line('='.repeat(78)) }

// ---------------------------------------------------------------- 1. per-state summary
hdr('1. PER-STATE READ SUMMARY (ControlView unless noted)')
line('state            nodes  textEls chars  named  namedNoText offscreen trunc       ms')
for (const rec of results.results) {
  for (const [strat, r] of Object.entries(rec.reads)) {
    if (!r.ok) { line(`${rec.state.padEnd(16)} ${strat.padEnd(8)} FAILED timedOut=${r.timedOut} exit=${r.exitCode}`); continue }
    const w = r.walk
    line(`${(rec.state + (strat === 'control' ? '' : ` [${strat}]`)).padEnd(16)} ${String(w.nodes).padStart(5)} ${String(w.textEls).padStart(7)} ${String(w.textChars).padStart(5)} ${String(w.named).padStart(6)} ${String(w.namedNoText).padStart(11)} ${String(w.offscreenNodes).padStart(9)} ${(w.truncatedBy || '-').padEnd(11)} ${r.elapsedMs}`)
  }
}

// Full reads live on disk; results.json only carries the walk summary.
const full = (state, strat) => (exists(`read-${state}-${strat}.json`) ? j(`read-${state}-${strat}.json`).result : null)
const truthOf = (rec) => { try { return j(rec.truthFile) } catch { return null } }

// ---------------------------------------------------------------- 2. recall + contamination
hdr('2. GROUND TRUTH vs READ — per state x strategy (recall of expectedVisible)')
for (const rec of results.results) {
  const truth = truthOf(rec)
  if (!truth) continue
  const expect = truth.markers.filter((m) => m.expectVisible)
  const partial = truth.markers.filter((m) => m.expectPartial)
  line(`\n${rec.state}  (tab=${truth.state.selectedTab} mainOffset=${truth.state.mainOffset} vp=${truth.state.mainViewportHeight}/${truth.state.mainExtentHeight} edit=${truth.state.editText})`)
  line(`   GROUND TRUTH: expectVisible=${expect.length}  expectPartial=${partial.length}  (of ${truth.markers.length} markers)`)
  // Every ground-truth marker the read mentioned at all, regardless of verdict.
  const mentioned = new Set(truth.markers.map((m) => m.text))
  for (const [strat, sum] of Object.entries(rec.reads)) {
    if (!sum.ok) { line(`   ${strat.padEnd(9)} FAILED (timedOut=${sum.timedOut})`); continue }
    const r = full(rec.state, strat)
    if (!r) { line(`   ${strat.padEnd(9)} (no artifact)`); continue }
    const cls = r.classified ?? []
    const saw = new Set(cls.filter((c) => c.verdict !== 'unknown').map((c) => c.text))
    const hit = expect.filter((m) => saw.has(m.text)).length
    const groups = {}
    for (const c of cls) {
      const k = c.verdict === 'unknown' ? 'unknown' : c.verdict
      groups[k] = (groups[k] ?? 0) + 1
    }
    line(`   ${strat.padEnd(9)} recall ${hit}/${expect.length}   ${JSON.stringify(groups)}`)
    if (hit !== expect.length) {
      const missing = expect.filter((m) => !saw.has(m.text)).map((m) => m.text)
      line(`             MISSED: ${missing.slice(0, 10).join(' ')}${missing.length > 10 ? ` ...(+${missing.length - 10})` : ''}`)
    }
    const bad = Object.entries(groups).filter(([k]) => k !== 'visible' && k !== 'SCROLLED-OUT' && k !== 'unknown')
    if (bad.length) line(`             CONTAMINATION: ${JSON.stringify(Object.fromEntries(bad))}`)
  }
}

// ---------------------------------------------------------------- 3. hidden classes
hdr('3. HIDDEN CONTENT — did any hidden-class marker enter a read?')
let anyHidden = false
for (const rec of results.results) {
  for (const strat of Object.keys(rec.reads)) {
    const r = full(rec.state, strat)
    if (!r) continue
    const hidden = (r.classified ?? []).filter((c) => (c.verdict ?? '').startsWith('HIDDEN-') || (c.verdict ?? '').includes('TAB'))
    if (hidden.length) { anyHidden = true; line(`  ${rec.state}[${strat}]: ${hidden.map((h) => `${h.text}->${h.verdict}`).join(' ')}`) }
  }
}
if (!anyHidden) line('  none — no hidden-class and no inactive-tab marker appeared in any read, any strategy')

// ---------------------------------------------------------------- 4. cross-window / cross-process
hdr('4. ATTRIBUTION — foreign markers in a W1 read')
let anyForeign = false
for (const rec of results.results) {
  for (const strat of Object.keys(rec.reads)) {
    const r = full(rec.state, strat)
    if (!r) continue
    const all = (r.markers ?? []).map((m) => m.text).join('\n')
    const w2 = [...new Set(all.match(/GT-W2-\d+/g) ?? [])]
    const fo = [...new Set(all.match(/GT-FOCUS-[A-Z0-9]+/g) ?? [])]
    if (w2.length || fo.length) { anyForeign = true; line(`  ${rec.state}[${strat}]: W2=${JSON.stringify(w2)} FOCUS=${JSON.stringify(fo)}`) }
  }
}
if (!anyForeign) line('  none — no W2 marker and no focus-holder marker entered any read of W1')

// ---------------------------------------------------------------- 5. text channels
hdr('5. WHICH CHANNEL CARRIED THE MARKER TEXT')
line('  state            strategy  Name  TextPattern  ValuePattern   nodes  textChars')
for (const rec of results.results) {
  for (const strat of Object.keys(rec.reads)) {
    const r = full(rec.state, strat)
    if (!r) continue
    const src = { Name: 0, TextPattern: 0, ValuePattern: 0 }
    for (const c of r.classified ?? []) { if (c.verdict !== 'unknown' && src[c.source] !== undefined) src[c.source]++ }
    line(`  ${rec.state.padEnd(16)} ${strat.padEnd(9)} ${String(src.Name).padStart(4)} ${String(src.TextPattern).padStart(11)} ${String(src.ValuePattern).padStart(12)} ${String(r.walk.nodes).padStart(6)} ${String(r.walk.textChars).padStart(10)}`)
  }
}

// ---------------------------------------------------------------- 6. IsOffscreen vs pixels
hdr('6. IsOffscreen vs PIXELS (baseline & scrolled — the two with a pixel probe)')
for (const rec of results.results) {
  const b = full(rec.state, 'control')
  if (!b || !b.pixels) continue
  const px = b.pixels
  const body = truthOf(rec)
  if (!body) continue
  const pxs = new Map(px.rows.map((x) => [x.text, x]))
  const uia = new Map((b.classified ?? []).filter((c) => c.verdict !== 'unknown').map((c) => [c.text, c]))
  const cells = {}
  const detail = []
  for (const m of body.markers) {
    const u = uia.get(m.text); const p = pxs.get(m.text)
    if (!p || p.region === 'inputs') continue
    // Rows that are not inside the captured bitmap cannot be judged by pixel at all.
    if (!p.inBitmap) continue
    const k = `pixel=${p.paintedThere ? 'PAINTED' : 'not-painted'} / IsOffscreen=${u ? u.uiaOffscreen : 'NOT-READ'}`
    cells[k] = (cells[k] ?? 0) + 1
    detail.push({ t: m.text, painted: p.paintedThere, off: u?.uiaOffscreen, expect: m.expectVisible, partial: m.expectPartial, region: m.region, verdict: u?.verdict })
  }
  line(`\n${rec.state}  printWindowOk=${px.printWindowOk} windowVisible=${px.windowVisible} iconic=${px.windowIconic} rect=${JSON.stringify(px.rect)}`)
  for (const [k, v] of Object.entries(cells).sort()) line(`   ${k.padEnd(46)} ${v}`)
  const fp = detail.filter((d) => d.off === false && !d.painted)
  const tp = detail.filter((d) => d.off === true && d.painted)
  line(`   IsOffscreen=false but NOT painted : ${fp.length} ${fp.map((d) => `${d.t}${d.partial ? '(partial)' : ''}`).slice(0, 8).join(' ')}`)
  line(`   IsOffscreen=true  but PAINTED     : ${tp.length} ${tp.slice(0, 6).map((d) => d.t).join(' ')}`)
  const edge = detail.filter((d) => d.partial && d.painted)
  line(`   partial-at-edge rows that ARE painted: ${edge.length} ${edge.map((d) => `${d.t}(off=${d.off})`).join(' ')}`)
}

// ---------------------------------------------------------------- 7. Name-only hazard
hdr('7. NAME-ONLY / A11Y-ONLY CONTROLS')
for (const rec of ['baseline', 'edited']) {
  if (!exists(`read-${rec}-control.json`)) continue
  const full = j(`read-${rec}-control.json`)
  line(`\n  ${rec}:`)
  for (const m of (full.result?.markers ?? [])) {
    if (/NAMEONLY|A11YONLY|EDIT/.test(m.text)) line(`     [${m.source}] ${JSON.stringify(m.text)} ct=${m.controlType} off=${m.isOffscreen}`)
  }
}

// ---------------------------------------------------------------- 8. focused strategy
hdr('8. focused STRATEGY vs THE ACTUAL FOREGROUND')
line('  (foreign text is counted, never stored — the probe drops it before it reaches an artifact)')
for (const f of ['read-foreign-focus-focused.json', 'read-foreign-focus-focused-w2.json', 'read-blocked-focused.json']) {
  if (!exists(f)) continue
  const r = j(f)
  line(`\n  ${f}: timedOut=${r.timedOut} exit=${r.exitCode}`)
  if (r.result) {
    const w = r.result.walk
    line(`     requested hwnd=${r.result.hwnd}   real foreground=${JSON.stringify(r.result.foreground)}`)
    line(`     owningHwnd=${w.owningHwnd} isThisWindow=${w.isThisWindow} ct=${w.controlType} off=${w.uiaOffscreen}`)
    line(`     own-window text recorded: ${w.textChars} chars | foreign text counted, discarded: TextPattern=${w.foreignTextChars ?? 0} Name=${w.foreignNameChars ?? 0} Value=${w.foreignValueChars ?? 0}`)
    line(`     markers emitted: ${r.result.markers.length}`)
  } else line(`     NO PARSE: ${JSON.stringify(r.rawOut)}`)
}

// ---------------------------------------------------------------- 8b. window state per read
hdr('8b. WHAT UIA ITSELF SAYS ABOUT THE WINDOW')
for (const rec of results.results) {
  const b = full(rec.state, 'control')
  if (!b) continue
  const px = b.pixels
  line(`  ${rec.state.padEnd(16)} warp=${JSON.stringify(b.window)}  ${px ? `IsIconic=${px.windowIconic} IsWindowVisible=${px.windowVisible} rect=${JSON.stringify(px.rect)}` : ''}`)
}
line('\n  offscreen node sample (baseline, ControlView):')
{
  const b = full('baseline', 'control')
  for (const o of b?.walk?.offscreenSample ?? []) line(`     d${o.depth} ${o.controlType} ${JSON.stringify(o.name)}`)
}
line('\n  offscreen node sample (minimized, ControlView):')
{
  const b = full('minimized', 'control')
  for (const o of b?.walk?.offscreenSample ?? []) line(`     d${o.depth} ${o.controlType} ${JSON.stringify(o.name)}`)
}

// ---------------------------------------------------------------- 9. blocked
hdr('9. BLOCKED UI THREAD')
for (const f of ['read-blocked-control.json']) {
  if (!exists(f)) continue
  const r = j(f)
  line(`  ${f}: timedOut=${r.timedOut} exitCode=${r.exitCode} parsed=${!!r.result}`)
  line(`     stdout=${JSON.stringify((r.rawOut ?? '').slice(0, 300))}`)
  line(`     stderr=${JSON.stringify((r.stderr ?? '').slice(0, 400))}`)
}

// ---------------------------------------------------------------- 10. cross-window raw
hdr('10. CROSS-WINDOW (W1 read while W2 alive)')
if (exists('read-crosswindow-raw.json')) {
  const r = j('read-crosswindow-raw.json')
  const t = (r.result?.markers ?? []).map((m) => m.text).join('\n')
  line(`  nodes=${r.result?.walk.nodes} W2 markers present: ${JSON.stringify([...new Set(t.match(/GT-W2-\d+/g) ?? [])])}`)
  line(`  windowPid=${r.result?.windowPid} probePid=${r.result?.probePid}`)
}
