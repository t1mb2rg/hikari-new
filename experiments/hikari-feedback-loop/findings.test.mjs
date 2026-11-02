import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyFindingRecord,
  installFindings,
  normalizeClaim,
  readFinding,
  renderFindings,
  searchFindings,
  validateEvidence,
  FINDING_RECORD_TYPE,
  FINDINGS_PROJECTION_KEY,
  SEARCH_BUDGET_CHARS,
  SEARCH_LINE_MAX,
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
  const [body, visibility] = text.split('\n\n记忆可见性：')
  const lines = body.split('\n').slice(1)
  assert.equal(lines.length, 3)
  assert.match(text, /claim-5/)
  assert.match(text, /claim-4/)
  assert.match(text, /claim-3/)
  assert.doesNotMatch(text, /claim-2/)
  assert.doesNotMatch(text, /claim-1/)

  // 可见性独立于 1200 字符预算：它只说「还有更多」，不暗示哪些值得读。
  assert.ok(visibility !== undefined)
  assert.match(visibility, /^当前展示 3 条有效 Finding，另有 2 条有效 Finding 未注入/)
  assert.match(visibility, /search_memory/)

  const long = renderFindings({ 'f-001': { ...baseRecord(), claim: 'x'.repeat(2000) } })
  // 一条都放不下时，body 为空，整段只剩可见性——它不把超长 claim 带出来。
  assert.match(long, /^记忆可见性：当前展示 0 条有效 Finding，另有 1 条/)
  assert.ok(long.length < 200)
})

test('renderFindings visibility is independent of the content budget', () => {
  // 字符预算连一条都放不下时，内容为空，但可见性仍要说清「有东西没注入」。
  const long = renderFindings({ 'f-001': { ...baseRecord(), findingId: 'f-001', claim: 'x'.repeat(2000) } })
  assert.doesNotMatch(long, /Hikari 当前认识/)
  assert.match(long, /^记忆可见性：当前展示 0 条有效 Finding，另有 1 条/)

  // 有效发现全部展示时，不出现可见性提示（不制造「你漏看了」的噪声）。
  const single = renderFindings({ 'f-001': { ...baseRecord(), findingId: 'f-001', claim: '只有一条' } })
  assert.match(single, /Hikari 当前认识/)
  assert.doesNotMatch(single, /记忆可见性/)
})

test('renderFindings returns empty string without current findings', () => {
  assert.equal(renderFindings({}), '')
})

test('searchFindings returns candidates, never the full text', () => {
  const findings = {
    'f-001': { ...baseRecord(), findingId: 'f-001', claim: 'read 工具没有按 root 围栏，绝对路径能读到外面', recordedAt: 1000 },
    'f-002': { ...baseRecord(), findingId: 'f-002', claim: 'world 的 settle 只有防抖，没有值不值得的判断', recordedAt: 2000 },
    'f-003': { ...baseRecord(), findingId: 'f-003', claim: 'read 越界是 sandbox 只栅栏写入导致的', recordedAt: 3000 },
  }
  const answer = searchFindings(findings, { query: 'read 越界 围栏' })
  assert.equal(answer.total, 2)
  assert.equal(answer.shown, 2)
  assert.equal(answer.hasMore, false)
  assert.equal(answer.nextOffset, null)
  // 两条都命中 read 相关；按命中词数降序，f-001 命中「read/围栏」两条，f-003 命中「read/越界」
  assert.deepEqual(answer.results.map((r) => r.id).sort(), ['f-001', 'f-003'])
  for (const item of answer.results) {
    assert.ok(Object.keys(item).sort().join(',') === 'at,chars,id,line,status')
    assert.ok(item.line.length <= SEARCH_LINE_MAX)
    assert.equal(item.status, 'open')
    assert.equal(item.chars, findings[item.id].claim.length)
  }
  // 正文不进检索结果：line 是摘录，claims 里的完整句子不应原样出现在任何 line 里
  assert.ok(answer.results.every((r) => r.line.length <= SEARCH_LINE_MAX))
})

test('searchFindings tokenizes Chinese without a word list', () => {
  const findings = {
    'f-001': { ...baseRecord(), findingId: 'f-001', claim: '记忆检索缺少读全文的入口', recordedAt: 1 },
    'f-002': { ...baseRecord(), findingId: 'f-002', claim: '窗口切换不等于认知需求', recordedAt: 2 },
  }
  assert.equal(searchFindings(findings, { query: '检索' }).total, 1)
  assert.equal(searchFindings(findings, { query: '认知' }).total, 1)
  assert.equal(searchFindings(findings, { query: '完全无关的词' }).total, 0)
})

