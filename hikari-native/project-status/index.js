/**
 * Read-only project state evidence for Hikari.
 *
 * Why this exists: v1 showed that the only driver (foreground window title)
 * carries almost no information about whether the project is actually
 * progressing, and Hikari's evidence was limited to reading file text. Reading
 * a report is not the same as verifying repository state — that gap is what
 * produced the record-integrity mis-attribution. This plugin exposes a fixed,
 * read-only view of git state: branch, HEAD, working-tree changes, recent
 * commits.
 *
 * It runs no arbitrary commands: subcommands are fixed, arguments are
 * hard-coded except for a small commit-count bound, and there is no shell.
 * A failure returns an error object, never a silent empty result.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

export const name = 'hikari-project-status'
export const inject = ['tools']

const MAX_BUFFER = 1024 * 1024
const MAX_PATHS = 20

/**
 * Strip only the trailing newline from git stdout. Never trim the whole
 * output: `git status --porcelain` lines start with two status columns, and a
 * worktree-only modification like ` M hikari-native/...` begins with a space.
 * A leading trim would shift that first line and corrupt its path.
 */
export function tidyOutput(stdout) {
  return stdout.replace(/\r?\n$/, '')
}

export async function git(root, args) {
  const { stdout } = await run('git', ['-C', root, ...args], {
    timeout: 5000,
    windowsHide: true,
    maxBuffer: MAX_BUFFER,
    encoding: 'utf8',
  })
  return tidyOutput(stdout)
}

/**
 * Summarize `git status --porcelain` output into counts plus a bounded path
 * list. Exported so the mapping can be tested as a plain function call.
 */
export function summarizePorcelain(porcelain) {
  const lines = porcelain.split(/\r?\n/).filter(Boolean)
  const counts = { modified: 0, added: 0, deleted: 0, untracked: 0, other: 0 }
  const paths = []
  for (const line of lines) {
    const code = line.slice(0, 2)
    if (line.startsWith('??')) counts.untracked += 1
    else if (code[0] === 'A' || code[1] === 'A') counts.added += 1
    else if (code[0] === 'D' || code[1] === 'D') counts.deleted += 1
    else if (code[0] === 'M' || code[1] === 'M' || code[0] === 'R' || code[1] === 'R') counts.modified += 1
    else counts.other += 1
    if (paths.length < MAX_PATHS) paths.push(line.slice(3).trim())
  }
  return { counts, paths, total: lines.length }
}

export function apply(ctx, config) {
  const root = String(config.root ?? process.cwd())
  const defaultLimit = Math.max(1, Math.min(20, Number(config.limit ?? 5)))

  ctx.tools.register({
    name: 'project_status',
    description:
      'Read-only repository state evidence: current branch, HEAD commit, working-tree changes, and recent commits. ' +
      'Use this when you need to know whether the project is actually progressing, instead of inferring it from documents.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        limit: {
          type: 'number',
          description: 'How many recent commits to include (1-20). Defaults to 5.',
        },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      const limit = Math.max(1, Math.min(20, Number(args?.limit ?? defaultLimit)))
      try {
        const [branch, headShort, headSubject, statusOut, logOut] = await Promise.all([
          git(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
          git(root, ['rev-parse', '--short', 'HEAD']),
          git(root, ['log', '-1', '--format=%s']),
          git(root, ['status', '--porcelain']),
          git(root, ['log', `-n${limit}`, '--format=%h %s']),
        ])
        const changes = summarizePorcelain(statusOut)
        return {
          root,
          branch,
          head: { short: headShort, subject: headSubject },
          workingTree: {
            clean: changes.total === 0,
            total: changes.total,
            counts: changes.counts,
            paths: changes.paths,
          },
          recentCommits: logOut.split(/\r?\n/).filter(Boolean),
        }
      } catch (error) {
        return { root, error: String(error?.message ?? error) }
      }
    },
  })

  ctx.logger?.info?.(`project-status: root=${root}`)
}
