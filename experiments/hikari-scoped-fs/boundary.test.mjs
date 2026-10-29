/**
 * Boundary test for hikari-native-v0/scoped-fs.
 *
 * The point is to prove the refusal does not depend on what the model was told:
 * every escape attempt here is a plain function call, not a prompt.
 */
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveWithin } from '../../hikari-native/scoped-fs/index.js'

const root = mkdtempSync(join(tmpdir(), 'scoped-fs-root-'))
const outside = mkdtempSync(join(tmpdir(), 'scoped-fs-outside-'))
mkdirSync(join(root, 'src'), { recursive: true })
writeFileSync(join(root, 'src', 'inside.txt'), 'inside\n')
writeFileSync(join(outside, 'secret.txt'), 'secret\n')

let linkCreated = false
try {
  symlinkSync(outside, join(root, 'escape-link'), 'junction')
  linkCreated = true
} catch (error) {
  console.log(`[skip] symlink creation failed: ${error.message}`)
}

const cases = [
  { name: '相对路径在根内', input: 'src/inside.txt', expect: 'allow' },
  { name: '绝对路径在根内', input: join(root, 'src', 'inside.txt'), expect: 'allow' },
  { name: '点号 = 根本身', input: '.', expect: 'allow' },
  { name: '相对路径穿越 ..', input: '../outside-look.txt', expect: 'deny' },
  { name: '深层穿越 ../../..', input: '../../../Windows/win.ini', expect: 'deny' },
  { name: '绝对路径越界（用户主目录）', input: join(homedir(), '.dsh', 'storages'), expect: 'deny' },
  { name: '绝对路径越界（临时目录兄弟）', input: join(outside, 'secret.txt'), expect: 'deny' },
  { name: '尾部混合 .. 逃逸', input: 'src/../../outside', expect: 'deny' },
  ...(linkCreated
    ? [
        { name: '符号链接指向根外', input: 'escape-link/secret.txt', expect: 'deny' },
        { name: '符号链接目录本身', input: 'escape-link', expect: 'deny' },
      ]
    : []),
]

const rows = []
let failures = 0
for (const item of cases) {
  let verdict
  let detail = ''
  try {
    const resolved = resolveWithin(root, item.input, 'read')
    verdict = 'allow'
    detail = resolved
  } catch (error) {
    verdict = 'deny'
    detail = error.message
  }
  const ok = verdict === item.expect
  if (!ok) failures += 1
  rows.push({ case: item.name, input: item.input, expected: item.expect, actual: verdict, ok, detail })
}

console.log(`root    = ${root}`)
console.log(`outside = ${outside}\n`)
for (const row of rows) {
  console.log(`${row.ok ? 'PASS' : 'FAIL'}  ${row.case}\n      in:  ${row.input}\n      ${row.actual}: ${row.detail.slice(0, 140)}`)
}
console.log(`\n${rows.length - failures}/${rows.length} 符合预期`)

rmSync(root, { recursive: true, force: true })
rmSync(outside, { recursive: true, force: true })
process.exit(failures === 0 ? 0 : 1)
