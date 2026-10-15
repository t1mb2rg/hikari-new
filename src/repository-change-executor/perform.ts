// The eight tools, executed. Every one of them is a fixed program with fixed arguments — the model
// supplies values, never a command. There is no shell in this file, and no tool that could become one:
// the list lives in `tools.ts`, and adding a ninth is a boundary decision rather than an edit.
//
// Three rules hold this file together:
//   * every path a tool names goes through containment before anything touches the disk;
//   * a refusal is an answer the model can read and act on, not an exception — the loop above it is
//     what decides when to stop;
//   * nothing here reaches outside the working directory it was given, and nothing here asks the
//     network. `read_ci` is whatever the deployment wired in, or an honest "not wired".

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { containTarget } from './containment.js';
import { runGit, type GitBudgets } from './git.js';
import type { RepositoryChangeTool } from './tools.js';

/** How much of one file a `read_file` will put in front of the model. */
const MAX_READ_BYTES = 64 * 1024;
/** How many names one `list_directory` will put in front of the model. */
const MAX_LISTED_ENTRIES = 200;
/** How much diff one `git_diff` will put in front of the model. */
const MAX_DIFF_BYTES = 32 * 1024;
/** Every tool answer is cut to this before it becomes a message. */
const MAX_ANSWER_CHARS = 12 * 1024;

export interface PerformedTool {
  /** Whether the tool did what it was asked. A refusal is `false` with a reason in `content`. */
  readonly ok: boolean;
  /** What the model is shown. Always present, always bounded. */
  readonly content: string;
  /** True when the repository's own rules stopped the call, as opposed to the call failing. */
  readonly refused: boolean;
}

export interface PerformToolInput {
  readonly tool: RepositoryChangeTool;
  readonly values: Readonly<Record<string, string>>;
  /** The working directory: the declared root this run is confined to. */
  readonly root: string;
  /** How `read_ci` is answered, when the deployment chose to wire one in. */
  readonly readCi: (() => Promise<string>) | undefined;
  /** Git budgets and cancellation, passed straight through to every git call in this file. */
  readonly budgets: GitBudgets | undefined;
  readonly signal: AbortSignal | undefined;
}

export async function performTool(input: PerformToolInput): Promise<PerformedTool> {
  const { tool, values } = input;

  switch (tool.name) {
    case 'read_file':
      return readFileTool(input, values.path ?? '');
    case 'list_directory':
      return listDirectoryTool(input, values.path ?? '');
    case 'git_status':
      return gitStatusTool(input);
    case 'git_diff':
      return gitDiffTool(input);
    case 'read_ci':
      return readCiTool(input);
    case 'write_file':
      return writeFileTool(input, values.path ?? '', values.content ?? '');
    case 'git_commit':
      return gitCommitTool(input, values.message ?? '');
    case 'git_push':
      return gitPushTool(input);
    default:
      // Unreachable through the loop — `findTool` refuses names outside the table — and answered
      // rather than thrown so that a future caller which skips that lookup still gets a sentence.
      return refused(`这个执行者没有名叫 ${tool.name} 的工具。`);
  }
}

async function readFileTool(input: PerformToolInput, path: string): Promise<PerformedTool> {
  const verdict = containTarget(input.root, path);
  if (verdict.kind !== 'inside') return refused(describeContainment(verdict.kind, path, verdict.reason));

  let bytes: Buffer;
  try {
    bytes = await readFile(verdict.absolute);
  } catch (error) {
    return failed(`读 ${path} 失败：${describeError(error)}`);
  }

  if (bytes.includes(0)) return failed(`${path} 看起来不是文本文件，没有把它交给模型。`);

  const cut = bytes.subarray(0, MAX_READ_BYTES);
  const text = cut.toString('utf8');
  const lines = text.split('\n');
  const numbered = lines.map((line, index) => `${String(index + 1).padStart(5, ' ')}  ${line}`).join('\n');
  const note = bytes.length > MAX_READ_BYTES ? `\n（只给了前 ${MAX_READ_BYTES} 字节，这个文件更长。）` : '';

  return answered(`${path}\n${bounded(numbered)}${note}`);
}

async function listDirectoryTool(input: PerformToolInput, path: string): Promise<PerformedTool> {
  const verdict = containTarget(input.root, path === '' ? '.' : path);
  if (verdict.kind !== 'inside') return refused(describeContainment(verdict.kind, path, verdict.reason));

  let entries;
  try {
    entries = await readdir(verdict.absolute, { withFileTypes: true });
  } catch (error) {
    return failed(`列 ${path} 失败：${describeError(error)}`);
  }

  const names = entries
    .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
    .sort((left, right) => left.localeCompare(right));
  const shown = names.slice(0, MAX_LISTED_ENTRIES);
  const note = names.length > shown.length ? `\n（还有 ${names.length - shown.length} 个名字没有列出来。）` : '';

  return answered(`${path === '' ? '.' : path}\n${shown.join('\n')}${note}`);
}

