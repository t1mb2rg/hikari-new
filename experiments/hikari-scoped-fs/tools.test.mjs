/**
 * Loads hikari-native-v0/scoped-fs against a stub context, captures what it
 * registers, and calls the three tools for real.
 *
 * Two things are checked:
 *   1. the definitions satisfy what `ctx.tools.register` requires (a plain
 *      object with `output.render` as a function, JSON-Schema parameters), so
 *      the host will accept them without `defineTool`;
 *   2. every escape attempt through the tools — absolute path, `..`, symlink —
 *      returns a refusal instead of content.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../../hikari-native/scoped-fs/index.js'

const root = mkdtempSync(join(tmpdir(), 'scoped-tools-root-'))
const outside = mkdtempSync(join(tmpdir(), 'scoped-tools-outside-'))
mkdirSync(join(root, 'src'), { recursive: true })
writeFileSync(join(root, 'src', 'inside.txt'), 'alpha\nbeta\ngamma\n')
writeFileSync(join(root, 'README.md'), '# inside readme\nneedle\n')
writeFileSync(join(outside, 'secret.txt'), 'TOP-SECRET\n')

let linked = false
try {
  symlinkSync(outside, join(root, 'escape'), 'junction')
  linked = true
} catch {}

const registered = new Map()
const ctx = {
  tools: { register: (definition) => registered.set(definition.name, definition) },
  logger: { info: () => {} },
}

apply(ctx, { root, maxResults: 50, maxReadLines: 100 })

const problems = []
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n      ${detail}` : ''}`)
  if (!ok) problems.push(label)
}

console.log(`root    = ${root}`)
console.log(`outside = ${outside}`)
console.log(`tools   = ${[...registered.keys()].join(', ')}\n`)

check('注册了 read / glob / grep', ['read', 'glob', 'grep'].every((n) => registered.has(n)))
for (const [toolName, definition] of registered) {
  check(
    `${toolName} 的 definition 形状满足 register() 要求`,
    typeof definition.output?.render === 'function' && typeof definition.execute === 'function' && definition.parameters?.type === 'object',
  )
}

const run = async (toolName, args) => registered.get(toolName).execute(args, { signal: AbortSignal.timeout(5000) })

// 正常读取
const readOk = await run('read', { file_path: 'src/inside.txt' })
check('read 正常文件', readOk.text.includes('1: alpha') && readOk.text.includes('3: gamma'), readOk.text.split('\n')[0])

const globOk = await run('glob', { pattern: '**/*.md' })
check('glob 正常匹配', globOk.count === 1 && globOk.paths[0] === 'README.md', JSON.stringify(globOk.paths))

const grepOk = await run('grep', { pattern: 'needle' })
check('grep 正常匹配', grepOk.count === 1 && grepOk.matches[0].startsWith('README.md:2:'), grepOk.matches[0] ?? '')

// 越界尝试
const escapeAttempts = [
  ['read 绝对路径越界（.dsh）', 'read', { file_path: join(homedir(), '.dsh', 'storages') }],
  ['read 绝对路径越界（兄弟目录）', 'read', { file_path: join(outside, 'secret.txt') }],
  ['read 相对路径穿越', 'read', { file_path: '../outside.txt' }],
  ['glob 越界根', 'glob', { pattern: '*', path: outside }],
  ['glob 穿越根', 'glob', { pattern: '*', path: '..' }],
  ['grep 越界根', 'grep', { pattern: 'TOP-SECRET', path: outside }],
  ...(linked
    ? [
        ['read 符号链接逃逸', 'read', { file_path: 'escape/secret.txt' }],
        ['grep 符号链接目录', 'grep', { pattern: 'TOP-SECRET', path: 'escape' }],
      ]
    : []),
]

for (const [label, toolName, args] of escapeAttempts) {
  let leaked = false
  let message = ''
  try {
    const value = await run(toolName, args)
    const text = JSON.stringify(value)
    leaked = text.includes('TOP-SECRET') || text.includes('session_projcache') || text.includes('scoped-tools-outside')
    message = text.slice(0, 120)
  } catch (error) {
    message = error.message.slice(0, 120)
  }
  check(label, !leaked, message)
}

rmSync(root, { recursive: true, force: true })
rmSync(outside, { recursive: true, force: true })

console.log(problems.length === 0 ? '\n全部通过' : `\n失败 ${problems.length} 项: ${problems.join(' | ')}`)
process.exit(problems.length === 0 ? 0 : 1)
