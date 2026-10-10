// Cross-checks one probe result against its truth.json.
// node analyze.mjs <truth.json> <read-*.json> [...more reads]
import { readFileSync } from 'node:fs'

const truth = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const byText = new Map(truth.markers.map((m) => [m.text, m]))

const VERDICT_ORDER = [
  'visible', 'SCROLLED-OUT', 'INACTIVE-TAB', 'HIDDEN-COLLAPSED', 'HIDDEN-VISIBILITY',
  'HIDDEN-OPACITY', 'OTHER-WINDOW', 'OTHER-PROCESS', 'NOT-EXPECTED', 'unknown',
]

for (const path of process.argv.slice(3)) {
  const r = JSON.parse(readFileSync(path, 'utf8'))
  console.log(`\n=== ${path.split(/[\\/]/).pop()}  strategy=${r.strategy} ===`)
  if (!r.ok) { console.log('  ok=false', r.error); continue }
  const w = r.walk
  console.log(`  walk: nodes=${w.nodes} textEls=${w.textEls} textChars=${w.textChars} named=${w.named} namedNoText=${w.namedNoText}`)
  console.log(`        depth=${w.maxDepth} truncatedBy=${JSON.stringify(w.truncatedBy)} errors=${w.errors} elapsed=${r.elapsedMs}ms`)
  if (r.foreground) console.log(`  foreground: hwnd=${r.foreground.hwnd} isTarget=${r.foreground.isTarget}`)

  const counts = {}
  const seen = new Set()
  for (const c of r.classified ?? []) {
    counts[c.verdict] = (counts[c.verdict] ?? 0) + 1
    if (c.verdict !== 'unknown') seen.add(c.text)
  }
  const found = VERDICT_ORDER.filter((v) => counts[v]).map((v) => `${v}=${counts[v]}`)
  console.log(`  classified: ${found.join('  ')}`)

  // Recall of what the ground truth says should be visible.
  const shouldSee = truth.markers.filter((m) => m.expectVisible).map((m) => m.text)
  const missed = shouldSee.filter((t) => !seen.has(t))
  console.log(`  recall of expectVisible: ${shouldSee.length - missed.length}/${shouldSee.length}` +
    (missed.length ? `  MISSED: ${missed.slice(0, 12).join(' ')}${missed.length > 12 ? ` (+${missed.length - 12})` : ''}` : ''))

  // Contamination: anything read that is not supposed to be visible.
  const contam = (r.classified ?? []).filter((c) => c.verdict !== 'visible' && c.verdict !== 'unknown')
  if (contam.length) {
    const g = {}
    for (const c of contam) (g[c.verdict] ??= []).push(c.text)
    for (const [k, v] of Object.entries(g)) console.log(`  CONTAMINATION ${k} (${v.length}): ${v.slice(0, 8).join(' ')}${v.length > 8 ? ' ...' : ''}`)
  }

  if (r.pixels) {
    const p = r.pixels
    console.log(`  pixels: PrintWindow=${p.printWindowOk} visible=${p.windowVisible} iconic=${p.windowIconic} rect=${JSON.stringify(p.rect)}`)
    let agree = 0, paintedNotExpected = [], expectedNotPainted = [], noSample = 0
    for (const row of p.rows) {
      if (!row.inBitmap && row.samplePointMissing) { noSample++; continue }
      if (row.paintedThere && row.expectVisible) agree++
      else if (row.paintedThere && !row.expectVisible) paintedNotExpected.push(row.text)
      else if (!row.paintedThere && row.expectVisible) expectedNotPainted.push(row.text)
    }
    console.log(`  pixels vs layout: agree(visible&painted)=${agree}` +
      `  painted-but-not-expected=${paintedNotExpected.length}  expected-but-not-painted=${expectedNotPainted.length}`)
    if (paintedNotExpected.length) console.log(`    painted-not-expected: ${paintedNotExpected.slice(0, 10).join(' ')}`)
    if (expectedNotPainted.length) console.log(`    expected-not-painted: ${expectedNotPainted.slice(0, 10).join(' ')}`)
  }
}
