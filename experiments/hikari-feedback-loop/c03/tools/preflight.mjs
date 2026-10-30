/**
 * C-03 preflight checks: 12-run isolation, leakage, fixture consistency,
 * and the agent-visible-surface neutrality check.
 *
 * Usage: node preflight.mjs [--json]
 *
 * Exits non-zero if any check fails. Never starts a model instance.
 *
 * The condition mapping is read from fixtures/runs/manifest.json, which lives
 * outside every run workspace and is never readable by the experiment agent.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = resolve(here, '..', 'fixtures')

const CONDITION_WORDS = ['a1', 'b1', 'a2', 'b2']
const EXPERIMENT_WORDS = ['c03', 'readscope', 'protocol', 'preflight', 'hikari-feedback-loop', 'mutation', 'experiment']

function read(path) {
  return readFileSync(path, 'utf8')
}
function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

const manifestPath = join(fixtures, 'runs', 'manifest.json')
const manifest = existsSync(manifestPath) ? JSON.parse(read(manifestPath)) : null
const runs = manifest?.runs ?? []

const checks = []
function check(name, fn) {
  try {
    checks.push({ name, ok: true, detail: fn() })
  } catch (error) {
    checks.push({ name, ok: false, detail: error.message })
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message)
}

check('run manifest exists with twelve runs, three per condition', () => {
  assert(manifest !== null, `missing ${manifestPath} — run make-fixtures.mjs first`)
  assert(runs.length === 12, `expected 12 runs, got ${runs.length}`)
  const counts = new Map()
  for (const run of runs) counts.set(run.condition, (counts.get(run.condition) ?? 0) + 1)
  for (const condition of ['a1', 'b1', 'a2', 'b2']) {
    assert(counts.get(condition) === 3, `${condition}: ${counts.get(condition) ?? 0} runs, expected 3`)
  }
  return runs.map((run) => `${run.run}=${run.condition}`).join(' ')
})

check('runs are interleaved (A1,B1,A2,B2, repeated)', () => {
  const order = runs.map((run) => run.condition)
  const expected = ['a1', 'b1', 'a2', 'b2', 'a1', 'b1', 'a2', 'b2', 'a1', 'b1', 'a2', 'b2']
  assert(order.join(',') === expected.join(','), `order is ${order.join(',')}`)
  return 'interleaved 3x'
})

const patches = new Map()
check('every run has its own patch file', () => {
  for (const run of runs) {
    assert(existsSync(run.patch), `missing ${run.patch}`)
    patches.set(run.run, read(run.patch))
  }
  return `${runs.length} patches`
})

check('session ids are unique and carry no condition label', () => {
  const ids = new Set()
  for (const run of runs) {
    const match = /sessionId:\s*(\S+)/.exec(patches.get(run.run))
    assert(match, `${run.run}: no sessionId`)
    assert(!ids.has(match[1]), `duplicate sessionId ${match[1]}`)
    ids.add(match[1])
    assert(match[1] === run.sessionId, `${run.run}: patch sessionId ${match[1]} != manifest ${run.sessionId}`)
    const lower = match[1].toLowerCase()
    for (const word of CONDITION_WORDS) assert(!lower.includes(word), `${run.run}: sessionId leaks "${word}"`)
  }
  return `${ids.size} unique neutral ids`
})

check('run workspaces are unique, exist, and sit outside the repository', () => {
  const dirs = new Set()
  for (const run of runs) {
    const cwd = /cwd:\s*'([^']+)'/.exec(patches.get(run.run))?.[1]
    assert(cwd, `${run.run}: no cwd`)
    assert(!dirs.has(cwd), `duplicate cwd ${cwd}`)
    dirs.add(cwd)
    assert(existsSync(cwd), `${run.run}: cwd does not exist`)
    const lower = cwd.toLowerCase()
    for (const word of EXPERIMENT_WORDS) assert(!lower.includes(word), `${run.run}: cwd leaks "${word}": ${cwd}`)
    const repo = resolve(here, '..', '..', '..', '..')
    assert(!cwd.toLowerCase().startsWith(repo.toLowerCase()), `${run.run}: workspace is inside the repository: ${cwd}`)
  }
  return `${dirs.size} workspaces outside repo`
})

check('workspace directory names are neutral (ws-NN, no condition label)', () => {
  for (const run of runs) {
    const cwd = /cwd:\s*'([^']+)'/.exec(patches.get(run.run))[1]
    const base = cwd.replaceAll('/', '\\').split('\\').filter(Boolean).pop()
    assert(/^ws-\d{2}$/.test(base), `${run.run}: workspace basename "${base}" is not neutral`)
  }
  return 'ws-01 .. ws-12'
})

check('every root equals its own cwd (no model-supplied project path)', () => {
  for (const run of runs) {
    const text = patches.get(run.run)
    const cwd = /cwd:\s*'([^']+)'/.exec(text)[1]
    const roots = [...text.matchAll(/root:\s*'([^']+)'/g)].map((match) => match[1])
    assert(roots.length >= 2, `${run.run}: expected world + scoped-fs roots, got ${roots.length}`)
    for (const root of roots) assert(root === cwd, `${run.run}: root ${root} !== cwd ${cwd}`)
  }
  return 'all roots match their run cwd'
})

check('replay eventsPath is identical across all runs (same input prefix)', () => {
  const paths = new Set()
  for (const run of runs) {
    const match = /eventsPath:\s*'([^']+)'/.exec(patches.get(run.run))
    assert(match, `${run.run}: no eventsPath`)
    paths.add(match[1])
  }
  assert(paths.size === 1, `eventsPath differs: ${[...paths].join(', ')}`)
  const events = JSON.parse(read([...paths][0]))
  assert(events.length === 4, `expected 4 replay events, got ${events.length}`)
  for (const event of events) {
    assert(typeof event.previousTitle === 'string' && event.previousTitle.length > 0, 'event missing previousTitle')
    assert(typeof event.snapshotTitle === 'string' && event.snapshotTitle.length > 0, 'event missing snapshotTitle')
    assert(typeof event.process === 'string' && event.process.length > 0, 'event missing process')
  }
  return `${[...paths][0]} (4 events)`
})

check('readscope-v2 is present only in B runs', () => {
  for (const run of runs) {
    const has = patches.get(run.run).includes('hikari-readscope-v2')
    assert(has === run.condition.startsWith('b'), `${run.run}: readscope-v2=${has}, expected ${run.condition.startsWith('b')}`)
  }
  return 'B runs only'
})

check('mutate is present only in condition-2 runs', () => {
  for (const run of runs) {
    const has = patches.get(run.run).includes('hikari-mutate')
    assert(has === run.condition.endsWith('2'), `${run.run}: mutate=${has}, expected ${run.condition.endsWith('2')}`)
  }
  return 'A2/B2 runs only'
})

check('trace path comes from a per-run environment variable', () => {
  for (const run of runs) {
    assert(patches.get(run.run).includes('process.env.C03_TRACE_PATH'), `${run.run}: trace path is not env-driven`)
  }
  return '!!js process.env.C03_TRACE_PATH'
})

check('initial workspaces share one baseline commit and are clean', () => {
  const heads = new Set()
  for (const run of runs) {
    const cwd = /cwd:\s*'([^']+)'/.exec(patches.get(run.run))[1].replaceAll('/', '\\')
    heads.add(git(cwd, 'rev-parse', 'HEAD'))
    assert(git(cwd, 'status', '--porcelain') === '', `${run.run}: workspace is dirty before any run`)
  }
  assert(heads.size === 1, `baseline commits differ: ${[...heads].join(', ')}`)
  return `HEAD ${[...heads][0].slice(0, 7)}`
})

check('initial workspaces have identical handoff content', () => {
  const shas = new Set()
  for (const run of runs) {
    const cwd = /cwd:\s*'([^']+)'/.exec(patches.get(run.run))[1].replaceAll('/', '\\')
    shas.add(git(cwd, 'hash-object', 'docs/notes/handoff.md'))
  }
  assert(shas.size === 1, `handoff content differs: ${[...shas].join(', ')}`)
  return [...shas][0]
})

check('mutation content is a plain project edit (no experiment language)', () => {
  const text = patches.get(runs.find((run) => run.condition === 'a2').run)
  const start = text.indexOf('      content: |')
  assert(start !== -1, 'no content block in a2 run')
  const block = text.slice(start).toLowerCase()
  for (const word of ['实验', 'c03', 'readscope', 'expected', '预期', 'mutation', 'fixture']) {
    assert(!block.includes(word.toLowerCase()), `mutation content leaks "${word}"`)
  }
  return 'no experiment vocabulary in mutation block'
})

check('workspace files contain no experiment leaks', () => {
  const leaks = ['c03', 'readscope', 'protocol', 'preflight', 'hikari-feedback-loop', 'workbench']
  for (const run of runs) {
    const cwd = /cwd:\s*'([^']+)'/.exec(patches.get(run.run))[1].replaceAll('/', '\\')
    const files = execFileSync('git', ['ls-files'], { cwd, encoding: 'utf8' }).split('\n').filter(Boolean)
    for (const file of files) {
      const text = read(join(cwd, file)).toLowerCase()
      for (const leak of leaks) assert(!text.includes(leak), `${run.run}/${file} leaks "${leak}"`)
    }
    assert(!files.some((file) => /patch|replay|mutate|trace/.test(file)), `${run.run}: fixture file names leak tooling`)
  }
  return `${runs.length} workspaces scanned`
})

check('agent-visible surface carries no condition label', () => {
  // working_directory / project_status / read / glob / grep all render paths
  // relative to the run cwd; the absolute cwd is the only place a label could
  // leak. Checked below for every run.
  const leaks = []
  for (const run of runs) {
    const cwd = /cwd:\s*'([^']+)'/.exec(patches.get(run.run))[1].toLowerCase()
    for (const word of CONDITION_WORDS) {
      if (cwd.includes(word)) leaks.push(`${run.run}: ${word}`)
    }
  }
  assert(leaks.length === 0, `condition labels leak through cwd: ${leaks.join(', ')}`)
  return 'cwd, project_status root and relative paths carry no a1/b1/a2/b2'
})

check('no experiment session directory exists yet (no history pollution)', () => {
  const sessions = join(process.env.USERPROFILE ?? '', '.dsh', 'sessions')
  const existing = runs.filter((run) => existsSync(join(sessions, run.sessionId))).map((run) => run.sessionId)
  assert(existing.length === 0, `pre-existing session dirs: ${existing.join(', ')}`)
  return 'none'
})

check('B readscope points at its own session', () => {
  for (const run of runs.filter((entry) => entry.condition.startsWith('b'))) {
    const text = patches.get(run.run)
    const sessionId = /sessionId:\s*(\S+)/.exec(text)[1]
    const index = text.indexOf('hikari-readscope-v2')
    const after = text.slice(index, index + 300)
    assert(after.includes(`sessionId: ${sessionId}`), `${run.run}: readscope sessionId mismatch`)
  }
  return 'B runs readscope bound to own session'
})

check('mutate targets the run workspace handoff only', () => {
  for (const run of runs.filter((entry) => entry.condition.endsWith('2'))) {
    const text = patches.get(run.run)
    const cwd = /cwd:\s*'([^']+)'/.exec(text)[1]
    const match = /      path:\s*'([^']+)'/.exec(text)
    assert(match, `${run.run}: no mutate path`)
    const target = match[1]
    assert(target === `${cwd}/docs/notes/handoff.md`, `${run.run}: mutate target ${target} is not its own handoff`)
    assert(existsSync(target.replaceAll('/', '\\')), `${run.run}: mutate target missing`)
  }
  return 'A2/B2 runs target own handoff.md'
})

const failed = checks.filter((entry) => !entry.ok)
const result = { ok: failed.length === 0, checks }
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(result, null, 2))
} else {
  for (const entry of checks) console.log(`${entry.ok ? 'PASS' : 'FAIL'}  ${entry.name} — ${entry.detail}`)
  console.log(`\n${failed.length === 0 ? 'PREFLIGHT OK' : `${failed.length} FAILED`}`)
}
process.exit(failed.length === 0 ? 0 : 1)
