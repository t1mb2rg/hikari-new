// Can a reader derive "this content is currently on screen" from UIA alone?
//
// Pixel ground truth comes from PrintWindow; the candidate rules are computed from UIA properties
// only, so a disagreement is a real limitation of the rule, not of the harness.
//
// node visibility-rule.mjs out
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const out = process.argv[2] ?? 'out'
const j = (p) => JSON.parse(readFileSync(join(out, p), 'utf8'))
const has = (p) => existsSync(join(out, p))
const results = j('results.json')

const area = (r) => (!r || r.empty || r.error ? 0 : Math.max(0, r.w) * Math.max(0, r.h))
const inter = (a, b) => {
  if (!a || !b || a.empty || b.empty || a.error || b.error) return null
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h)
  if (x2 <= x1 || y2 <= y1) return null
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}
// Positive-area intersection. A row whose rect merely TOUCHES the clip edge (y == edge) occupies no
// on-screen pixels there, so a zero-area touch is not visibility.
const hits = (a, b) => area(inter(a, b)) > 0

// The three frames a reader might pick.
function frames(m, client) {
  const anc = m.ancestors ?? []
  const scrollable = anc.find((a) => a.scrollable)
  return {
    client,
    scroll: scrollable ? scrollable.rect : null,
    allAncestors: anc.map((a) => a.rect),
  }
}

// R1: element rect inside the WINDOW CLIENT area.
// R2: element rect inside the NEAREST SCROLLABLE ANCESTOR's rect.
// R3: element rect inside EVERY ancestor's rect (the naive "walk up and clip" idea).
function rule(m, client, which) {
  if (m.isOffscreen) return false
  const f = frames(m, client)
  if (which === 'R1') return hits(m.rect, f.client)
  if (which === 'R2') return f.scroll ? hits(m.rect, f.scroll) : hits(m.rect, f.client)
  if (which === 'R3') return f.allAncestors.length ? f.allAncestors.every((r) => hits(m.rect, r)) : hits(m.rect, f.client)
  throw new Error(which)
}

console.log('')
console.log('='.repeat(78))
console.log('DERIVING VISIBILITY FROM UIA ALONE vs THE PIXELS')
console.log('='.repeat(78))

const RULES = ['R1', 'R2', 'R3']
const totals = Object.fromEntries(RULES.map((r) => [r, { tp: 0, fp: 0, fn: 0, tn: 0 }]))
const totalsClear = Object.fromEntries(RULES.map((r) => [r, { tp: 0, fp: 0, fn: 0, tn: 0 }]))
const residual = { R2: [] }

