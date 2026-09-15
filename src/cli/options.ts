export interface CliOptions {
  readonly dataDir: string;
}

export interface CommandOutcome {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type CliCommand = 'init' | 'chronicle-init' | 'start';

export interface ParsedCommandLine {
  readonly command: CliCommand;
  readonly options: CliOptions;
}

export class UsageError extends Error {}

export const INIT_HINT = '请先运行：hikari init --data-dir <path>';
export const CHRONICLE_INIT_HINT = '请运行：hikari chronicle init --data-dir <path>';

export const USAGE = [
  '用法：',
  '  hikari init --data-dir <path>',
  '  hikari chronicle init --data-dir <path>',
  '  hikari start --data-dir <path>',
  '',
  '选项：',
  '  --data-dir <path>  数据根目录，必填，没有默认值',
  '',
].join('\n');

export function parseCommandLine(argv: readonly string[]): ParsedCommandLine {
  const [head, ...rest] = argv;
  const { command, tokens } = readCommand(head, rest);
  return { command, options: readOptions(tokens) };
}

interface CommandTokens {
  readonly command: CliCommand;
  readonly tokens: readonly string[];
}

function readCommand(head: string | undefined, rest: readonly string[]): CommandTokens {
  if (head === 'init') return { command: 'init', tokens: rest };
  if (head === 'start') return { command: 'start', tokens: rest };
  if (head === 'chronicle') return readChronicleCommand(rest);
  throw new UsageError(head === undefined ? '缺少命令。' : `未知命令：${head}`);
}

function readChronicleCommand(rest: readonly string[]): CommandTokens {
  const [sub, ...tokens] = rest;
  if (sub !== 'init') {
    throw new UsageError(`chronicle 只支持 init，收到：${sub ?? '(缺失)'}`);
  }
  return { command: 'chronicle-init', tokens };
}

function readOptions(tokens: readonly string[]): CliOptions {
  let dataDir: string | undefined;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token !== '--data-dir') throw new UsageError(`未知参数：${String(token)}`);
    if (dataDir !== undefined) throw new UsageError('--data-dir 只能指定一次。');

    const value = tokens[index + 1];
    if (value === undefined) throw new UsageError('--data-dir 需要一个路径。');
    if (!value.trim()) throw new UsageError('--data-dir 不能是空路径。');

    dataDir = value;
    index += 1;
  }

  if (dataDir === undefined) throw new UsageError('缺少必填参数：--data-dir');
  return { dataDir };
}
