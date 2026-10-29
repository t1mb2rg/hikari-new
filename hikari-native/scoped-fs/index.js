/**
 * Scoped filesystem tools for Hikari.
 *
 * Why this exists: the DSH filesystem tools have no *read* fence.
 * `dsh-fs-sandbox` documents it in its own header — "fences write/edit by the
 * per-call sandbox mode ... while reads pass through" — and `dsh-tool-fs-search`
 * resolves an absolute path through `toWorkdirRelative`, which returns an
 * out-of-root path unchanged. So `read` / `glob` / `grep` can reach any file the
 * process can read, and a system prompt cannot hold that boundary.
 *
 * This plugin replaces those three tools with versions whose search root is a
 * hard boundary. Every path is resolved against `root` and checked twice:
 * lexically (so `..` cannot walk out) and through `realpath` (so a symlink
 * cannot point out). A refusal is an explicit error, never a silent empty result.
 *
 * It registers no write/edit tool and spawns no process, so its own authority is
 * read-only by construction.
 */
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'

export const name = 'hikari-native-v0/scoped-fs'
export const inject = ['tools']

const MAX_GREP_FILE_BYTES = 2 * 1024 * 1024
const MAX_GREP_LINE_CHARS = 400
const DEFAULT_SKIP_DIRS = ['node_modules', '.git', 'dist', '.pnpm-store']

function within(root, target) {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function realOf(path) {
  try {
    return realpathSync.native(path)
  } catch {
    return path
  }
}

/**
 * Resolve one model-supplied path inside `root`, or throw a refusal.
 *
 * Exported so the boundary can be tested as a plain function call. A
 * prompt-only guarantee could not be verified this way — that is the point.
 */
export function resolveWithin(root, input, kind = 'read') {
  const base = resolve(root)
  const raw = typeof input === 'string' && input.length > 0 ? input : '.'
  const abs = isAbsolute(raw) ? resolve(raw) : resolve(base, raw)
  if (!within(base, abs)) {
    throw new Error(
      `scoped-fs: "${raw}" is outside the authorized directory. This agent may only ${kind} inside ${base}.`,
    )
  }
  const real = realOf(abs)
  if (!within(realOf(base), real)) {
    throw new Error(
      `scoped-fs: "${raw}" resolves outside the authorized directory (symlink target ${real}). ` +
        `This agent may only ${kind} inside ${base}.`,
    )
  }
  return abs
}

function globToRegExp(pattern) {
  let out = '^'
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i]
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        out += '.*'
        i += 1
        if (pattern[i + 1] === '/') i += 1
      } else out += '[^/]*'
    } else if (c === '?') out += '[^/]'
    else if ('\\^$+.()|{}[]'.includes(c)) out += `\\${c}`
    else out += c
  }
  return new RegExp(`${out}$`)
}

/** Minimal tool factory: the registry requires `output.render` to be a function. */
function tool(definition) {
  return definition
}

