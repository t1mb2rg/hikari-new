// Re-anchors every claim the D0 report will make, against the artifacts on disk.
// node verify-claims.mjs out
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const out = process.argv[2] ?? 'out'
const j = (p) => JSON.parse(readFileSync(join(out, p), 'utf8'))
const has = (p) => existsSync(join(out, p))
const R = (s, st) => (has(`read-${s}-${st}.json`) ? j(`read-${s}-${st}.json`).result : null)
const T = (s) => j(`truth-${s}.json`)

let ok = 0, bad = 0
function claim(text, cond, detail = '') {
  if (cond) { ok++; console.log(`  PASS  ${text}${detail ? `   [${detail}]` : ''}`) }
  else { bad++; console.log(`  FAIL  ${text}${detail ? `   [${detail}]` : ''}`) }
}
const H = (s) => console.log(`\n### ${s}`)

const STATES = ['baseline', 'scrolled', 'tab-bravo', 'tab-hidden', 'edited', 'shallow', 'minimized']
const distinctRead = (s, st) => new Set((R(s, st)?.classified ?? []).filter((c) => c.verdict !== 'unknown').map((c) => c.text))

// ---------------------------------------------------------------- C1 scroll invariance
H('C1  Scrolling does not change WHAT the walk returns')
{
  const a = distinctRead('baseline', 'control')
  const b = distinctRead('scrolled', 'control')
  const onlyA = [...a].filter((x) => !b.has(x))
  const onlyB = [...b].filter((x) => !a.has(x))
  claim('baseline and scrolled return the same marker set', onlyA.length === 0 && onlyB.length === 0,
    `only-in-baseline=${onlyA.length} only-in-scrolled=${onlyB.length}`)
  // ...while the ground truth for those same rows flipped.
  const ta = T('baseline'), tb = T('scrolled')
  const va = new Set(ta.markers.filter((m) => m.expectVisible).map((m) => m.text))
  const vb = new Set(tb.markers.filter((m) => m.expectVisible).map((m) => m.text))
  const flipped = [...va].filter((x) => !vb.has(x))
  claim('ground truth DID change across the same scroll', flipped.length > 0, `${flipped.length} rows left the viewport: ${flipped.slice(0, 4).join(' ')}...`)
}

// ---------------------------------------------------------------- C2 hidden classes
H('C2  Hidden content is returned by every walker; only one class is flagged offscreen')
{
  for (const st of ['control', 'raw', 'content', 'targeted']) {
    const d = distinctRead('tab-hidden', st)
    const got = ['GT-H-COLLAPSED-0001', 'GT-H-HIDDEN-0001', 'GT-H-ZEROOPACITY-0001'].filter((x) => d.has(x))
    claim(`tab-hidden/${st} returns all 3 hidden-class markers`, got.length === 3, got.join(' '))
  }
  // The zero-opacity row is the one UIA cannot distinguish from visible content.
  const px = R('tab-hidden', 'control').pixels.rows
  const zo = px.find((r) => r.text === 'GT-H-ZEROOPACITY-0001')
  claim('GT-H-ZEROOPACITY-0001 is NOT painted', zo && zo.inBitmap && !zo.paintedThere, `inBitmap=${zo?.inBitmap} painted=${zo?.paintedThere}`)
  const cls = new Map((R('tab-hidden', 'control').classified ?? []).map((c) => [c.text, c]))
  claim('...yet UIA reports IsOffscreen=false for it', cls.get('GT-H-ZEROOPACITY-0001')?.uiaOffscreen === false)
  claim('...and the collapsed row IS flagged', cls.get('GT-H-COLLAPSED-0001')?.uiaOffscreen === true)
  claim('...and the hidden row IS flagged', cls.get('GT-H-HIDDEN-0001')?.uiaOffscreen === true)
}

