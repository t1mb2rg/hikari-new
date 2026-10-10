// HIKARI D0 ground-truth experiment — driver.
//
// Brings up the controlled test window, then for each state in the matrix:
//   1. issues the state change over the file command channel and waits for its ack
//   2. runs the UIA probe (one process per read strategy)
//   3. saves the read next to the ground truth that was true at that moment
//
// Every probe runs in its own process so a hang can be killed by the driver rather than
// taking the run down with it. That is what makes the "app refuses to answer" case testable.
//
// Usage: node run.mjs <outDir> [--keep]
//
// Synthetic content only. No real application is ever driven.

import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, copyFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const POWERSHELL = 'powershell.exe'
const PS_FLAGS = ['-NoProfile', '-NonInteractive', '-File']

const outDir = resolve(process.argv[2] ?? join(HERE, 'out'))
const keep = process.argv.includes('--keep')
mkdirSync(outDir, { recursive: true })

const work = join(outDir, 'channel')
mkdirSync(work, { recursive: true })
// Reusing an out/ dir must not reuse its channel. A leftover ready.json from a previous run makes
// startWindow return instantly with a DEAD handle, and a leftover truth.json silently becomes the
// baseline everything is matched against. Both failures look like probe bugs and are not.
for (const f of ['ready.json', 'ack.json', 'cmd.json', 'truth.json', 'focus.json']) {
  try { rmSync(join(work, f)) } catch { }
}
const cmdPath = join(work, 'cmd.json')
const ackPath = join(work, 'ack.json')
const readyPath = join(work, 'ready.json')
const truthPath = join(work, 'truth.json')
const focusPath = join(work, 'focus.json')

const results = []
let child = null
let focusChild = null

function log(...a) { console.log(...a) }

function psRun(args, timeoutMs) {
  return new Promise((resolvePromise) => {
    const p = spawn(POWERSHELL, [...PS_FLAGS, ...args], { windowsHide: true })
    let out = '', err = ''
    let killed = false
    const t = setTimeout(() => { killed = true; try { p.kill() } catch { } }, timeoutMs)
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { err += d })
    p.on('close', (code) => {
      clearTimeout(t)
      resolvePromise({ code, out, err, killed, timedOut: killed })
    })
  })
}

