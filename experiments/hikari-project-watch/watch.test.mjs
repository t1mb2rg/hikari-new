/**
 * project-watch 的两层验证：
 *   1) diffProject 纯函数——它决定「什么算项目变了」，必须能被单测钉住。
 *   2) sampleProject 真实读——必须真的读到当前仓库，而不是返回空。
 * 刻意不测定时器与 emit：那段由真实实例的启动日志与 session 读数证明。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diffProject, sampleProject } from '../../hikari-native/project-watch/index.js'

const base = () => ({
  branch: 'main',
  head: { short: 'aaaaaaa', subject: 'feat: x' },
  workingTree: { clean: true, total: 0, counts: {} },
})

test('diffProject: nothing changed means no event', () => {
  assert.deepEqual(diffProject(base(), base()), [])
})

test('diffProject: head change alone is a project event', () => {
  const after = base()
  after.head = { short: 'bbbbbbb', subject: 'fix: y' }
  assert.deepEqual(diffProject(base(), after), ['head'])
})

test('diffProject: working-tree count change alone is a project event', () => {
  const after = base()
  after.workingTree = { clean: false, total: 3, counts: { modified: 3 } }
  assert.deepEqual(diffProject(base(), after), ['workingTree'])
})

test('diffProject: branch switch alone is a project event', () => {
  const after = base()
  after.branch = 'topic'
  assert.deepEqual(diffProject(base(), after), ['branch'])
})

test('diffProject: a changed commit subject with the same head is NOT a project event', () => {
  // head 短哈希是身份；subject 只是描述，单独改它不算仓库变了。
  const after = base()
  after.head = { short: 'aaaaaaa', subject: 'feat: rewritten message' }
  assert.deepEqual(diffProject(base(), after), [])
})

test('diffProject: missing baseline never emits', () => {
  assert.deepEqual(diffProject(undefined, base()), [])
  assert.deepEqual(diffProject(base(), undefined), [])
})

test('sampleProject reads the real repository', async () => {
  const root = process.cwd()
  const sample = await sampleProject(root)
  assert.ok(sample, 'sampleProject 不应返回 undefined')
  assert.match(sample.head.short, /^[0-9a-f]{7,}$/)
  assert.equal(typeof sample.branch, 'string')
  assert.ok(sample.branch.length > 0)
  assert.equal(typeof sample.workingTree.total, 'number')
  assert.equal(typeof sample.head.subject, 'string')
})

test('sampleProject reports a missing repository as undefined, not empty state', async () => {
  const sample = await sampleProject('Z:\\no-such-repo-for-hikari')
  assert.equal(sample, undefined)
})