// ---------------------------------------------------------------- C3 IsOffscreen has no false positives, many false negatives
H('C3  IsOffscreen')
{
  for (const s of STATES) {
    const r = R(s, 'control')
    if (!r?.pixels) continue
    const pxs = new Map(r.pixels.rows.map((x) => [x.text, x]))
    const uia = new Map((r.classified ?? []).filter((c) => c.verdict !== 'unknown').map((c) => [c.text, c]))
    let paintedButOff = 0, notPaintedButOn = 0, judged = 0
    for (const m of T(s).markers) {
      const p = pxs.get(m.text), u = uia.get(m.text)
      if (!p || !p.inBitmap || p.region === 'inputs') continue
      judged++
      if (u?.uiaOffscreen === true && p.paintedThere) paintedButOff++
      if (u?.uiaOffscreen === false && !p.paintedThere) notPaintedButOn++
    }
    claim(`${s}: no row is IsOffscreen=true while painted`, paintedButOff === 0, `judged=${judged}`)
    console.log(`        ${s}: IsOffscreen=false while NOT painted = ${notPaintedButOn}`)
  }
  // What the flag actually selects, on a tab where hidden content is present and on one where it is not.
  const offT = R('tab-hidden', 'control').walk.offscreenSample
  const offB = R('baseline', 'control').walk.offscreenSample
  claim('on the Hidden tab the flag selects exactly the collapsed and hidden rows (plus unnamed scrollbars)',
    offT.some((o) => o.name === 'GT-H-COLLAPSED-0001') && offT.some((o) => o.name === 'GT-H-HIDDEN-0001') &&
    offT.filter((o) => o.controlType !== 'ControlType.ScrollBar').length === 2,
    offT.map((o) => o.name || o.controlType).join(' | '))
  claim('...and never the zero-opacity row', !offT.some((o) => o.name === 'GT-H-ZEROOPACITY-0001'))
  claim('on the baseline tab the flag selects only unnamed scrollbars',
    offB.length > 0 && offB.every((o) => o.controlType === 'ControlType.ScrollBar' && o.name === ''),
    offB.map((o) => o.controlType).join(','))
  claim('no scrolled-out row is ever flagged (60 rows below the viewport at offset 0)',
    !offB.some((o) => /^GT-A-\d/.test(o.name)), `${offB.filter((o) => /^GT-A-/.test(o.name)).length} flagged`)
}

// ---------------------------------------------------------------- C4 text channel
H('C4  Where the body text actually lives')
{
  const r = R('baseline', 'control')
  claim('exactly one element in the window exposes TextPattern', r.walk.textEls === 1, `textEls=${r.walk.textEls}`)
  claim('that element yields 15 characters', r.walk.textChars === 15, `textChars=${r.walk.textChars}`)
  claim('the walk returns 97 nodes, 82 of them named with no TextPattern',
    r.walk.nodes === 97 && r.walk.named === 82 && r.walk.namedNoText === 82,
    `nodes=${r.walk.nodes} named=${r.walk.named} namedNoText=${r.walk.namedNoText}`)
  const want = T('baseline').markers.filter((m) => m.expectVisible).length
  claim('...while the ground truth says 38 markers are visible', want === 38, `expectVisible=${want}`)
  const src = {}
  for (const c of r.classified ?? []) if (c.verdict !== 'unknown') src[c.source] = (src[c.source] ?? 0) + 1
  claim('body text arrives through Name, not TextPattern', (src.Name ?? 0) > 30 && (src.TextPattern ?? 0) <= 1, JSON.stringify(src))
}

// ---------------------------------------------------------------- C5 edit / tab follow
H('C5  Edits and tab switches ARE reflected')
{
  const a = distinctRead('baseline', 'control'), b = distinctRead('edited', 'control')
  claim('edit changed the read', a.has('GT-EDIT-INITIAL') && !b.has('GT-EDIT-INITIAL') && b.has('GT-EDIT-CHANGED-0002'))
  claim('edited read carries the new value', R('edited', 'control').walk.textChars === 20)
  const tc = distinctRead('tab-bravo', 'control')
  claim('after switching to Bravo, no Alpha content remains', ![...tc].some((x) => /^GT-A-\d/.test(x) || /^GT-SIDE-/.test(x)))
  claim('after switching to Bravo, all 40 Bravo rows are returned',
    [...tc].filter((x) => /^GT-B-\d/.test(x)).length === 40, `${[...tc].filter((x) => /^GT-B-\d/.test(x)).length}`)
  const th = distinctRead('tab-hidden', 'control')
  claim('after switching to Hidden, no Bravo content remains', ![...th].some((x) => /^GT-B-\d/.test(x)))
  claim('inactive tabs are invisible to the walk', ![...tc].some((x) => /^GT-H-/.test(x)))
}