for (const rec of results.results) {
  const f = `read-${rec.state}-control.json`
  if (!has(f)) continue
  const r = j(f).result
  if (!r?.pixels) continue
  // A minimized window's capture is a stub, so "not painted" there is an artefact of the capture,
  // not evidence. Scoring it would credit a rule with agreeing on a vacuous row.
  if (r.pixels.windowIconic) { console.log(`\n${rec.state}   SKIPPED: minimized, capture is a stub`); continue }
  const px = new Map(r.pixels.rows.filter((x) => x.inBitmap && x.region !== 'inputs').map((x) => [x.text, x]))
  const truth = j(rec.truthFile)
  const expect = new Map(truth.markers.map((m) => [m.text, m]))

  const judged = [] // rows where pixels CAN judge: in bitmap, not an input
  for (const m of r.markers) {
    const p = px.get(m.text)
    if (!p || !expect.has(m.text)) continue
    if (judged.some((d) => d.text === m.text)) continue
    // A row straddling the clip edge cannot be judged by a single sampled point: WPF itself calls
    // it partial, the reader's rule may call it in or out depending on which pixel is in question,
    // and the one-point pixel probe answers only about that one point. Such rows are counted, then
    // set aside, rather than being scored as rule errors in either direction.
    const ex = expect.get(m.text)
    judged.push({ text: m.text, painted: p.paintedThere, m, expect: ex, partial: !!ex.expectPartial })
  }

  if (!judged.length) continue
  console.log(`\n${rec.state}   windowVisible=${r.pixels.windowVisible} iconic=${r.pixels.windowIconic}  judged rows=${judged.length}`)
  const client = r.clientOnScreen
  console.log(`   frames: client=${JSON.stringify(client)}`)
  for (const rn of RULES) {
    const c = { tp: 0, fp: 0, fn: 0, tn: 0 }
    const mism = []
    for (const d of judged) {
      const derived = rule(d.m, client, rn)
      if (derived && d.painted) c.tp++
      else if (derived && !d.painted) { c.fp++; mism.push(`${d.text}: claims ON, pixels OFF`) }
      else if (!derived && d.painted) { c.fn++; mism.push(`${d.text}: claims OFF, pixels PAINTED`) }
      else c.tn++
    }
    for (const k of Object.keys(c)) totals[rn][k] += c[k]
    console.log(`   ${rn}  agree=${c.tp + c.tn}/${judged.length}  ` +
      `claims-ON-but-not-painted=${c.fp}  claims-OFF-but-painted=${c.fn}`)
    if (mism.length && rn === 'R2') for (const x of mism) console.log(`        ${x}`)
  }

  // Same rules, edge rows removed. This is the number that says whether the rule is reliable:
  // on rows whose visibility is unambiguous, an error is a real limitation, not a boundary artefact.
  const clear = judged.filter((d) => !d.partial)
  console.log(`   -- rows with unambiguous visibility: ${clear.length}/${judged.length}`)
  for (const rn of RULES) {
    const c = { tp: 0, fp: 0, fn: 0, tn: 0 }
    const mism = []
    for (const d of clear) {
      const derived = rule(d.m, client, rn)
      if (derived && d.painted) c.tp++
      else if (derived && !d.painted) { c.fp++; mism.push(`${d.text}(ON,not painted)`) }
      else if (!derived && d.painted) { c.fn++; mism.push(`${d.text}(OFF,painted)`) }
      else c.tn++
    }
    for (const k of Object.keys(c)) totalsClear[rn][k] += c[k]
    console.log(`   ${rn}  agree=${c.tp + c.tn}/${clear.length}  false-ON=${c.fp}  false-OFF=${c.fn}   ${mism.join(' ')}`)
  }

  // Everything R2 gets wrong, kept for the report's residual-class section.
  for (const d of judged) {
    const derived = rule(d.m, client, 'R2')
    if (derived !== d.painted) {
      const a = d.m.ancestors ?? []
      residual.R2.push({
        state: rec.state, text: d.text, derived, painted: d.painted,
        off: d.m.isOffscreen, rect: d.m.rect,
        scrollAncestor: (a.find((x) => x.scrollable) ?? {}).rect ?? null,
        wpf: { expectVisible: d.expect.expectVisible, expectPartial: d.expect.expectPartial,
               opacity: d.expect.effectiveOpacity, decl: d.expect.declared, tab: d.expect.tab },
      })
    }
  }

  // The two pure-UIA flags, so the report can say exactly what each one does cover.
  const hiddenRows = judged.filter((d) => d.m.isOffscreen)
  console.log(`   IsOffscreen=true rows: ${hiddenRows.map((d) => `${d.text}(painted=${d.painted})`).join(' ') || 'none'}`)
}

console.log('')
console.log('='.repeat(78))
console.log('TOTALS ACROSS ALL PIXEL-JUDGED STATES')
console.log('='.repeat(78))
for (const rn of RULES) {
  const t = totals[rn]
  const n = t.tp + t.fp + t.fn + t.tn
  console.log(`  ${rn}: agree ${t.tp + t.tn}/${n}   false-ON ${t.fp}   false-OFF ${t.fn}`)
}
console.log('')
console.log('  same, EXCLUDING rows that straddle the clip edge (unambiguous rows only):')
for (const rn of RULES) {
  const t = totalsClear[rn]
  const n = t.tp + t.fp + t.fn + t.tn
  console.log(`  ${rn}: agree ${t.tp + t.tn}/${n}   false-ON ${t.fp}   false-OFF ${t.fn}`)
}

console.log('')
console.log('='.repeat(78))
console.log('WHAT R2 STILL GETS WRONG (the residual class)')
console.log('='.repeat(78))
if (!residual.R2.length) console.log('  nothing')
for (const x of residual.R2) {
  console.log(`  ${x.state.padEnd(10)} ${x.text}  derived=${x.derived ? 'ON ' : 'OFF'} painted=${x.painted}`)
  console.log(`      IsOffscreen=${x.off} rect=${JSON.stringify(x.rect)} scrollAncestor=${JSON.stringify(x.scrollAncestor)}`)
  console.log(`      WPF: declared=${x.wpf.decl} opacity=${x.wpf.opacity} expectVisible=${x.wpf.expectVisible} expectPartial=${x.wpf.expectPartial}`)
}
