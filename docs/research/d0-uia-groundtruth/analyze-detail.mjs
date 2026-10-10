// Deeper cut: which channel carries the text, and how UIA's IsOffscreen compares with pixels.
// node analyze-detail.mjs <truth.json> <read-*.json>
import { readFileSync } from 'node:fs'

const truth = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const byText = new Map(truth.markers.map((m) => [m.text, m]))

for (const path of process.argv.slice(3)) {
  const r = JSON.parse(readFileSync(path, 'utf8'))
  console.log(`\n########## ${path.split(/[\\/]/).pop()}  (${r.strategy}) ##########`)

  // --- which channel carried the marker text?
  const src = {}
  for (const c of r.classified ?? []) {
    if (c.verdict === 'unknown') continue
    src[c.source] = (src[c.source] ?? 0) + 1
  }
  console.log('marker text arrived via:', JSON.stringify(src))

  const unknown = (r.classified ?? []).filter((c) => c.verdict === 'unknown')
  if (unknown.length) {
    console.log('unmatched strings (not in the inventory):')
    for (const u of unknown) console.log(`   [${u.source}] ${JSON.stringify(u.text).slice(0, 120)}`)
  }

  // --- IsOffscreen vs pixel truth, per marker
  const px = new Map()
  if (r.pixels) for (const row of r.pixels.rows) px.set(row.text, row)
  const uia = new Map()
  for (const c of r.classified ?? []) {
    if (c.verdict === 'unknown') continue
    uia.set(c.text, { off: c.uiaOffscreen, source: c.source, verdict: c.verdict })
  }

  // Only rows the pixel probe could actually locate can enter the confusion matrix.
  const cells = {}
  const detail = []
  for (const m of truth.markers) {
    const u = uia.get(m.text)
    const p = px.get(m.text)
    if (!u || !p || !p.inBitmap) continue
    const trulyVisible = p.paintedThere
    const key = `pixels=${trulyVisible ? 'VISIBLE' : 'not-painted'} / IsOffscreen=${u.off}`
    cells[key] = (cells[key] ?? 0) + 1
    detail.push({ text: m.text, painted: trulyVisible, off: u.off, expect: m.expectVisible, verdict: u.verdict, region: m.region })
  }
  console.log('\nIsOffscreen vs pixels (rows with a sample point inside the bitmap):')
  for (const [k, v] of Object.entries(cells).sort()) console.log(`   ${k.padEnd(38)} ${v}`)

  // The load-bearing question: does IsOffscreen=false ever mean NOT visible, and
  // does IsOffscreen=true ever mean actually visible?
  const falseButPainted = detail.filter((d) => !d.off && !d.painted)
  const trueButPainted = detail.filter((d) => d.off && d.painted)
  console.log(`\n  IsOffscreen=false but NOT painted on screen : ${falseButPainted.length}` +
    (falseButPainted.length ? `  ${falseButPainted.slice(0, 8).map((d) => d.text).join(' ')}` : ''))
  console.log(`  IsOffscreen=true  but painted on screen     : ${trueButPainted.length}` +
    (trueButPainted.length ? `  ${trueButPainted.slice(0, 8).map((d) => d.text).join(' ')}` : ''))

  // The partial row at the viewport edge is its own category.
  const edge = detail.filter((d) => !d.expect && d.painted)
  if (edge.length) {
    console.log(`\n  PARTIALLY VISIBLE (layout said off, pixels say painted): ${edge.length}`)
    for (const d of edge) console.log(`     ${d.text} region=${d.region} IsOffscreen=${d.off} verdict=${d.verdict}`)
  }
}