// ---------------------------------------------------------------- C6 attribution
H('C6  Attribution')
{
  for (const s of STATES.concat(['crosswindow'])) {
    for (const st of ['control', 'raw', 'content', 'targeted']) {
      const r = R(s, st); if (!r) continue
      const all = (r.markers ?? []).map((m) => m.text).join('\n')
      if (/GT-W2-|GT-FOCUS-/.test(all)) { claim(`${s}/${st} carries no foreign marker`, false, all.match(/GT-(W2|FOCUS)-[A-Z0-9]+/g).join(',')) }
    }
  }
  claim('no read of W1 carries a W2 or focus-holder marker', true)
  const f1 = j('read-foreign-focus-focused.json').result
  const f2 = j('read-foreign-focus-focused-w2.json').result
  claim('FocusedElement returns the same foreign window regardless of the handle passed',
    f1.walk.owningHwnd === f2.walk.owningHwnd && f1.walk.owningHwnd !== f1.hwnd && f2.walk.owningHwnd !== f2.hwnd,
    `W1->${f1.walk.owningHwnd}  W2->${f2.walk.owningHwnd}`)
  claim('both report isThisWindow=false', f1.walk.isThisWindow === false && f2.walk.isThisWindow === false)
  claim('foreign text was counted but not stored',
    f1.walk.textChars === 0 && (f1.walk.foreignTextChars ?? 0) > 0 && f1.markers.length === 0,
    `own=${f1.walk.textChars} foreign=${f1.walk.foreignTextChars}`)
}

// ---------------------------------------------------------------- C7 failure modes are distinguishable
H('C7  Empty / truncated / refused are distinguishable')
{
  const norm = R('baseline', 'control')
  const trunc = j('read-shallow-deep2-control.json').result
  const tgt = R('baseline', 'targeted')
  const blk = j('read-blocked-control.json')
  const inv = j('read-invalid-handle-control.json')
  claim('normal read: ok, nodes>0, truncatedBy empty', norm.ok === true && norm.walk.nodes === 97 && norm.walk.truncatedBy === '')
  claim('truncated read: ok, truncatedBy=depth, far fewer nodes', trunc.walk.truncatedBy === 'depth' && trunc.walk.nodes === 11, `nodes=${trunc.walk.nodes}`)
  claim('no-text read: ok, many nodes, ZERO characters', tgt.walk.nodes === 77 && tgt.walk.textChars === 0, `nodes=${tgt.walk.nodes} chars=${tgt.walk.textChars}`)
  claim('refused read (UI thread stalled): timed out, no output at all', blk.timedOut === true && !blk.result && !blk.rawOut, `exit=${blk.exitCode}`)
  claim('unreadable handle: non-zero exit, no output', inv.timedOut === false && inv.exitCode !== 0 && !inv.result, `exit=${inv.exitCode}`)
  console.log(`        refused  -> timedOut=${blk.timedOut} exit=${blk.exitCode} stdout=${JSON.stringify((blk.rawOut ?? '').slice(0, 40))} stderr=${JSON.stringify((blk.stderr ?? '').slice(0, 60))}`)
  console.log(`        bad hwnd -> timedOut=${inv.timedOut} exit=${inv.exitCode} stdout=${JSON.stringify((inv.rawOut ?? '').slice(0, 40))} stderr=${JSON.stringify((inv.stderr ?? '').slice(0, 90))}`)
}

