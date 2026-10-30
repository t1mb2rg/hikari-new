import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyFindingRecord,
  installFindings,
  normalizeClaim,
  renderFindings,
  validateEvidence,
  FINDING_RECORD_TYPE,
  FINDINGS_PROJECTION_KEY,
} from '../../hikari-native/world/findings.js'

const baseRecord = (over = {}) => ({
  findingId: 'f-001',
  scope: { project: 'C:/repo', sessionId: 'session-test' },
  claim: 'project_status 不显示 stash 状态',
  status: 'open',
  provenance: 'model-claim',
  evidence: [],
  recordedAt: 1000,
  ...over,
})

const findingEvent = (seq, data) => ({ seq, type: FINDING_RECORD_TYPE, time: 1000 + seq, data, ignorable: true })

test('applyFindingRecord folds whole-value records and replaces by id', () => {
  const state = { findings: {} }
  const first = applyFindingRecord(state, findingEvent(1, baseRecord()))
  assert.equal(first.findings['f-001'].claim, 'project_status 不显示 stash 状态')
  assert.equal(first.findings['f-001'].status, 'open')

  const second = applyFindingRecord(
    first,
    findingEvent(2, baseRecord({ status: 'confirmed', provenance: 'tool-evidenced', claim: '更新后的 claim' })),
  )
  assert.equal(second.findings['f-001'].status, 'confirmed')
  assert.equal(second.findings['f-001'].claim, '更新后的 claim')
  assert.equal(Object.keys(second.findings).length, 1)
})

test('applyFindingRecord ignores unrelated, non-ignorable and malformed events', () => {
  const state = { findings: {} }
  assert.equal(applyFindingRecord(state, { seq: 0, type: 'tool/result', data: {} }), state)
  assert.equal(applyFindingRecord(state, { ...findingEvent(1, baseRecord()), ignorable: false }), state)
  assert.equal(applyFindingRecord(state, findingEvent(1, baseRecord({ status: 'bogus' }))), state)
  assert.equal(applyFindingRecord(state, findingEvent(1, baseRecord({ findingId: 'bad id' }))), state)
  assert.equal(applyFindingRecord(state, findingEvent(1, baseRecord({ scope: undefined }))), state)
})

test('renderFindings renders bounded current knowledge with honest wording', () => {
  const findings = {
    'f-001': { ...baseRecord(), findingId: 'f-001', status: 'open', claim: 'A 是假设' },
    'f-002': { ...baseRecord(), findingId: 'f-002', status: 'confirmed', claim: 'B 有证据', provenance: 'tool-evidenced' },
    'f-003': { ...baseRecord(), findingId: 'f-003', status: 'resolved', claim: 'C 已闭合' },
  }
  const text = renderFindings(findings)
  assert.match(text, /此前的假设，尚未验证/)
  assert.match(text, /有工具证据支持，尚未独立验证/)
  assert.match(text, /已闭合 1 条/)
  assert.match(text, /A 是假设/)
  assert.doesNotMatch(text, /C 已闭合/)
  assert.doesNotMatch(text, /f-003/)
})

test('renderFindings caps at 3 findings and 1200 characters', () => {
  const findings = {}
  for (let i = 1; i <= 5; i += 1) {
    findings[`f-00${i}`] = { ...baseRecord(), findingId: `f-00${i}`, claim: `claim-${i}`, recordedAt: i }
  }
  const text = renderFindings(findings)
  const lines = text.split('\n').slice(1)
  assert.equal(lines.length, 3)
  assert.match(text, /claim-5/)
  assert.match(text, /claim-4/)
  assert.match(text, /claim-3/)
  assert.doesNotMatch(text, /claim-2/)
  assert.doesNotMatch(text, /claim-1/)

  const long = renderFindings({ 'f-001': { ...baseRecord(), claim: 'x'.repeat(2000) } })
  assert.ok(long.length <= 1200)
})

test('renderFindings returns empty string without current findings', () => {
  assert.equal(renderFindings({}), '')
})

test('normalizeClaim collapses whitespace and caps length', () => {
  assert.equal(normalizeClaim('  a   b\n c  '), 'a b c')
  assert.equal(normalizeClaim('x'.repeat(400)).length, 300)
})

test('validateEvidence requires real events and matching toolCallId', () => {
  const session = {
    eventAt(seq) {
      if (seq === 0) return { seq: 0, type: 'tool/result', data: { message: { toolCallId: 'call-1' } } }
      return undefined
    },
  }
  assert.deepEqual(validateEvidence(session, [{ kind: 'tool-result', seq: 0, callId: 'call-1' }]), [
    { kind: 'tool-result', seq: 0, callId: 'call-1' },
  ])
  assert.deepEqual(validateEvidence(session, [{ kind: 'file', seq: 0, path: 'docs/x.md' }]), [
    { kind: 'file', seq: 0, path: 'docs/x.md' },
  ])
  assert.throws(() => validateEvidence(session, [{ kind: 'tool-result', seq: 0, callId: 'call-2' }]), /toolCallId/)
  assert.throws(() => validateEvidence(session, [{ kind: 'tool-result', seq: 9, callId: 'call-1' }]), /does not exist/)
  assert.throws(() => validateEvidence(session, [{ kind: 'file', seq: 0 }]), /requires path/)
  assert.throws(() => validateEvidence(session, [{ kind: 'bogus', seq: 0 }]), /unknown evidence kind/)
})

