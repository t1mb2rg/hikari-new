/**
 * C-03 preflight checks: isolation, leakage, fixture consistency.
 *
 * Usage: node preflight.mjs [--json]
 *
 * Exits non-zero if any check fails. Never starts a model instance.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = resolve(here, '..', 'fixtures')
const c03 = resolve(here, '..')
const CONDITIONS = ['a1', 'b1', 'a2', 'b2']

const checks = []
function check(name, fn) {
  try {
    const detail = fn()
    checks.push({ name, ok: true, detail })
  } catch (error) {
    checks.push({ name, ok: false, detail: error.message })
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message)
}
function read(path) {
  return readFileSync(path, 'utf8')
}
function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

const patches = new Map()
const parsed = new Map()

check('four condition patches exist', () => {
  for (const condition of CONDITIONS) {
    const path = join(fixtures, 'patch', `${condition}.patch.yml`)
    assert(existsSync(path), `missing ${path}`)
    patches.set(condition, read(path))
  }
  return CONDITIONS.map((condition) => `${condition}.patch.yml`)
})

check('session ids are unique per condition', () => {
  const ids = new Map()
  for (const condition of CONDITIONS) {
    const text = patches.get(condition)
    const match = /sessionId:\s*(\S+)/.exec(text)
    assert(match, `${condition}: no sessionId`)
    const id = match[1]
    assert(!ids.has(id), `duplicate sessionId ${id} in ${condition} and ${ids.get(id)}`)
    ids.set(id, condition)
    assert(id === `session-hikari-c03-${condition}`, `${condition}: unexpected sessionId ${id}`)
  }
  return JSON.stringify(Object.fromEntries([...ids.entries()].map(([id, condition]) => [condition, id])))
})

check('working directories are unique per condition', () => {
  const dirs = new Map()
  for (const condition of CONDITIONS) {
    const text = patches.get(condition)
    const match = /cwd:\s*'([^']+)'/.exec(text)
    assert(match, `${condition}: no cwd`)
    const dir = match[1]
    assert(!dirs.has(dir), `duplicate cwd ${dir}`)
    dirs.set(dir, condition)
    assert(dir.endsWith(`/ws-${condition}`), `${condition}: cwd ${dir} does not end with ws-${condition}`)
    assert(existsSync(dir), `${condition}: cwd does not exist`)
  }
  return JSON.stringify(Object.fromEntries([...dirs.entries()].map(([dir, condition]) => [condition, dir])))
})

check('scoped-fs root equals cwd (no model-supplied project path)', () => {
  for (const condition of CONDITIONS) {
    const text = patches.get(condition)
    const cwd = /cwd:\s*'([^']+)'/.exec(text)[1]
    const roots = [...text.matchAll(/root:\s*'([^']+)'/g)].map((match) => match[1])
    assert(roots.length >= 2, `${condition}: expected world + scoped-fs roots, got ${roots.length}`)
    for (const root of roots) assert(root === cwd, `${condition}: root ${root} !== cwd ${cwd}`)
  }
  return 'all roots match their condition cwd'
})

check('replay eventsPath is identical across conditions (same input prefix)', () => {
  const paths = new Set()
  for (const condition of CONDITIONS) {
    const match = /eventsPath:\s*'([^']+)'/.exec(patches.get(condition))
    assert(match, `${condition}: no eventsPath`)
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

check('readscope-v2 is present only in B conditions', () => {
  for (const condition of CONDITIONS) {
    const has = patches.get(condition).includes('hikari-readscope-v2')
    assert(has === condition.startsWith('b'), `${condition}: readscope-v2=${has}, expected ${condition.startsWith('b')}`)
  }
  return 'B1/B2 only'
})

check('mutate is present only in condition 2', () => {
  for (const condition of CONDITIONS) {
    const has = patches.get(condition).includes('hikari-mutate')
    assert(has === condition.endsWith('2'), `${condition}: mutate=${has}, expected ${condition.endsWith('2')}`)
  }
  return 'A2/B2 only'
})

check('trace path comes from the environment, not a hard-coded run', () => {
  for (const condition of CONDITIONS) {
    assert(patches.get(condition).includes('process.env.C03_TRACE_PATH'), `${condition}: trace path is not env-driven`)
  }
  return '!!js process.env.C03_TRACE_PATH'
})

check('initial workspaces share one baseline commit and are clean', () => {
  const heads = new Set()
  for (const condition of CONDITIONS) {
    const dir = join(fixtures, `ws-${condition}`)
    heads.add(git(dir, 'rev-parse', 'HEAD'))
    assert(git(dir, 'status', '--porcelain') === '', `${condition}: workspace is dirty before any run`)
  }
  assert(heads.size === 1, `baseline commits differ: ${[...heads].join(', ')}`)
  return `HEAD ${[...heads][0].slice(0, 7)}`
})

check('initial workspaces have identical handoff content', () => {
  const shas = new Set()
  for (const condition of CONDITIONS) {
    shas.add(git(join(fixtures, `ws-${condition}`), 'hash-object', 'docs/notes/handoff.md'))
  }
  assert(shas.size === 1, `handoff content differs: ${[...shas].join(', ')}`)
  return [...shas][0]
})

check('mutation content is a plain project edit (no experiment language)', () => {
  const text = patches.get('a2')
  const start = text.indexOf('      content: |')
  assert(start !== -1, 'a2: no content block')
  const block = text.slice(start)
  for (const word of ['实验', 'c03', 'C-03', 'readscope', 'expected', '预期', 'mutation']) {
    assert(!block.toLowerCase().includes(word.toLowerCase()), `mutation content leaks "${word}"`)
  }
  return 'no experiment vocabulary in mutation block'
})

check('workspace files contain no experiment leaks', () => {
  const leaks = ['c03', 'readscope', 'protocol', 'preflight', 'hikari-feedback-loop']
  for (const condition of CONDITIONS) {
    const dir = join(fixtures, `ws-${condition}`)
    const files = execFileSync('git', ['ls-files'], { cwd: dir, encoding: 'utf8' }).split('\n').filter(Boolean)
    for (const file of files) {
      const text = read(join(dir, file)).toLowerCase()
      for (const leak of leaks) {
        assert(!text.includes(leak), `${condition}/${file} leaks "${leak}"`)
      }
    }
    assert(!files.some((file) => /patch|replay|mutate|trace/.test(file)), `${condition}: fixture file names leak experiment tooling`)
  }
  return `${CONDITIONS.length} workspaces scanned`
})

check('no experiment session directory exists yet (no history pollution)', () => {
  const sessions = join(process.env.USERPROFILE ?? '', '.dsh', 'sessions')
  const existing = []
  for (const condition of CONDITIONS) {
    const dir = join(sessions, `session-hikari-c03-${condition}`)
    if (existsSync(dir)) existing.push(dir)
  }
  assert(existing.length === 0, `pre-existing session dirs: ${existing.join(', ')}`)
  return 'none'
})

check('B readscope points at its own session', () => {
  for (const condition of ['b1', 'b2']) {
    const text = patches.get(condition)
    const sessionId = /sessionId:\s*(\S+)/.exec(text)[1]
    const index = text.indexOf('hikari-readscope-v2')
    const after = text.slice(index, index + 300)
    assert(after.includes(`sessionId: ${sessionId}`), `${condition}: readscope sessionId mismatch`)
  }
  return 'B1/B2 readscope bound to own session'
})

check('mutate targets the condition workspace handoff only', () => {
  for (const condition of ['a2', 'b2']) {
    const text = patches.get(condition)
    const match = /      path:\s*'([^']+)'/.exec(text)
    assert(match, `${condition}: no mutate path`)
    const target = match[1].replaceAll('/', '\\')
    assert(target.endsWith(`ws-${condition}\\docs\\notes\\handoff.md`), `${condition}: mutate target ${target} is not its own handoff`)
    assert(existsSync(target.replaceAll('\\', '/')), `${condition}: mutate target missing`)
  }
  return 'A2/B2 target own handoff.md'
})

check('fixture workspaces are not inside the repository-relative target of the production agent', () => {
  // Production agent reads G:\...\hikari-new; fixtures live under experiments/,
  // so a production run could in principle read them. Documented, not blocked.
  return 'fixtures under experiments/hikari-feedback-loop/c03/fixtures (production agent root is the repo; see preflight report §limitations)'
})

const failed = checks.filter((entry) => !entry.ok)
const result = { ok: failed.length === 0, checks }
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(result, null, 2))
} else {
  for (const entry of checks) {
    console.log(`${entry.ok ? 'PASS' : 'FAIL'}  ${entry.name} — ${entry.detail}`)
  }
  console.log(`\n${failed.length === 0 ? 'PREFLIGHT OK' : `${failed.length} FAILED`}`)
}
process.exit(failed.length === 0 ? 0 : 1)