// ---------------------------------------------------------------- C8 minimized
H('C8  Minimized')
{
  const r = R('minimized', 'control')
  // `shallow` is the same state (tab 0, offset 0, edited text) read with the window NOT minimized.
  const b = R('shallow', 'control')
  claim('the content read is identical to the same state with the window restored',
    r.walk.nodes === b.walk.nodes && r.walk.textChars === b.walk.textChars && r.walk.offscreenNodes === b.walk.offscreenNodes,
    `minimized nodes=${r.walk.nodes} chars=${r.walk.textChars} off=${r.walk.offscreenNodes} | restored same`)
  claim('and the only difference between the two reads is the WindowPattern state',
    r.window.visualState === 'Minimized' && b.window.visualState === 'Normal',
    `${b.window.visualState} -> ${r.window.visualState}`)
  claim('the root element still reports IsOffscreen=false while minimized', r.window.rootOffscreen === false)
  claim('but WindowPattern DOES report Minimized', r.window.visualState === 'Minimized', JSON.stringify(r.window))
  claim('baseline reports Normal from the same property', b.window.visualState === 'Normal')
  claim('pixel evidence is unavailable when minimized (capture is a stub)',
    r.pixels.rect[2] === 160 && r.pixels.rect[3] === 28 && r.pixels.windowIconic === true, JSON.stringify(r.pixels.rect))
}

// ---------------------------------------------------------------- C9 walker differences
H('C9  ControlView vs RawView vs ContentView')
{
  const c = R('baseline', 'control'), rw = R('baseline', 'raw'), ct = R('baseline', 'content')
  claim('all three return the same marker set', (() => {
    const a = distinctRead('baseline', 'control'), b = distinctRead('baseline', 'raw'), d = distinctRead('baseline', 'content')
    return a.size === b.size && a.size === d.size && [...a].every((x) => b.has(x) && d.has(x))
  })(), `control=${c.walk.nodes} raw=${rw.walk.nodes} content=${ct.walk.nodes} nodes`)
  claim('all three return the scrolled-out rows', [c, rw, ct].every((x) => (x.classified ?? []).some((k) => k.verdict === 'SCROLLED-OUT')))
  claim('ContentView is the only one that drops the offscreen nodes', c.walk.offscreenNodes === 5 && rw.walk.offscreenNodes === 5 && ct.walk.offscreenNodes === 0,
    `control=${c.walk.offscreenNodes} raw=${rw.walk.offscreenNodes} content=${ct.walk.offscreenNodes}`)
  claim('ContentView drops non-content scaffolding only', ct.walk.nodes < c.walk.nodes,
    `-${c.walk.nodes - ct.walk.nodes} nodes; textChars unchanged (${ct.walk.textChars})`)
}

// ---------------------------------------------------------------- C10 partial visibility
H('C10 Partial visibility is its own state')
{
  const r = R('baseline', 'control')
  const px = new Map(r.pixels.rows.map((x) => [x.text, x]))
  const cls = new Map((r.classified ?? []).map((c) => [c.text, c]))
  const t = T('baseline').markers.filter((m) => m.expectPartial)
  claim('exactly one row is half-in-viewport at offset 0', t.length === 1, t.map((m) => m.text).join(' '))
  const name = t[0]?.text
  claim(`${name} is provably painted`, px.get(name)?.paintedThere === true)
  claim(`${name} is NOT counted as fully visible by layout`, cls.get(name)?.expectVisible === false)
  claim(`${name} is reported IsOffscreen=false`, cls.get(name)?.uiaOffscreen === false)
  claim(`${name} gets its own verdict, not NOT-EXPECTED`, cls.get(name)?.verdict === 'PARTIAL-AT-EDGE', cls.get(name)?.verdict)
}

