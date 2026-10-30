/**
 * Build the C-03 fixtures: twelve isolated run workspaces, twelve run patches,
 * and the fixed replay event sequence.
 *
 * Grounds for the shape:
 *   - 4 conditions x 3 independent repetitions = 12 runs, all serial;
 *   - every run gets its OWN workspace copy, its OWN neutral sessionId, and
 *     its OWN trace file (C03_TRACE_PATH, set per run);
 *   - workspace directories and session ids carry NO condition label and NO
 *     experiment vocabulary: ws-01..ws-12 under a neutral parent directory,
 *     session-hikari-c03-01..12. The condition mapping lives only in
 *     fixtures/runs/manifest.json, which the agent cannot read.
 *
 * Idempotent: wipes the run workspace root and fixtures/patch before rebuilding.
 *
 * Usage: node make-fixtures.mjs
 */
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = resolve(here, '..', 'fixtures')

/**
 * Neutral parent for the run workspaces. Deliberately outside the repository
 * and free of experiment vocabulary, because the agent's working_directory
 * tool prints the absolute path.
 */
const RUNS_ROOT = process.env.C03_RUNS_ROOT ?? join(tmpdir(), 'workbench')

/** Condition order is interleaved: A1, B1, A2, B2, repeated three times. */
const CONDITION_CYCLE = ['a1', 'b1', 'a2', 'b2']

const RUNS = Array.from({ length: 12 }, (_, index) => {
  const condition = CONDITION_CYCLE[index % 4]
  const id = String(index + 1).padStart(2, '0')
  return {
    id: `r${id}`,
    index: index + 1,
    condition,
    workspace: join(RUNS_ROOT, `ws-${id}`),
    sessionId: `session-hikari-c03-${id}`,
    port: 3091 + index,
    bGroup: condition.startsWith('b'),
    mutate: condition.endsWith('2'),
  }
})

/** Files that define the workspace. Kept deliberately small and neutral. */
const FILES = {
  'README.md': `# ledger

A small event ledger used as a workspace.

- \`src/pipeline.js\` — append and fold
- \`src/store.js\` — in-memory store
- \`tests/pipeline.test.js\`

Run the tests with \`node --test tests\`.
`,
  'package.json': JSON.stringify(
    {
      name: 'ledger',
      version: '0.1.0',
      private: true,
      type: 'module',
      scripts: { test: 'node --test tests' },
    },
    null,
    2,
  ),
  'docs/notes/handoff.md': `# Ledger notes

## 1. Current shape

The pipeline appends events and folds them into a ledger. Store keeps the
current folded value in memory.

## 2. Open questions

- Should folding be incremental or full?
- Where should dedupe live: pipeline or store?

## 3. Next steps

- Add a dedupe key to appended events
- Add a regression test for duplicate delivery
`,
  'src/pipeline.js': `/** Append an event to the log. */
export function append(events, event) {
  return [...events, event]
}

/** Fold the log into the current ledger value. */
export function fold(events) {
  let total = 0
  for (const event of events) {
    total += event.amount ?? 0
  }
  return total
}
`,
  'src/store.js': `import { append, fold } from './pipeline.js'

/** In-memory ledger store. */
export class Store {
  constructor() {
    this.events = []
  }

  add(event) {
    this.events = append(this.events, event)
    return fold(this.events)
  }

  get size() {
    return this.events.length
  }
}
`,
  'tests/pipeline.test.js': `import assert from 'node:assert/strict'
import { test } from 'node:test'
import { append, fold } from '../src/pipeline.js'

test('fold sums amounts', () => {
  assert.equal(fold([{ amount: 2 }, { amount: 3 }]), 5)
})

test('append keeps order', () => {
  let events = append([], { amount: 1 })
  events = append(events, { amount: 2 })
  assert.equal(events.length, 2)
})
`,
  '.gitignore': `node_modules/
`,
}

/**
 * The A2/B2 mutation. It is a plausible project edit: a decision entry
 * appended to the notes file. It contains no experiment language.
 */
const MUTATION = `# Ledger notes

## 1. Current shape

The pipeline appends events and folds them into a ledger. Store keeps the
current folded value in memory.

## 2. Open questions

- Should folding be incremental or full?
- Where should dedupe live: pipeline or store?

## 3. Next steps

- Add a dedupe key to appended events
- Add a regression test for duplicate delivery

## 4. Decision log

- 2026-10-31: dedupe lives in the pipeline. Appended events carry a
  \`dedupeKey\`; the pipeline drops an event whose key was already seen.
  The regression test covers duplicate delivery.
`

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function writeTree(root, files) {
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content, 'utf8')
  }
}

function initRepo(root) {
  git(root, 'init', '-q')
  git(root, 'config', 'user.name', 'c03-fixture')
  git(root, 'config', 'user.email', 'c03-fixture@localhost')
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'fixture: ledger baseline')
}