test('searchFindings keeps the whole reply under the char budget by dropping rows', () => {
  const findings = {}
  for (let i = 1; i <= 12; i += 1) {
    findings[`f-0${String(i).padStart(2, '0')}`] = {
      ...baseRecord(),
      findingId: `f-0${String(i).padStart(2, '0')}`,
      claim: `共同前缀 memory 加上很长的尾巴 ${'x'.repeat(200)}`,
      recordedAt: i,
    }
  }
  const answer = searchFindings(findings, { query: 'memory', limit: 20 })
  assert.equal(answer.total, 12)
  assert.ok(answer.shown < 12, `expected fewer rows than matches, got ${answer.shown}`)
  assert.ok(answer.shown >= 1)
  assert.equal(answer.results.length, answer.shown)
  assert.ok(JSON.stringify(answer).length <= SEARCH_BUDGET_CHARS)
  // 削减只减行数，单条信息保持完整
  for (const item of answer.results) {
    assert.ok(item.line.length <= SEARCH_LINE_MAX)
    assert.equal(typeof item.id, 'string')
    assert.equal(typeof item.at, 'string')
    assert.equal(typeof item.chars, 'number')
  }
  assert.equal(answer.hasMore, true)
  assert.equal(answer.nextOffset, answer.shown)
})

test('searchFindings paginates without auto-advancing', () => {
  const findings = {}
  for (let i = 1; i <= 6; i += 1) {
    findings[`f-00${i}`] = { ...baseRecord(), findingId: `f-00${i}`, claim: `共同词 alpha 第 ${i} 条`, recordedAt: i }
  }
  const first = searchFindings(findings, { query: 'alpha', limit: 2 })
  assert.equal(first.total, 6)
  assert.equal(first.shown, 2)
  assert.equal(first.hasMore, true)
  assert.equal(first.nextOffset, 2)
  const second = searchFindings(findings, { query: 'alpha', limit: 2, offset: first.nextOffset })
  assert.equal(second.shown, 2)
  assert.equal(second.nextOffset, 4)
  const last = searchFindings(findings, { query: 'alpha', limit: 2, offset: 6 })
  assert.equal(last.shown, 0)
  assert.equal(last.hasMore, false)
  assert.equal(last.nextOffset, null)
})

test('searchFindings also reaches closed findings', () => {
  const findings = {
    'f-001': { ...baseRecord(), findingId: 'f-001', claim: '曾以为 cache 步骤在安装之后', status: 'refuted', recordedAt: 1 },
    'f-002': { ...baseRecord(), findingId: 'f-002', claim: 'cache 步骤确实在安装之前', status: 'resolved', recordedAt: 2 },
  }
  const answer = searchFindings(findings, { query: 'cache 安装' })
  assert.equal(answer.total, 2)
  assert.deepEqual(answer.results.map((r) => r.status).sort(), ['refuted', 'resolved'])
})

test('searchFindings returns nothing for an empty or unmatched query', () => {
  const findings = { 'f-001': { ...baseRecord(), findingId: 'f-001', claim: '只有这一条' } }
  assert.equal(searchFindings(findings, { query: '' }).total, 0)
  assert.equal(searchFindings(findings, { query: '   ' }).total, 0)
  assert.equal(searchFindings(findings, { query: 'zzz-not-there' }).total, 0)
  assert.equal(searchFindings({}, { query: '任何' }).total, 0)
})

test('searchFindings requires two hits for multi-word queries', () => {
  // 中文二字滑窗会产生跨词边界的假 bigram（「到的」「全找」）。一句话查询要求至少两个
  // 不同的词同时出现，否则一串无关的话会靠一个常见 bigram 蒙到一堆记录上。
  const findings = {
    'f-001': { ...baseRecord(), findingId: 'f-001', claim: '用与 f-004 完全相同的 claim 触发去重', recordedAt: 1 },
  }
  assert.equal(searchFindings(findings, { query: '无关的 描述 词' }).total, 0)
  // 单个词（或单字）仍然命中即召回：短查询就是精确意图
  assert.equal(searchFindings(findings, { query: '完全相同' }).total, 1)
  assert.equal(searchFindings(findings, { query: '去重' }).total, 1)
})