// ---------------------------------------------------------------- C10b can a reader derive visibility?
H('C10b Can a reader derive "on screen" from UIA alone? Three candidate rules vs the pixels')
// The rules are computed from UIA properties ONLY, so a disagreement is a limitation of the rule.
// Pixels come from PrintWindow, which is the only channel here that does not go through UIA.
// Rows that straddle the clip edge are counted separately: WPF calls them partial, the pixel probe
// samples one point, and the rule can land either side, so they are an honest ambiguity class and
// not scored as rule errors. See visibility-rule.mjs for the same measurement as a standalone run.
{
  const area = (r) => (!r || r.empty || r.error ? 0 : Math.max(0, r.w) * Math.max(0, r.h))
  const overlapArea = (a, b) => {
    if (!a || !b || a.empty || b.empty || a.error || b.error) return 0
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
    return w > 0 && h > 0 ? w * h : 0
  }
  const tot = { R1: [0, 0, 0], R2: [0, 0, 0], R3: [0, 0, 0] } // [falseON, falseOFF, agree] on unambiguous rows
  const residual = []
  for (const s of STATES) {
    const r = R(s, 'control')
    if (!r || !r.pixels || !r.clientOnScreen) continue
    // A minimized window's capture is a stub, so "not painted" there is an artefact of the capture
    // rather than evidence. Scoring it would credit the rules with agreeing on a vacuous row.
    if (r.pixels.windowIconic) continue
    const cl = r.clientOnScreen
    const pxs = new Map(r.pixels.rows.filter((x) => x.inBitmap && x.region !== 'inputs').map((x) => [x.text, x]))
    const per = { R1: [0, 0, 0], R2: [0, 0, 0], R3: [0, 0, 0] }
    for (const m of T(s).markers) {
      if (m.expectPartial) continue
      const mr = (r.markers ?? []).find((x) => x.text === m.text)
      const p = pxs.get(m.text)
      if (!p || !mr || mr.isOffscreen) continue // IsOffscreen is an input to every rule
      const anc = mr.ancestors ?? []
      const scroll = (anc.find((a) => a.scrollable) ?? {}).rect ?? null
      const rules = {
        R1: overlapArea(mr.rect, cl) > 0,                                  // window client area
        R2: overlapArea(mr.rect, scroll ?? cl) > 0,                        // nearest scrollable ancestor
        R3: anc.length ? anc.every((a) => overlapArea(mr.rect, a.rect) > 0) // every raw ancestor
          : overlapArea(mr.rect, cl) > 0,
      }
      for (const [k, v] of Object.entries(rules)) {
        if (v === p.paintedThere) { per[k][2]++; continue }
        if (v) per[k][0]++; else per[k][1]++
        if (k === 'R2' && v) residual.push(`${s}:${m.text}`)
      }
    }
    for (const k of Object.keys(tot)) { for (let i = 0; i < 3; i++) tot[k][i] += per[k][i] }
    console.log(`        ${s.padEnd(11)} agree  R1=${per.R1[2]}  R2=${per.R2[2]}  R3=${per.R3[2]}   false-ON/false-OFF  R1=${per.R1[0]}/${per.R1[1]}  R2=${per.R2[0]}/${per.R2[1]}  R3=${per.R3[0]}/${per.R3[1]}`)
  }
  const N = (r) => tot[r][0] + tot[r][1] + tot[r][2]
  claim('the rules were judged on 136 rows with unambiguous visibility',
    N('R1') === 136 && N('R2') === 136 && N('R3') === 136, `R1=${N('R1')} R2=${N('R2')} R3=${N('R3')}`)
  claim('R1 (client area) agrees on 129/136', tot.R1[2] === 129, `${tot.R1[2]}/${N('R1')}`)
  claim('R2 (nearest scrollable ancestor) agrees on 135/136', tot.R2[2] === 135, `${tot.R2[2]}/${N('R2')}`)
  claim('R3 (every ancestor) agrees on only 12/136', tot.R3[2] === 12, `${tot.R3[2]}/${N('R3')}`)
  // The obvious rule -- "is the reported rectangle inside the window's client area?" -- is WRONG.
  // It has no false negatives, but it claims on-screen for rows an ancestor clip has removed.
  claim('the naive rule (rect inside the client area) over-claims visibility',
    tot.R1[0] > 0 && tot.R1[1] === 0, `false-ON=${tot.R1[0]} false-OFF=${tot.R1[1]}`)
  // Clipping by the nearest SCROLLABLE ancestor is the rule that works: it carries the scroll offset,
  // which the client area does not, and it is reachable with TreeWalker.GetParent + BoundingRectangle.
  claim('clipping by the nearest scrollable ancestor has only the zero-opacity row left wrong',
    tot.R2[0] === 1 && tot.R2[1] === 0, `false-ON=${tot.R2[0]} false-OFF=${tot.R2[1]}`)
  claim('...and that one row is GT-H-ZEROOPACITY-0001',
    residual.length === 1 && residual[0].endsWith('GT-H-ZEROOPACITY-0001'), residual.join(','))
  // The intuitive strengthening -- intersect EVERY ancestor -- is refuted, because the raw tree's
  // parent of the scroll pane is a TabItem whose BoundingRectangle is only the 49x21 tab HEADER.
  claim('clipping by every ancestor is refuted', tot.R3[1] > 50, `false-OFF=${tot.R3[1]}`)
  const bh = R('tab-hidden', 'control')
  const collapsed = (bh.markers ?? []).find((x) => x.text === 'GT-H-COLLAPSED-0001')
  claim('a collapsed element reports an EMPTY bounding rectangle (read while its tab is active)',
    collapsed?.rect?.empty === true, JSON.stringify(collapsed?.rect))
  const b = R('baseline', 'control')
  claim('the main scrolling region exposes its scroll state through UIA', (() => {
    const sc = (b.scrollables ?? []).find((x) => x.verticallyScrollable)
    return sc && typeof sc.verticalScrollPercent === 'number' && sc.verticalViewSize > 0 && sc.verticalViewSize < 100
  })(), JSON.stringify((b.scrollables ?? []).find((x) => x.verticallyScrollable)))
  const s2 = R('scrolled', 'control')
  const sc0 = (b.scrollables ?? []).find((x) => x.verticallyScrollable)
  const sc1 = (s2.scrollables ?? []).find((x) => x.verticallyScrollable)
  claim('...and that state CHANGES when the region is scrolled',
    sc1 && sc1.verticalScrollPercent > sc0.verticalScrollPercent,
    `${sc0?.verticalScrollPercent} -> ${sc1?.verticalScrollPercent}`)
}