const EVENTS = [
  {
    at: 1793300000000,
    clock: '20:13:20',
    previousTitle: 'notes/handoff.md - Visual Studio Code',
    snapshotTitle: 'src/pipeline.js - Visual Studio Code',
    process: 'Code',
  },
  {
    at: 1793300060000,
    clock: '20:14:20',
    previousTitle: 'src/pipeline.js - Visual Studio Code',
    snapshotTitle: 'docs/notes/handoff.md - Visual Studio Code',
    process: 'Code',
  },
  {
    at: 1793300120000,
    clock: '20:15:20',
    previousTitle: 'docs/notes/handoff.md - Visual Studio Code',
    snapshotTitle: 'src/store.js - Visual Studio Code',
    process: 'Code',
  },
  {
    at: 1793300180000,
    clock: '20:16:20',
    previousTitle: 'src/store.js - Visual Studio Code',
    snapshotTitle: 'docs/notes/handoff.md - Visual Studio Code',
    process: 'Code',
  },
]

function patchFor(run) {
  const ws = run.workspace.replaceAll('\\', '/')
  const sessionId = run.sessionId
  const eventsPath = join(fixtures, 'events', 'replay.json').replaceAll('\\', '/')
  const bGroup = run.bGroup
  const mutate = run.mutate

  const lines = [
    `# C-03 run ${run.id} (${run.condition})`,
    '# Generated by c03/tools/make-fixtures.mjs — do not hand-edit.',
    '# The agent-visible surface must not reveal the condition: this file is',
    '# outside every run workspace and is never read by the agent.',
    '',
    '- id: agent-loop',
    '  config:',
    '    maxParallelToolCalls: 10',
    '    agents:',
    '      - id: hikari',
    `        sessionId: ${sessionId}`,
    '        provider: deepseek-account',
    '        model: deepseek-flash',
    '        reasoningEffort: max',
    `        cwd: '${ws}'`,
    '',
    '- id: system-prompt',
    '  config:',
    '    personaPrefix: |',
    '      You are Hikari, a resident observer of this project.',
    '      You wake when the foreground window changes and decide whether the change matters.',
    '      When you form a belief about the project, record it with record_finding so it survives the turn.',
    '      You may read files in the workspace, run project_status, and search. Do not contact the user.',
    '',
    '- id: hikari-perception',
    '  disabled: true',
    '',
    '- id: hikari-world',
    '  config:',
    `    sessionId: ${sessionId}`,
    `    root: '${ws}'`,
    '    settleMs: 900',
    '    cooldownMs: 30000',
    '    injectContext: true',
    '',
    '- id: hikari-activation',
    '  config:',
    `    sessionId: ${sessionId}`,
    '',
    '- id: hikari-scoped-fs',
    '  config:',
    `    root: '${ws}'`,
    '    maxResults: 200',
    '    maxReadLines: 2000',
    '',
    '- id: hikari-project-status',
    '  config:',
    `    root: '${ws}'`,
    '    limit: 5',
    '',
    '- id: hikari-replay',
    '  config:',
    `    sessionId: ${sessionId}`,
    `    eventsPath: '${eventsPath}'`,
    '    startDelayMs: 8000',
    '    gapMs: 20000',
    '    idleTimeoutMs: 600000',
    '  disabled: false',
    '',
    '- insert:',
    '    - id: hikari-trace',
    '      name: hikari-native-v0/trace',
    '      config:',
    '        path: !!js process.env.C03_TRACE_PATH',
  ]
  if (bGroup) {
    lines.push(
      '    - id: hikari-readscope-v2',
      '      name: hikari-native-v0/readscope-v2',
      '      config:',
      `        sessionId: ${sessionId}`,
    )
  }

  if (mutate) {
    lines.push(
      '    - id: hikari-mutate',
      '      name: hikari-native-v0/mutate',
      '      config:',
      `        sessionId: ${sessionId}`,
      '        afterTurn: 3',
      `        path: '${ws}/docs/notes/handoff.md'`,
      '        content: |',
      ...MUTATION.split('\n').map((line) => (line.length === 0 ? '          ' : `          ${line}`)),
    )
  }

  return `${lines.join('\n')}\n`
}

// --- build ---------------------------------------------------------------

rmSync(RUNS_ROOT, { recursive: true, force: true })
rmSync(join(fixtures, 'patch'), { recursive: true, force: true })

mkdirSync(RUNS_ROOT, { recursive: true })
const base = join(RUNS_ROOT, 'base')
mkdirSync(base, { recursive: true })
writeTree(base, FILES)
initRepo(base)

for (const run of RUNS) {
  cpSync(base, run.workspace, { recursive: true })
}

mkdirSync(join(fixtures, 'patch'), { recursive: true })
for (const run of RUNS) {
  writeFileSync(join(fixtures, 'patch', `${run.id}.patch.yml`), patchFor(run), 'utf8')
}

mkdirSync(join(fixtures, 'events'), { recursive: true })
writeFileSync(join(fixtures, 'events', 'replay.json'), `${JSON.stringify(EVENTS, null, 2)}\n`, 'utf8')

const manifest = {
  runsRoot: RUNS_ROOT,
  runs: RUNS.map((run) => ({
    run: run.id,
    condition: run.condition,
    sessionId: run.sessionId,
    workspace: run.workspace,
    port: run.port,
    patch: join(fixtures, 'patch', `${run.id}.patch.yml`),
    head: git(run.workspace, 'rev-parse', '--short', 'HEAD'),
    dirty: git(run.workspace, 'status', '--porcelain').length > 0,
    handoffSha: git(run.workspace, 'hash-object', 'docs/notes/handoff.md'),
  })),
  events: EVENTS.length,
}
mkdirSync(join(fixtures, 'runs'), { recursive: true })
writeFileSync(join(fixtures, 'runs', 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(manifest, null, 2))