test('readFinding returns one finding with status and its plain-language reading', () => {
  const findings = {
    'f-001': {
      ...baseRecord(),
      findingId: 'f-001',
      status: 'confirmed',
      provenance: 'tool-evidenced',
      claim: 'cache 步骤在安装之前',
      evidence: [{ kind: 'tool-result', seq: 42, callId: 'call-1' }],
      recordedAt: 1793328082149,
    },
  }
  const answer = readFinding(findings, { id: 'f-001' })
  assert.equal(answer.id, 'f-001')
  assert.equal(answer.findingId, 'f-001')
  assert.equal(answer.status, 'confirmed')
  assert.equal(answer.statusReading, '有工具证据支持，尚未独立验证')
  assert.equal(answer.provenance, 'tool-evidenced')
  assert.equal(answer.claim, 'cache 步骤在安装之前')
  assert.deepEqual(answer.evidence, [{ kind: 'tool-result', seq: 42, callId: 'call-1' }])
  assert.equal(answer.scope.project, 'C:/repo')
  assert.equal(answer.text, 'cache 步骤在安装之前')
  assert.equal(answer.offset, 0)
  assert.equal(answer.totalChars, 13)
  assert.equal(answer.truncated, false)
  assert.equal(answer.recordedAt, 1793328082149)
})

test('readFinding gives every status a reading that does not overclaim', () => {
  const make = (status) => readFinding({ 'f-001': { ...baseRecord(), findingId: 'f-001', status } }, { id: 'f-001' })
  assert.equal(make('open').statusReading, '此前的假设，尚未验证')
  assert.equal(make('confirmed').statusReading, '有工具证据支持，尚未独立验证')
  assert.equal(make('resolved').statusReading, '基于后续证据作出的关闭判断，不保证问题永远不存在')
  assert.equal(make('refuted').statusReading, '在此前的检验范围内被否定')
})

test('readFinding windows the text and reports truncation honestly', () => {
  const claim = '一二三四五六七八九十'
  const findings = { 'f-001': { ...baseRecord(), findingId: 'f-001', claim } }
  const head = readFinding(findings, { id: 'f-001', limit: 4 })
  assert.equal(head.text, '一二三四')
  assert.equal(head.totalChars, 10)
  assert.equal(head.truncated, true)
  const tail = readFinding(findings, { id: 'f-001', offset: 8, limit: 4 })
  assert.equal(tail.text, '九十')
  assert.equal(tail.offset, 8)
  assert.equal(tail.truncated, false)
  const past = readFinding(findings, { id: 'f-001', offset: 99 })
  assert.equal(past.text, '')
  assert.equal(past.offset, 10)
  assert.equal(past.truncated, false)
})

test('readFinding fails loudly on an unknown id', () => {
  assert.throws(() => readFinding({}, { id: 'f-999' }), /unknown finding id "f-999"/)
  assert.throws(() => readFinding({}, { id: '' }), /unknown finding id/)
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

test('installFindings registers projection, context and all three memory tools', () => {
  const harness = makeHarness()
  installFindings(harness.ctx, { sessionId: 'session-test', root: process.cwd(), append: harness.append })
  assert.equal(harness.registrations.projection.key, FINDINGS_PROJECTION_KEY)
  assert.equal(harness.registrations.projection.stateVersion, 1)
  assert.equal(harness.registrations.contexts.length, 1)
  assert.equal(harness.registrations.contexts[0].name, 'hikari:findings')
  assert.deepEqual(
    harness.registrations.tools.map((tool) => tool.name),
    ['record_finding', 'search_memory', 'read_memory'],
  )
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
  assert.deepEqual(created.evidence, [])

  const duplicate = await tool.execute({ claim: 'project_status 不显示 stash' })
  assert.equal(duplicate.deduplicated, true)
  assert.equal(duplicate.findingId, 'f-001')
  assert.deepEqual(duplicate.evidence, [])

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
  assert.deepEqual(advanced.evidence, [{ kind: 'tool-result', seq: 0, callId: 'call-1' }])

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
  assert.deepEqual(advanced.evidence, [{ kind: 'tool-result', seq: 0, callId: 'call-ok' }])
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