export function apply(ctx, config) {
  const root = resolve(config.root)
  const rootReal = realOf(root)
  const skip = new Set(config.skipDirs ?? DEFAULT_SKIP_DIRS)
  const maxResults = config.maxResults ?? 200
  const maxReadLines = config.maxReadLines ?? 2000

  const guard = (input, kind) => resolveWithin(root, input, kind)

  function* walk(dir, depth = 0) {
    if (depth > 24) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isSymbolicLink()) {
        if (!within(rootReal, realOf(full))) continue
      }
      if (entry.isDirectory()) {
        if (skip.has(entry.name)) continue
        yield* walk(full, depth + 1)
      } else if (entry.isFile()) {
        yield full
      }
    }
  }

  ctx.tools.register(
    tool({
      name: 'read',
      description: 'Read a UTF-8 text file inside the authorized directory and return line-numbered content.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          file_path: { type: 'string', description: 'Path to read. Relative paths resolve against the authorized directory.' },
          offset: { type: 'number', description: '1-based first line to return. Defaults to 1.' },
          limit: { type: 'number', description: `Maximum lines to return. Defaults to ${maxReadLines}.` },
        },
        required: ['file_path'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string' },
            text: { type: 'string' },
            truncated: { type: 'boolean' },
          },
          required: ['path', 'text', 'truncated'],
        },
        render: (args, value) => [{ type: 'text', text: value.text }],
      },
      async execute(args) {
        const target = guard(args.file_path, 'read')
        if (statSync(target).isDirectory()) throw new Error(`scoped-fs: "${args.file_path}" is a directory, not a file.`)
        const lines = readFileSync(target, 'utf8').split(/\r\n|\n/)
        const offset = Math.max(1, Math.trunc(args.offset ?? 1))
        const limit = Math.max(1, Math.trunc(args.limit ?? maxReadLines))
        const slice = lines.slice(offset - 1, offset - 1 + limit)
        const text = slice.map((line, index) => `${offset + index}: ${line}`).join('\n')
        return { path: target, text, truncated: offset - 1 + limit < lines.length }
      },
    }),
  )

  ctx.tools.register(
    tool({
      name: 'glob',
      description: 'Find files by path pattern inside the authorized directory.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          pattern: { type: 'string', description: 'Glob pattern, e.g. "**/*.md".' },
          path: { type: 'string', description: 'Directory to search in. Defaults to the authorized directory.' },
        },
        required: ['pattern'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            root: { type: 'string' },
            paths: { type: 'array', items: { type: 'string' } },
            count: { type: 'number' },
            truncated: { type: 'boolean' },
          },
          required: ['root', 'paths', 'count', 'truncated'],
        },
        render: (args, value) => [{
          type: 'text',
          text: value.count === 0
            ? 'No files found'
            : `${value.paths.join('\n')}\n\n(Showing ${value.count} paths${value.truncated ? ', truncated' : ''})`,
        }],
      },
      async execute(args) {
        const base = guard(args.path ?? '.', 'search')
        const matcher = globToRegExp(args.pattern.replaceAll('\\', '/'))
        const hits = []
        let truncated = false
        for (const file of walk(base)) {
          const rel = relative(root, file).replaceAll('\\', '/')
          if (!matcher.test(rel)) continue
          if (hits.length >= maxResults) {
            truncated = true
            break
          }
          hits.push(rel)
        }
        return { root, paths: hits, count: hits.length, truncated }
      },
    }),
  )

  ctx.tools.register(
    tool({
      name: 'grep',
      description: 'Search file contents with a regular expression inside the authorized directory.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          pattern: { type: 'string', description: 'Regular expression.' },
          path: { type: 'string', description: 'File or directory to search. Defaults to the authorized directory.' },
          include: { type: 'string', description: 'Optional file-name glob filter, e.g. "*.ts".' },
        },
        required: ['pattern'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            root: { type: 'string' },
            matches: { type: 'array', items: { type: 'string' } },
            count: { type: 'number' },
            truncated: { type: 'boolean' },
          },
          required: ['root', 'matches', 'count', 'truncated'],
        },
        render: (args, value) => [{
          type: 'text',
          text: value.count === 0
            ? 'No matches'
            : `${value.matches.join('\n')}\n\n(${value.count} matches${value.truncated ? ', truncated' : ''})`,
        }],
      },
      async execute(args) {
        const base = guard(args.path ?? '.', 'search')
        const re = new RegExp(args.pattern)
        const include = args.include === undefined ? undefined : globToRegExp(args.include)
        const files = statSync(base).isDirectory() ? [...walk(base)] : [base]
        const matches = []
        let truncated = false
        for (const file of files) {
          const rel = relative(root, file).replaceAll('\\', '/')
          if (include !== undefined && !include.test(rel)) continue
          let size
          try {
            size = statSync(file).size
          } catch {
            continue
          }
          if (size > MAX_GREP_FILE_BYTES) continue
          let text
          try {
            text = readFileSync(file, 'utf8')
          } catch {
            continue
          }
          const lines = text.split(/\r\n|\n/)
          for (let i = 0; i < lines.length; i += 1) {
            if (!re.test(lines[i])) continue
            if (matches.length >= maxResults) {
              truncated = true
              break
            }
            const shown = lines[i].length > MAX_GREP_LINE_CHARS ? `${lines[i].slice(0, MAX_GREP_LINE_CHARS)}…` : lines[i]
            matches.push(`${rel}:${i + 1}: ${shown}`)
          }
          if (truncated) break
        }
        return { root, matches, count: matches.length, truncated }
      },
    }),
  )

  ctx.logger?.info?.(`scoped-fs: root=${root}`)
}
