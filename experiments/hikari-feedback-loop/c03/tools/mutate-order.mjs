/**
 * Evidence for the A2/B2 event order:
 *
 *   turn 3/end  ->  mutate completes  ->  turn 4 first request
 *
 * No model is started. What this script proves on the real fixtures:
 *   - the mutate handler is synchronous: when the turn/end dispatch returns,
 *     the file is already rewritten (so nothing in the next turn can observe
 *     the old content);
 *   - the rewritten file's mtime lies between the turn/end dispatch and the
 *     simulated first read of turn 4;
 *   - a "turn 4" read of the target sees the new content.
 *
 * The real-run counterpart (recorded in the report): in a live session,
 * `session/event` is dispatched synchronously from `Session.commit`, and
 * `turn()` appends `turn/end` before returning, so the plugin handler always
 * completes before the next turn/start can be appended. The run report will
 * cross-check event times from the session log, the file mtime, and the first
 * trace record after turn 3.
 *
 * Usage: node mutate-order.mjs [run]    (default: first B2 run, r04)
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply } from '../../../../hikari-native/mutate/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = resolve(here, '..', 'fixtures')
const manifest = JSON.parse(readFileSync(join(fixtures, 'runs', 'manifest.json'), 'utf8'))
const wanted = process.argv[2]
const run = wanted ? manifest.runs.find((entry) => entry.run === wanted) : manifest.runs.find((entry) => entry.condition === 'b2')
if (!run) {
  console.error(`no such run: ${wanted ?? 'b2'}`)
  process.exit(2)
}

const patchText = readFileSync(run.patch, 'utf8')
const rows = patchText.split('\n')
const contentStart = rows.findIndex((line) => line.trim() === 'content: |')
if (contentStart === -1) {
  console.error(`${run.run}: patch has no content block`)
  process.exit(2)
}
const content = rows
  .slice(contentStart + 1)
  .filter((line) => line.startsWith('          '))
  .map((line) => line.slice(10))
  .join('\n')

const target = join(run.workspace, 'docs', 'notes', 'handoff.md')
const baseline = readFileSync(target, 'utf8')
const timeline = []

const handlers = []
const ctx = { on: (name, handler) => handlers.push({ name, handler }) }
apply(ctx, { sessionId: run.sessionId, afterTurn: 3, path: target, content })

timeline.push({ event: 'turn 3/end dispatched', at: Date.now(), turn: 3 })
for (const { handler } of handlers) handler({ id: run.sessionId }, { type: 'turn/end', data: { turn: 3 } })
timeline.push({ event: 'mutate handler returned', at: Date.now(), turn: 3 })

const mtime = statSync(target).mtimeMs
const afterMutation = readFileSync(target, 'utf8')
timeline.push({ event: 'target file mtime', at: mtime, turn: 3 })

// The first thing "turn 4" does is read the target again.
const turn4Read = readFileSync(target, 'utf8')
timeline.push({ event: 'turn 4 first read of handoff.md', at: Date.now(), turn: 4 })

const orderOk =
  afterMutation !== baseline &&
  afterMutation === content &&
  mtime >= timeline[0].at &&
  timeline[3].at >= mtime

// restore the fixture so the preflight "clean" invariant still holds
execFileSync('git', ['-C', run.workspace, 'checkout', '--', 'docs/notes/handoff.md'])

const report = {
  run: run.run,
  condition: run.condition,
  workspace: run.workspace,
  orderOk,
  timeline,
  checks: {
    baselineIntactBeforeTurnEnd: baseline !== afterMutation,
    mutatedContentEqualsConfiguredContent: afterMutation === content,
    fileMtimeAfterTurnEndDispatch: mtime >= timeline[0].at,
    turn4ReadAfterMutation: timeline[3].at >= mtime,
    turn4ReadSeesNewContent: turn4Read === content,
  },
}
console.log(JSON.stringify(report, null, 2))
process.exit(orderOk && report.checks.turn4ReadSeesNewContent ? 0 : 1)