async function gitStatusTool(input: PerformToolInput): Promise<PerformedTool> {
  const run = await runGit(input.root, ['status', '--porcelain', '--branch'], input.budgets, input.signal);
  return fromGitRun(run, 'git status');
}

async function gitDiffTool(input: PerformToolInput): Promise<PerformedTool> {
  // `--stat` first, then the patch: a model that reads only the beginning of the answer still learns
  // which files moved, and the patch is what it needs when it reads on.
  const stat = await runGit(input.root, ['diff', '--no-color', '--stat'], input.budgets, input.signal);
  if (stat.kind !== 'ok') return fromGitRun(stat, 'git diff');

  const patch = await runGit(input.root, ['diff', '--no-color'], input.budgets, input.signal);
  if (patch.kind !== 'ok') return fromGitRun(patch, 'git diff');

  const statText = stat.stdout.trim() === '' ? '（工作区与 HEAD 没有差异。）' : stat.stdout.trim();
  return answered(`${statText}\n\n${bounded(patch.stdout.slice(0, MAX_DIFF_BYTES))}`);
}

async function readCiTool(input: PerformToolInput): Promise<PerformedTool> {
  if (input.readCi === undefined) {
    return failed('这次运行没有接 CI 读取：这个部署没有给执行者一条读 CI 的路。');
  }

  try {
    return answered(bounded(await input.readCi()));
  } catch (error) {
    return failed(`读 CI 失败：${describeError(error)}`);
  }
}

async function writeFileTool(input: PerformToolInput, path: string, content: string): Promise<PerformedTool> {
  const verdict = containTarget(input.root, path);
  if (verdict.kind !== 'inside') return refused(describeContainment(verdict.kind, path, verdict.reason));

  try {
    // The parent has to exist for a file that does not exist yet; `recursive` makes a nested path work
    // as one call, and containment has already said every part of it is inside the working directory.
    await mkdir(dirname(verdict.absolute), { recursive: true });
    await writeFile(verdict.absolute, content, 'utf8');
  } catch (error) {
    return failed(`写 ${path} 失败：${describeError(error)}`);
  }

  return answered(`已写入 ${path}（${Buffer.byteLength(content, 'utf8')} 字节）。`);
}

async function gitCommitTool(input: PerformToolInput, message: string): Promise<PerformedTool> {
  if (message.trim() === '') return refused('git_commit 要一条非空的提交信息。');

  // `add -A` rather than paths: the tool exists so the model can put what it did into a commit, and it
  // is the only thing that stages. Whatever was already uncommitted in the working directory travels
  // with it — `execute.ts` writes `dirtyBefore` into the record for exactly that reason, and the lines
  // it prints say so when it happened.
  const staged = await runGit(input.root, ['add', '-A'], input.budgets, input.signal);
  if (staged.kind !== 'ok') return fromGitRun(staged, 'git add');

  const committed = await runGit(input.root, ['commit', '-m', message], input.budgets, input.signal);
  return fromGitRun(committed, 'git commit');
}

async function gitPushTool(input: PerformToolInput): Promise<PerformedTool> {
  // Deliberately no `--force`, no remote argument, no branch argument: pushing is the one irreversible
  // step in this file, and what it pushes is decided by the repository's own configured upstream.
  const run = await runGit(input.root, ['push'], input.budgets, input.signal);
  return fromGitRun(run, 'git push');
}

function fromGitRun(run: Awaited<ReturnType<typeof runGit>>, what: string): PerformedTool {
  switch (run.kind) {
    case 'ok':
      return answered(`${what}：成功。\n${bounded(`${run.stdout}${run.stderr}`)}`);
    case 'failed':
      return failed(`${what}：失败（退出码 ${run.exitCode}）。\n${bounded(`${run.stdout}${run.stderr}`)}`);
    case 'timed-out':
      return failed(`${what}：超时，已经把它停下来了。`);
    case 'unavailable':
      return failed(`${what}：这台机器上没有可用的 git（${run.reason}）。`);
  }
}

function answered(content: string): PerformedTool {
  return { ok: true, content, refused: false };
}

function failed(content: string): PerformedTool {
  return { ok: false, content, refused: false };
}

function refused(content: string): PerformedTool {
  return { ok: false, content, refused: true };
}

function describeContainment(kind: 'outside' | 'unresolvable', path: string, reason: string): string {
  const what = kind === 'outside' ? '不在' : '落不到';
  return `${path} ${what}这次运行被允许改的那个工作目录里：${reason}`;
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message !== '') return error.message;
  return String(error);
}

function bounded(text: string): string {
  if (text.length <= MAX_ANSWER_CHARS) return text;
  return `${text.slice(0, MAX_ANSWER_CHARS)}\n（答案在这里截断，还有 ${text.length - MAX_ANSWER_CHARS} 个字符没有给出。）`;
}
