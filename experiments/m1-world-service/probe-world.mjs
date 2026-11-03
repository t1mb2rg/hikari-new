// M1-a 验收探针：World 只读 Service 的四条边界（§3.2）。
// 不启动 Cordis、不连真 session：用最小假 ctx 直接调 installFindings，只看它暴露了什么。
import assert from 'node:assert/strict'
import { installFindings, searchFindings, readFinding, WORLD_FINDINGS_SERVICE } from '../../hikari-native/world/findings.js'

const ROOT = 'G:/work/LAB/code/projects/own/hikari-new'

// 字段名与 findings.js 的实现一致：findingId / recordedAt（数字）/ claim / status
const findingsState = {
  findings: {
    'f-001': {
      findingId: 'f-001',
      recordedAt: 1792400000000,
      status: 'refuted',
      claim: '方向 2 的唤醒来自窗口变化。',
      evidence: [{ kind: 'tool', ref: 'perception.foreground' }],
    },
    'f-002': {
      findingId: 'f-002',
      recordedAt: 1792403600000,
      status: 'confirmed',
      claim: 'project-watch 以 30 秒采样项目状态。',
      evidence: [{ kind: 'file', ref: 'hikari-native/project-watch/index.js' }],
    },
  },
}

function makeCtx() {
  const captured = { provides: [], tools: [] }
  const ctx = {
    sessionProjections: { register() {}, stateOf: () => findingsState },
    sessions: { get: () => ({ id: 'probe-session' }) },
    systemPrompt: { context() {} },
    tools: { register: (definition) => captured.tools.push(definition?.name ?? definition) },
    logger: { info() {}, warn() {} },
    provide: (name, value) => captured.provides.push({ name, value }),
  }
  return { ctx, captured }
}

const results = []
const check = (label, fn) => {
  try {
    fn()
    results.push(['PASS', label])
  } catch (err) {
    results.push(['FAIL', label, err.message.split('\n').slice(0, 4).join('\n        ')])
  }
}

// ── 场景 1：git 仓库 ───────────────────────────────────────────────
const a = makeCtx()
const ret = installFindings(a.ctx, { sessionId: 'probe-session', root: ROOT })
const svc = a.captured.provides.at(-1)?.value

check('Service 以单段名暴露，且排在三个工具注册之后', () => {
  assert.equal(a.captured.provides.length, 1)
  assert.equal(a.captured.provides.at(-1)?.name, WORLD_FINDINGS_SERVICE)
  assert.deepEqual(a.captured.tools, ['record_finding', 'search_memory', 'read_memory'])
})

check('search 与 searchFindings 逐字段相等', () => {
  const opts = { query: '窗口', limit: 4, offset: 0 }
  const fromService = svc.search(opts)
  const direct = searchFindings(findingsState.findings, opts)
  assert.deepEqual(fromService, direct)
  assert.equal(fromService.total, 1)
})

check('read 与 readFinding 逐字段相等', () => {
  const opts = { id: 'f-002' }
  assert.deepEqual(svc.read(opts), readFinding(findingsState.findings, opts))
})

check('接口封闭：三个键、已冻结、写入抛错', () => {
  assert.deepEqual(Object.keys(svc).sort(), ['describe', 'read', 'search'])
  assert.equal(Object.isFrozen(svc), true)
  assert.throws(() => {
    'use strict'
    svc.delete = () => {}
  }, TypeError)
  assert.throws(() => {
    'use strict'
    svc.search = () => {}
  }, TypeError)
  assert.deepEqual(Object.keys(svc).sort(), ['describe', 'read', 'search'])
})

check('返回值是快照：改它不影响 World 内部状态', () => {
  const first = svc.search({ query: '窗口', limit: 4, offset: 0 })
  assert.equal(first.results.length, 1)
  first.results[0].status = 'TAMPERED'
  first.results[0].id = 'TAMPERED'
  first.results.push({ id: 'GHOST' })
  const again = svc.search({ query: '窗口', limit: 4, offset: 0 })
  assert.equal(again.results.length, 1)
  assert.equal(again.results[0].status, 'refuted')
  assert.equal(again.results[0].id, 'f-001')
  assert.equal(findingsState.findings['f-001'].status, 'refuted')
})

check('describe 报出可用数据源', () => {
  assert.deepEqual(svc.describe(), { sources: ['findings'], project: ret.project, available: true })
})

// ── 场景 2：非 git 仓库（fail-closed）────────────────────────────────
const b = makeCtx()
const retB = installFindings(b.ctx, { sessionId: 'probe-session', root: 'G:/tmp/definitely-not-a-repo' })
const svcB = b.captured.provides.at(-1)?.value

check('fail-closed 仍然暴露 Service（数据源标记不可用）', () => {
  assert.equal(retB.project, undefined)
  assert.equal(b.captured.provides.at(-1)?.name, WORLD_FINDINGS_SERVICE)
  assert.deepEqual(b.captured.tools, [])
  assert.deepEqual(svcB.describe(), { sources: ['findings'], project: null, available: false })
  // 历史 findings 仍在会话里，读它不报错；available:false 只说明「当前没有可写入的仓库」
  assert.doesNotThrow(() => svcB.search({ query: '窗口' }))
  assert.doesNotThrow(() => svcB.read({ id: 'f-001' }))
})

for (const [status, label, detail] of results) {
  console.log(`${status}  ${label}${detail ? `\n        ${detail}` : ''}`)
}
const failed = results.filter(([s]) => s === 'FAIL').length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exitCode = failed === 0 ? 0 : 1
