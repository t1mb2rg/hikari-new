import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { summarizePorcelain, tidyOutput } from '../../hikari-native/project-status/index.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`ok ${passed} - ${name}`)
}

test('clean tree has zero counts', () => {
  const r = summarizePorcelain('')
  assert.equal(r.total, 0)
  assert.deepEqual(r.counts, { modified: 0, added: 0, deleted: 0, untracked: 0, other: 0 })
})

test('untracked, modified, added, deleted are counted', () => {
  const r = summarizePorcelain([
    '?? new-file.txt',
    ' M src/index.js',
    'A  staged-new.js',
    ' D deleted.js',
    'M  staged-mod.js',
  ].join('\n'))
  assert.equal(r.total, 5)
  assert.deepEqual(r.counts, { modified: 2, added: 1, deleted: 1, untracked: 1, other: 0 })
})

test('paths are bounded to 20 entries', () => {
  const lines = Array.from({ length: 30 }, (_, i) => `?? f${i}.txt`)
  const r = summarizePorcelain(lines.join('\n'))
  assert.equal(r.total, 30)
  assert.equal(r.paths.length, 20)
})

test('paths strip the porcelain status prefix', () => {
  const r = summarizePorcelain('?? hikari-native/project-status/index.js')
  assert.equal(r.paths[0], 'hikari-native/project-status/index.js')
})

test('real repository porcelain round-trips through summarizePorcelain', () => {
  const root = 'G:\\work\\LAB\\code\\projects\\own\\hikari-new'
  const porcelain = execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' })
  const r = summarizePorcelain(porcelain)
  const expected = porcelain.split(/\r?\n/).filter(Boolean).length
  assert.equal(r.total, expected)
})

test('branch and HEAD are readable from the real repository', () => {
  const root = 'G:\\work\\LAB\\code\\projects\\own\\hikari-new'
  const branch = execFileSync('git', ['-C', root, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim()
  const head = execFileSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
  assert.ok(branch.length > 0)
  assert.match(head, /^[0-9a-f]{4,}$/)
})

test('tidyOutput keeps the leading space of a worktree-only change', () => {
  const raw = ' M hikari-native/cordis.patch.yml\n?? hikari-native/project-status/index.js\n'
  const tidy = tidyOutput(raw)
  assert.equal(tidy.startsWith(' M '), true)
  const r = summarizePorcelain(tidy)
  assert.equal(r.counts.modified, 1)
  assert.equal(r.paths[0], 'hikari-native/cordis.patch.yml')
})

test('tidyOutput strips only the final newline', () => {
  assert.equal(tidyOutput('a\nb\n'), 'a\nb')
  assert.equal(tidyOutput('a\nb'), 'a\nb')
  assert.equal(tidyOutput(''), '')
})

console.log(`\n${passed}/${passed} passed`)