function makeHarness() {
  let state = { findings: {} }
  const written = []
  class FakeSession {
    get seq() {
      return written.length
    }
    eventAt(seq) {
      return written[seq]
    }
  }
  const append = (session, type, data) => {
    const seq = written.length
    written.push({ seq, type, time: Date.now(), data, ignorable: true })
    state = applyFindingRecord(state, written[seq])
    return seq
  }
  const session = new FakeSession()
  const registrations = { projection: undefined, contexts: [], tools: [] }
  const ctx = {
    sessions: { get: (id) => (id === 'session-test' ? session : undefined) },
    sessionProjections: {
      register: (definition) => {
        registrations.projection = definition
      },
      stateOf: () => state,
    },
    systemPrompt: { context: (context) => registrations.contexts.push(context) },
    tools: { register: (tool) => registrations.tools.push(tool) },
    logger: { info() {}, warn() {} },
  }
  return { ctx, registrations, written, append }
}

test('installFindings registers projection, context and record_finding', () => {
  const harness = makeHarness()
  installFindings(harness.ctx, { sessionId: 'session-test', root: process.cwd(), append: harness.append })
  assert.equal(harness.registrations.projection.key, FINDINGS_PROJECTION_KEY)
  assert.equal(harness.registrations.projection.stateVersion, 1)
  assert.equal(harness.registrations.contexts.length, 1)
  assert.equal(harness.registrations.contexts[0].name, 'hikari:findings')
  assert.equal(harness.registrations.tools.length, 1)
  assert.equal(harness.registrations.tools[0].name, 'record_finding')
})

test('installFindings fails closed outside a git repository', () => {
  const harness = makeHarness()
  const result = installFindings(harness.ctx, { sessionId: 'session-test', root: 'C:/definitely-not-a-repo' })
  assert.equal(result.project, undefined)
  assert.equal(harness.registrations.tools.length, 0)
  assert.equal(harness.registrations.contexts.length, 1)
})

test('record_finding enforces the state machine and evidence rules', async () => {
  const harness = makeHarness()
  harness.written.push({ seq: 0, type: 'tool/result', time: 1, data: { message: { toolCallId: 'call-1' } } })
  installFindings(harness.ctx, { sessionId: 'session-test', root: process.cwd(), append: harness.append })
  const tool = harness.registrations.tools[0]

  const created = await tool.execute({ claim: 'project_status 不显示 stash' })
  assert.equal(created.findingId, 'f-001')
  assert.equal(created.status, 'open')
  assert.equal(created.provenance, 'model-claim')

  const duplicate = await tool.execute({ claim: 'project_status 不显示 stash' })
  assert.equal(duplicate.deduplicated, true)
  assert.equal(duplicate.findingId, 'f-001')

  await assert.rejects(tool.execute({ claim: 'x', status: 'confirmed' }), /must start as "open"/)
  await assert.rejects(
    tool.execute({ claim: 'x', provenance: 'tool-evidenced', evidence: [{ kind: 'tool-result', seq: 0, callId: 'call-1' }] }),
    /must start as "model-claim"/,
  )
  await assert.rejects(
    tool.execute({ claim: 'x', findingId: 'f-001', status: 'resolved', provenance: 'tool-evidenced', evidence: [{ kind: 'tool-result', seq: 0, callId: 'call-1' }] }),
    /illegal status transition/,
  )
  await assert.rejects(
    tool.execute({ claim: 'x', findingId: 'f-001', status: 'confirmed', provenance: 'model-claim' }),
    /requires provenance "tool-evidenced"/,
  )

  const advanced = await tool.execute({
    claim: 'project_status 不显示 stash',
    findingId: 'f-001',
    status: 'confirmed',
    provenance: 'tool-evidenced',
    evidence: [{ kind: 'tool-result', seq: 0, callId: 'call-1' }],
  })
  assert.equal(advanced.status, 'confirmed')

  await assert.rejects(
    tool.execute({ claim: 'back', findingId: 'f-001', status: 'open', provenance: 'model-claim' }),
    /illegal status transition/,
  )
})

test('tool-evidenced evidence is auto-filled from the latest successful tool/result', async () => {
  const harness = makeHarness()
  harness.written.push({ seq: 0, type: 'tool/result', time: 1, data: { message: { toolCallId: 'call-ok' } } })
  harness.written.push({ seq: 1, type: 'tool/result', time: 2, data: { isError: true, message: { toolCallId: 'call-fail' } } })
  installFindings(harness.ctx, { sessionId: 'session-test', root: process.cwd(), append: harness.append })
  const tool = harness.registrations.tools[0]

  await tool.execute({ claim: '有工具证据的假设' })
  const advanced = await tool.execute({
    claim: '有工具证据的假设',
    findingId: 'f-001',
    status: 'confirmed',
    provenance: 'tool-evidenced',
  })
  assert.equal(advanced.status, 'confirmed')
  const records = harness.written.filter((event) => event.type === FINDING_RECORD_TYPE && event.data.findingId === 'f-001')
  assert.deepEqual(records.at(-1).data.evidence, [{ kind: 'tool-result', seq: 0, callId: 'call-ok' }])
})

test('tool-evidenced fails closed when no successful tool/result exists', async () => {
  const harness = makeHarness()
  installFindings(harness.ctx, { sessionId: 'session-test', root: process.cwd(), append: harness.append })
  const tool = harness.registrations.tools[0]

  await tool.execute({ claim: '没有证据的假设' })
  await assert.rejects(
    tool.execute({ claim: '没有证据的假设', findingId: 'f-001', status: 'refuted', provenance: 'tool-evidenced' }),
    /requires a successful tool\/result/,
  )
})
