// Quick look at a truth.json produced by testwindow.ps1.
// node inspect-truth.mjs <path-to-truth.json>
import { readFileSync } from 'node:fs'

const t = JSON.parse(readFileSync(process.argv[2], 'utf8'))
console.log('state:', JSON.stringify(t.state))
console.log('w1:', JSON.stringify(t.w1), ' w2:', JSON.stringify(t.w2))

const by = {}
for (const m of t.markers) {
  const k = `${m.region}/${m.declared}${m.expectVisible ? ' [VISIBLE]' : ''}`
  by[k] = (by[k] ?? 0) + 1
}
console.log('\nmarkers by region/declared:')
for (const [k, v] of Object.entries(by).sort()) console.log(`  ${k.padEnd(38)} ${v}`)

const vis = t.markers.filter((m) => m.expectVisible)
console.log(`\nexpectVisible: ${vis.length} / ${t.markers.length}`)
console.log('  ' + vis.map((m) => m.text).join(' '))

for (const name of ['GT-HDR-0001', 'GT-A-0001', 'GT-A-0030', 'GT-A-0060', 'GT-SIDE-0001', 'GT-B-0001']) {
  const m = t.markers.find((x) => x.text === name)
  if (m) console.log(`  ${name}: expect=${m.expectVisible} inViewport=${m.inViewport} vis=${m.isVisibleWpf} op=${m.effectiveOpacity} pt=${JSON.stringify(m.samplePoint)} rgb=${JSON.stringify(m.rgb)}`)
}
