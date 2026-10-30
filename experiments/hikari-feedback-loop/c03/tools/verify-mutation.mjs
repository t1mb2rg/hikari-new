/**
 * Verify the "file changed" condition on a real fixture working copy (no model).
 *
 * For each of ws-a2 and ws-b2:
 *   1. record the baseline handoff content;
 *   2. drive the mutate plugin with a synthetic turn/end for afterTurn;
 *   3. confirm the file changed and the change is a normal worktree diff;
 *   4. restore the file and confirm the worktree is clean again.
 *
 * Exit code 0 = PASS, 1 = FAIL.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply } from '../../../../hikari-native/mutate/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', 'fixtures')

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

let failed = 0

for (const condition of ['a2', 'b2']) {
  const ws = join(root, `ws-${condition}`)
  const target = join(ws, 'docs', 'notes', 'handoff.md')
  const sessionId = `session-hikari-c03-${condition}`
  const baseline = readFileSync(target, 'utf8')
  const handlers = []
  const ctx = { on: (name, handler) => handlers.push({ name, handler }) }
  apply(ctx, { sessionId, afterTurn: 3, path: target, content: MUTATION })
  for (const { handler } of handlers) handler({ id: sessionId }, { type: 'turn/end', data: { turn: 3 } })

  const after = readFileSync(target, 'utf8')
  const changed = after !== baseline && after.includes('## 4. Decision log')
  let diffStat = ''
  let cleaned = false
  try {
    diffStat = execFileSync('git', ['-C', ws, 'diff', '--stat'], { encoding: 'utf8' }).trim()
    execFileSync('git', ['-C', ws, 'checkout', '--', 'docs/notes/handoff.md'])
    cleaned = execFileSync('git', ['-C', ws, 'status', '--porcelain'], { encoding: 'utf8' }).trim() === ''
  } catch (error) {
    console.error(`ws-${condition}: git error: ${error.message}`)
    failed += 1
    continue
  }

  const ok = changed && diffStat.length > 0 && cleaned
  console.log(`ws-${condition}: changed=${changed} diff=${JSON.stringify(diffStat.split('\n')[0])} cleaned=${cleaned} -> ${ok ? 'PASS' : 'FAIL'}`)
  if (!ok) failed += 1
}

process.exit(failed === 0 ? 0 : 1)
