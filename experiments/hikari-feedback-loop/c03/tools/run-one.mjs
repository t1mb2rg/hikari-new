// C-03 single-run driver.
//
// Runs one frozen C-03 condition: starts a fresh DSH instance on the run's
// patch, waits until the replayed observation sequence has finished (turn 4's
// turn/end), then stops the instance and writes a meta record. It never
// rewrites the workspace: the workspace copy made by make-fixtures is the
// input, and the session log + trace file are the evidence.
import { spawn } from 'node:child_process'
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import net from 'node:net'
import { zstdDecompressSync, constants as zc } from 'node:zlib'
import { setTimeout as sleep } from 'node:timers/promises'

const c03 = 'G:\\work\\LAB\\code\\projects\\own\\hikari-new\\experiments\\hikari-feedback-loop\\c03'
const manifest = JSON.parse(readFileSync(join(c03, 'fixtures', 'runs', 'manifest.json'), 'utf8'))
const runId = process.argv[2]
const run = manifest.runs.find((r) => r.run === runId)
if (!run) throw new Error(`unknown run ${runId}`)

const dshCmd = 'G:\\深度求索马具\\resources\\runtime\\cli\\bin\\dsh.cmd'
const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const captures = join(c03, 'captures')
mkdirSync(captures, { recursive: true })
const tracePath = join(captures, `${runId}.jsonl`)
const logPath = join(captures, `${runId}.log`)
const metaPath = join(captures, `${runId}.meta.json`)

const EXPECTED_TURNS = 4
const MAX_MS = 25 * 60 * 1000

function portListening(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
    setTimeout(() => {
      socket.destroy()
      resolve(false)
    }, 1000)
  })
}

function findSessionFile(sessionId) {
  const root = join(dshHome, 'sessions')
  if (!existsSync(root)) return null
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue
      const p = join(dir, ent.name)
      if (ent.name === sessionId) {
        const f = join(p, 'session.v4.jsonl.zstd')
        return existsSync(f) ? f : null
      }
      stack.push(p)
    }
  }
  return null
}

function decodeSession(file) {
  const buf = readFileSync(file)
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
  const offsets = []
  let at = 0
  while ((at = buf.indexOf(magic, at)) !== -1) {
    offsets.push(at)
    at += 4
  }
  const events = []
  for (let k = 0; k < offsets.length; k += 1) {
    const end = k + 1 < offsets.length ? offsets[k + 1] : buf.length
    try {
      const out = zstdDecompressSync(buf.subarray(offsets[k], end))
      for (const line of out.toString('utf8').split('\n')) {
        if (!line.trim()) continue
        try {
          events.push(JSON.parse(line))
        } catch {
          // partial frame boundary: ignore
        }
      }
    } catch {
      // skip undecodable frame
    }
  }
  return events
}

function completedTurns(sessionFile) {
  if (!sessionFile || !existsSync(sessionFile)) return { turns: [], lastSeq: -1 }
  const events = decodeSession(sessionFile)
  const turns = []
  let lastSeq = -1
  for (const ev of events) {
    if (typeof ev.seq === 'number') lastSeq = Math.max(lastSeq, ev.seq)
    if (ev.type === 'turn/end' && ev.data && typeof ev.data.turn === 'number') turns.push(ev.data.turn)
  }
  return { turns, lastSeq }
}

const startedAt = new Date().toISOString()
const child = spawn(dshCmd, ['--profile', 'hikari', '--patch', run.patch, '--port', String(run.port), '--no-open'], {
  env: { ...process.env, C03_TRACE_PATH: tracePath },
  shell: true,
  windowsHide: true,
})
let log = ''
child.stdout.on('data', (b) => {
  log += b.toString()
  process.stdout.write(b)
})
child.stderr.on('data', (b) => {
  log += b.toString()
  process.stderr.write(b)
})

const meta = {
  run: run.run,
  condition: run.condition,
  sessionId: run.sessionId,
  workspace: run.workspace,
  port: run.port,
  patch: run.patch,
  tracePath,
  startedAt,
  status: 'running',
}

let done = false
const deadline = Date.now() + MAX_MS
while (!done && Date.now() < deadline) {
  await sleep(3000)
  if (child.exitCode !== null) {
    meta.status = 'exited-early'
    break
  }
  const sessionId = run.sessionId
  const sessionFile = findSessionFile(sessionId)
  if (sessionFile) {
    const { turns, lastSeq } = completedTurns(sessionFile)
    meta.sessionFile = sessionFile
    meta.lastSeq = lastSeq
    meta.completedTurns = turns
    if (turns.includes(EXPECTED_TURNS)) {
      done = true
      meta.status = 'completed'
      break
    }
  }
}

await sleep(4000)
try {
  execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore', shell: 'cmd.exe' })
} catch {
  try {
    child.kill('SIGKILL')
  } catch {}
}
for (let i = 0; i < 25; i += 1) {
  await sleep(1000)
  if (!(await portListening(run.port))) break
}

meta.endedAt = new Date().toISOString()
meta.elapsedMs = Date.now() - new Date(startedAt).getTime()
meta.exitCode = child.exitCode
if (meta.status === 'running') meta.status = 'timeout'
writeFileSync(logPath, log, 'utf8')
writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8')
console.log(JSON.stringify(meta, null, 2))