// ---------------------------------------------------------------- C11 the a11y-only box
H('C11 The visible-but-absent element')
{
  for (const s of ['baseline', 'edited']) {
    const d = distinctRead(s, 'control')
    claim(`${s}: GT-A11YONLY-0001 is never returned by any walker`, !d.has('GT-A11YONLY-0001'))
  }
  const t = T('baseline').markers.find((m) => m.text === 'GT-A11YONLY-0001')
  claim('...although the ground truth marks it visible with an assigned AutomationProperties.Name',
    t && t.expectVisible === true && t.declared === 'automation-name-only', `declared=${t?.declared} expect=${t?.expectVisible}`)
}

// ---------------------------------------------------------------- C12 the double-name button
H('C12 One control, two strings, one channel')
{
  const r = R('baseline', 'control')
  const a = r.markers.filter((m) => m.text === 'GT-NAMEONLY-A11Y')
  const b = r.markers.filter((m) => m.text === 'GT-NAMEONLY-BTN')
  claim('the button contributes two distinct strings', a.length > 0 && b.length > 0)
  claim('the assigned accessibility name arrives as ControlType.Button', a[0].controlType === 'ControlType.Button')
  claim('the visible content arrives as a separate ControlType.Text child', b[0].controlType === 'ControlType.Text')
  claim('both arrive through the SAME channel', a[0].source === 'Name' && b[0].source === 'Name', `${a[0].source}/${b[0].source}`)
  const d = distinctRead('baseline', 'control')
  claim('the visible content string is NOT in the inventory, so it lands in unknown',
    !T('baseline').markers.some((m) => m.text === 'GT-NAMEONLY-BTN'))
}

console.log(`\n${'='.repeat(70)}\n  ${ok} PASS, ${bad} FAIL\n${'='.repeat(70)}`)
process.exit(bad ? 1 : 0)