async function startWindow(withSecond) {
  const args = [join(HERE, 'testwindow.ps1'), '-WorkDir', work, '-Seconds', '3600']
  if (withSecond) args.push('-WithSecondWindow')
  child = spawn(POWERSHELL, ['-NoProfile', '-NonInteractive', '-STA', '-File', ...args], { windowsHide: true })
  child.stderr.on('data', (d) => { const s = String(d); if (s.trim()) log('  [window-stderr]', s.trim()) })
  for (let i = 0; i < 100; i++) {
    await sleep(200)
    if (existsSync(readyPath)) {
      const r = JSON.parse(readFileSync(readyPath, 'utf8'))
      if (r.w1) return r
    }
  }
  throw new Error('test window never became ready')
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

let cmdId = 0
async function command(op, extra = {}, waitMs = 15000) {
  cmdId++
  const id = cmdId
  if (existsSync(ackPath)) rmSync(ackPath)
  writeFileSync(cmdPath, JSON.stringify({ id, op, ...extra }))
  const deadline = Date.now() + waitMs
  while (Date.now() < deadline) {
    await sleep(100)
    if (!existsSync(ackPath)) continue
    try {
      const ack = JSON.parse(readFileSync(ackPath, 'utf8'))
      if (ack.id === id) return ack
    } catch { }
  }
  throw new Error(`no ack for ${op} (id=${id})`)
}

function truthNow() { return JSON.parse(readFileSync(truthPath, 'utf8')) }

// A state change is applied to the WPF object model inside the command tick, but WPF does not
// lay the change out until the dispatcher goes idle. The ack is therefore written with
// PRE-CHANGE geometry (a scroll acked at offset 0, a tab switch whose content is not yet
// realized). Settle, then re-snapshot: everything the probe is matched against must be the
// truth that holds while the probe runs, not the truth that held one layout pass earlier.
async function settleAndResync(expect = {}) {
  await sleep(900)
  const ack = await command('truth')
  const drift = []
  for (const [k, v] of Object.entries(expect)) {
    if (ack[k] !== undefined && ack[k] !== v) drift.push(`${k}: wanted ${v}, acked ${ack[k]}`)
  }
  if (drift.length) log(`  !! state did not match intent: ${drift.join('; ')}`)
  return ack
}

async function probe(hwnd, strategy, opts = {}) {
  const args = [join(HERE, 'probe.ps1'), '-Hwnd', String(hwnd), '-Strategy', strategy,
    '-MaxDepth', String(opts.maxDepth ?? 40), '-MaxNodes', String(opts.maxNodes ?? 4000),
    '-InventoryPath', truthPath]
  if (opts.pixels) args.push('-PixelProbe')
  const r = await psRun(args, opts.timeoutMs ?? 120000)
  let parsed = null
  if (r.out && r.out.trim()) { try { parsed = JSON.parse(r.out.trim()) } catch { } }
  return {
    strategy, timedOut: r.timedOut, exitCode: r.code,
    stderr: r.err.trim().slice(0, 800),
    result: parsed,
    rawOut: parsed ? undefined : r.out.slice(0, 800),
  }
}

async function captureState(name, hwnd, { strategies = ['control', 'raw', 'content', 'targeted'], pixels = true } = {}) {
  const truth = truthNow()
  copyFileSync(truthPath, join(outDir, `truth-${name}.json`))
  log(`  truth: tab=${truth.state.selectedTab} mainOffset=${truth.state.mainOffset} edit=${truth.state.editText} ` +
    `expectVisible=${truth.markers.filter((m) => m.expectVisible).length} expectPartial=${truth.markers.filter((m) => m.expectPartial).length}`)
  const reads = {}
  for (const s of strategies) {
    const r = await probe(hwnd, s, { pixels: pixels && s === 'control' })
    reads[s] = r
    writeFileSync(join(outDir, `read-${name}-${s}.json`), JSON.stringify(r, null, 2))
  }
  const rec = { state: name, truth: truth.state, truthFile: `truth-${name}.json`, reads: {} }
  for (const [k, v] of Object.entries(reads)) {
    rec.reads[k] = v.result
      ? { ok: true, walk: v.result.walk, elapsedMs: v.result.elapsedMs, timedOut: v.timedOut }
      : { ok: false, timedOut: v.timedOut, exitCode: v.exitCode, stderr: v.stderr, rawOut: v.rawOut }
  }
  results.push(rec)
  const c = rec.reads.control
  log(`  ${name.padEnd(16)} control: ${c.ok ? `nodes=${c.walk.nodes} textChars=${c.walk.textChars} trunc=${JSON.stringify(c.walk.truncatedBy)} ${c.elapsedMs}ms` : `FAILED timedOut=${c.timedOut}`}`)
  return rec
}

// ------------------------------------------------------------------ run

log('starting controlled test window (with second window)')
const ready = await startWindow(true)
const W1 = ready.w1
const W2 = ready.w2
log(`  W1 hwnd=${W1}  W2 hwnd=${W2}`)

try {
  // --- state 1: baseline, Alpha tab at offset 0
  log('\n[1] baseline')
  await captureState('baseline', W1)

  // --- state 2: scrolled
  log('\n[2] scrolled to offset 400')
  await command('scroll', { target: 'main', offset: 400 })
  await settleAndResync({ mainOffset: 400 })
  await captureState('scrolled', W1)

  // --- state 3: Bravo tab
  log('\n[3] Bravo tab selected')
  await command('selectTab', { index: 1 })
  await settleAndResync({ selectedTab: 1 })
  await captureState('tab-bravo', W1)

  // --- state 4: Hidden tab (collapsed / hidden / zero-opacity)
  log('\n[4] Hidden tab selected')
  await command('selectTab', { index: 2 })
  await settleAndResync({ selectedTab: 2 })
  await captureState('tab-hidden', W1)

  // --- state 5: back to Alpha, edit the text box
  log('\n[5] Alpha, edited text box')
  await command('selectTab', { index: 0 })
  await command('scroll', { target: 'main', offset: 0 })
  await command('edit', { text: 'GT-EDIT-CHANGED-0002' })
  await settleAndResync({ selectedTab: 0, mainOffset: 0, editText: 'GT-EDIT-CHANGED-0002' })
  await captureState('edited', W1)

  // --- state 6: shallow depth -> truncation must be distinguishable from emptiness
  log('\n[6] shallow maxDepth=2')
  await captureState('shallow', W1, { strategies: ['control'], pixels: false })
  {
    const r = await probe(W1, 'control', { maxDepth: 2, pixels: false })
    writeFileSync(join(outDir, 'read-shallow-deep2-control.json'), JSON.stringify(r, null, 2))
    log(`  deep-2 control: ${r.result ? `nodes=${r.result.walk.nodes} chars=${r.result.walk.textChars} trunc=${JSON.stringify(r.result.walk.truncatedBy)}` : 'FAILED'}`)
  }

  // --- state 7: minimized
  log('\n[7] minimized')
  await command('minimize')
  await settleAndResync()
  await captureState('minimized', W1, { strategies: ['control'], pixels: true })
  await command('restore')
  await settleAndResync()

  // --- state 8: foreign process holds the global focus
  log('\n[8] foreign focus holder')
  focusChild = spawn(POWERSHELL, ['-NoProfile', '-NonInteractive', '-STA', '-File',
    join(HERE, 'focuswindow.ps1'), '-WorkDir', work, '-Seconds', '1200'], { windowsHide: true })
  focusChild.stderr.on('data', (d) => { const s = String(d); if (s.trim()) log('  [focus-stderr]', s.trim()) })
  for (let i = 0; i < 60; i++) { await sleep(250); if (existsSync(focusPath)) break }
  let focusInfo = null
  if (existsSync(focusPath)) { try { focusInfo = JSON.parse(readFileSync(focusPath, 'utf8')) } catch { } }
  log(`  focus holder: ${focusInfo ? `hwnd=${focusInfo.hwnd} isForeground=${focusInfo.isForeground} marker=${focusInfo.marker}` : 'NOT UP'}`)
  {
    const r = await probe(W1, 'focused', { pixels: false })
    writeFileSync(join(outDir, 'read-foreign-focus-focused.json'), JSON.stringify(r, null, 2))
    const w = r.result?.walk
    log(`  focused strategy on W1: ${r.result ? `owningHwnd=${w.owningHwnd} isThisWindow=${w.isThisWindow} textEls=${w.textEls} textChars=${w.textChars}` : 'FAILED'}`)
    // The same global element must come back no matter WHICH window handle you hand the probe.
    // That is what makes it global rather than per-window, and it is the property that has to be
    // checked before any of its text may be attributed to a window.
    const r2 = await probe(W2, 'focused', { pixels: false })
    writeFileSync(join(outDir, 'read-foreign-focus-focused-w2.json'), JSON.stringify(r2, null, 2))
    const w2 = r2.result?.walk
    log(`  focused strategy on W2: ${r2.result ? `owningHwnd=${w2.owningHwnd} isThisWindow=${w2.isThisWindow}` : 'FAILED'}  (W2 hwnd=${W2})`)
  }

  // --- state 8b: a handle that is not a readable window at all. "Cannot read" must not look
  //     like "read nothing".
  {
    const r = await probe(1, 'control', { pixels: false })
    writeFileSync(join(outDir, 'read-invalid-handle-control.json'), JSON.stringify(r, null, 2))
    log(`  invalid handle 1: ${r.result ? `ok=${r.result.ok} error=${JSON.stringify(r.result.error)}` : `FAILED timedOut=${r.timedOut}`}`)
  }

  // --- state 9: UI thread stalled (the controlled stand-in for "the app will not answer")
  log('\n[9] UI thread stalled for 12s, probe timeout 6s')
  command('block', { ms: 12000 }).catch(() => { })
  await sleep(700)
  {
    const r = await probe(W1, 'control', { pixels: false, timeoutMs: 6000 })
    writeFileSync(join(outDir, 'read-blocked-control.json'), JSON.stringify(r, null, 2))
    log(`  control during stall: timedOut=${r.timedOut} exitCode=${r.exitCode} parsed=${!!r.result}`)
    const r2 = await probe(W1, 'focused', { pixels: false, timeoutMs: 6000 })
    writeFileSync(join(outDir, 'read-blocked-focused.json'), JSON.stringify(r2, null, 2))
    log(`  focused during stall: timedOut=${r2.timedOut} exitCode=${r2.exitCode} parsed=${!!r2.result}`)
  }
  await sleep(13000)

  // --- state 10: read W1 while W2 is up, to look for cross-window leakage
  log('\n[10] cross-window check (W2 exists)')
  {
    const r = await probe(W1, 'raw', { pixels: false })
    writeFileSync(join(outDir, 'read-crosswindow-raw.json'), JSON.stringify(r, null, 2))
    log(`  raw on W1: ${r.result ? `nodes=${r.result.walk.nodes}` : 'FAILED'}`)
  }

  writeFileSync(join(outDir, 'results.json'), JSON.stringify({ W1, W2, focusInfo, results }, null, 2))
  log('\nwrote results.json')
} finally {
  try { await command('quit', {}, 5000) } catch { }
  await sleep(800)
  for (const c of [child, focusChild]) {
    if (c && !c.killed) { try { c.kill() } catch { } }
  }
  if (!keep) { /* channel dir is small; keep it, it is the ground truth the reads were matched against */ }
}
