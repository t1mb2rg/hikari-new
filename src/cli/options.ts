import type { WorkFocusWord } from '../work-focus/index.js';

export interface CliOptions {
  readonly dataDir: string;
}

// `resident` takes one option the one-shot commands do not, and that option has no default: a
// resident that chose its own cadence would be deciding how often Hikari looks at the desktop.
export interface ResidentOptions extends CliOptions {
  readonly desktopAwarenessDelayMs: number;
}

// `focus` is the one command that takes operands, and they are exactly what a human typed. Nothing
// here trims them, folds them, splits them or asks what they name: the CLI's whole job with a
// designation is to carry it, which is also why there is no default and no enumeration.
export interface FocusOptions extends CliOptions {
  readonly word: WorkFocusWord;
  readonly designations: readonly string[];
}

export interface CommandOutcome {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type CliCommand = 'init' | 'chronicle-init' | 'start' | 'resident' | 'status' | 'stop' | 'focus';

// Only `resident` carries a parsed number, and the union is what keeps that obligation in the type
// rather than in a comment: the other commands cannot be handed a cadence at all. `status` and `stop`
// belong to the first arm for the same reason — what they need from argv is exactly a data directory,
// which is the whole of the first arm's obligation, so their arrival cannot widen any argument
// surface. In particular they do not take the cadence: reaching a running resident is not the same
// act as deciding how often it looks at the desktop, and a control command that could set a cadence
// would be a second way to configure the loop.
export type ParsedCommandLine =
  | { readonly command: 'init' | 'chronicle-init' | 'start' | 'status' | 'stop'; readonly options: CliOptions }
  | { readonly command: 'resident'; readonly options: ResidentOptions }
  | { readonly command: 'focus'; readonly options: FocusOptions };

export class UsageError extends Error {}

export const INIT_HINT = '请先运行：hikari init --data-dir <path>';
export const CHRONICLE_INIT_HINT = '请运行：hikari chronicle init --data-dir <path>';
export const RESIDENT_HINT =
  '请先运行：hikari resident --data-dir <path> --desktop-awareness-delay-ms <integer>';

export const USAGE = [
  '用法：',
  '  hikari init --data-dir <path>',
  '  hikari chronicle init --data-dir <path>',
  '  hikari start --data-dir <path>',
  '  hikari resident --data-dir <path> --desktop-awareness-delay-ms <integer>',
  '  hikari status --data-dir <path>',
  '  hikari stop --data-dir <path>',
  '  hikari focus declare --data-dir <path> <designation>',
  '  hikari focus replace --data-dir <path> <designation> [<designation> ...]',
  '  hikari focus clear --data-dir <path>',
  '  hikari focus status --data-dir <path>',
  '',
  '选项：',
  '  --data-dir <path>                        数据根目录，必填，没有默认值',
  '  --desktop-awareness-delay-ms <integer>   resident 的采集节奏，必填，没有默认值',
  '',
].join('\n');

// argv is text and this flag is a number, so the CLI has exactly one question to answer about it:
// is this token a number at all? That question is lexical. How large a cadence may be, whether it
// must be whole, whether zero is legal — those are domain rules, and they live in exactly one place:
// the loop's own `config.parse`. Nothing here re-decides them, and nothing here clamps, rounds or
// repairs a value. `0`, `-1`, `1.5` and `2147483648` all reach the loop untouched, so that whatever
// gets said about them is said by the component that has to schedule them.
//
// Precision is deliberately not policed either. A literal too large to be represented exactly as a
// double rounds here, but every such value lies past the loop's maximum by a wide margin, so it is
// rejected upstream for a reason the operator can act on rather than for one invented here.
const NUMBER_LITERAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export function parseCommandLine(argv: readonly string[]): ParsedCommandLine {
  const [head, ...rest] = argv;

  // `focus` resolves here rather than inside `readCommand`, and the reason is the one structural
  // difference it has: every other command's grammar is options alone, so the reader can hand back a
  // token list for the option reader to finish. `focus` has operands, and an operand is not an
  // option — handing a token list back would mean a second reader downstream that could not tell
  // which tokens were which.
  if (head === 'focus') return readFocusCommand(rest);

  const { command, tokens } = readCommand(head, rest);
  if (command === 'resident') return { command, options: readResidentOptions(tokens) };
  return { command, options: readOptions(tokens) };
}

// `focus` is excluded because this reader never produces it: its grammar needs operands, so it
// resolves to a whole `ParsedCommandLine` in `parseCommandLine` before this reader is reached. Saying
// so in the type is what keeps the token list below from being handed a command that has no token
// list to give.
interface CommandTokens {
  readonly command: Exclude<CliCommand, 'focus'>;
  readonly tokens: readonly string[];
}

function readCommand(head: string | undefined, rest: readonly string[]): CommandTokens {
  if (head === 'init') return { command: 'init', tokens: rest };
  if (head === 'start') return { command: 'start', tokens: rest };
  if (head === 'resident') return { command: 'resident', tokens: rest };
  if (head === 'status') return { command: 'status', tokens: rest };
  if (head === 'stop') return { command: 'stop', tokens: rest };
  if (head === 'chronicle') return readChronicleCommand(rest);
  throw new UsageError(head === undefined ? '缺少命令。' : `未知命令：${head}`);
}

// The words are the work focus plugin's vocabulary, and this table is typed by the owner's union: a
// word added there does not compile until it is added here too, and the message below is derived
// from the table rather than written out a third time. What this file must never acquire is an
// opinion about what a word *means* — the plugin is where the words actually do something.
const FOCUS_WORDS: Readonly<Record<WorkFocusWord, true>> = {
  declare: true,
  replace: true,
  clear: true,
  status: true,
};

function isWorkFocusWord(value: string): value is WorkFocusWord {
  return Object.hasOwn(FOCUS_WORDS, value);
}

function readFocusCommand(rest: readonly string[]): ParsedCommandLine {
  const [word, ...tokens] = rest;
  if (word === undefined || !isWorkFocusWord(word)) {
    const supported = Object.keys(FOCUS_WORDS).join(' / ');
    throw new UsageError(`focus 只支持 ${supported}，收到：${word ?? '(缺失)'}`);
  }

  const { dataDir, operands } = readFocusTokens(tokens);
  readFocusArity(word, operands);
  return { command: 'focus', options: { dataDir, word, designations: operands } };
}

interface FocusTokens {
  readonly dataDir: string;
  readonly operands: readonly string[];
}

// Close to `readOptionTokens` and deliberately not folded into it. That reader's contract is that
// every token is either a known option or an error, which is exactly right for commands that take no
// operands and exactly wrong here — a designation is a token nobody can enumerate in advance.
function readFocusTokens(tokens: readonly string[]): FocusTokens {
  let dataDir: string | undefined;
  const operands: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) continue;

    if (token === '--data-dir') {
      if (dataDir !== undefined) throw new UsageError('--data-dir 只能指定一次。');

      const value = tokens[index + 1];
      if (value === undefined) throw new UsageError('--data-dir 需要一个路径。');
      if (!value.trim()) throw new UsageError('--data-dir 不能是空路径。');

      dataDir = value;
      index += 1;
      continue;
    }

    // A leading dash is how this CLI spells an option everywhere else, so a token that has one is
    // read as an option that does not exist rather than as text. The alternative — treating it as a
    // designation — would let a mistyped flag quietly become a work focus.
    if (token.startsWith('-')) throw new UsageError(`未知参数：${token}`);

    operands.push(token);
  }

  if (dataDir === undefined) throw new UsageError('缺少必填参数：--data-dir');
  return { dataDir, operands };
}

// How many operands a word takes. This is grammar, not domain: it says `replace` is not spelled
// `clear`, and it does not say whether any particular designation is acceptable. The empty-set rule
// is enforced a second time on the other side of the pipe, because the CLI is not the only thing
// that can speak this protocol — a rule kept only here would be a rule about this client rather than
// about the focus.
function readFocusArity(word: WorkFocusWord, operands: readonly string[]): void {
  if (word === 'declare' && operands.length !== 1) {
    throw new UsageError(`focus declare 需要恰好一个工作焦点，收到 ${operands.length} 个。`);
  }
  if (word === 'replace' && operands.length === 0) {
    throw new UsageError('focus replace 至少需要一个工作焦点；要清空请用 hikari focus clear。');
  }
  if ((word === 'clear' || word === 'status') && operands.length !== 0) {
    throw new UsageError(`focus ${word} 不接受工作焦点参数。`);
  }
}

function readChronicleCommand(rest: readonly string[]): CommandTokens {
  const [sub, ...tokens] = rest;
  if (sub !== 'init') {
    throw new UsageError(`chronicle 只支持 init，收到：${sub ?? '(缺失)'}`);
  }
  return { command: 'chronicle-init', tokens };
}

// One reader for both grammars, because the difference between them is exactly one token: a command
// either accepts `--desktop-awareness-delay-ms` or it does not know the argument. Widening the
// reader for `resident` therefore cannot widen `start`, which is what keeps the one-shot commands'
// argument surface — and every test written against it — intact.
function readOptions(tokens: readonly string[]): CliOptions {
  const { dataDir } = readOptionTokens(tokens, false);
  return { dataDir };
}

function readResidentOptions(tokens: readonly string[]): ResidentOptions {
  const { dataDir, delayToken } = readOptionTokens(tokens, true);
  if (delayToken === undefined) {
    throw new UsageError('缺少必填参数：--desktop-awareness-delay-ms');
  }
  return { dataDir, desktopAwarenessDelayMs: Number(delayToken) };
}

interface OptionTokens {
  readonly dataDir: string;
  readonly delayToken: string | undefined;
}

function readOptionTokens(tokens: readonly string[], acceptDelay: boolean): OptionTokens {
  let dataDir: string | undefined;
  let delayToken: string | undefined;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token === '--data-dir') {
      if (dataDir !== undefined) throw new UsageError('--data-dir 只能指定一次。');

      const value = tokens[index + 1];
      if (value === undefined) throw new UsageError('--data-dir 需要一个路径。');
      if (!value.trim()) throw new UsageError('--data-dir 不能是空路径。');

      dataDir = value;
      index += 1;
      continue;
    }

    if (token === '--desktop-awareness-delay-ms' && acceptDelay) {
      if (delayToken !== undefined) {
        throw new UsageError('--desktop-awareness-delay-ms 只能指定一次。');
      }

      const value = tokens[index + 1];
      if (value === undefined) {
        throw new UsageError('--desktop-awareness-delay-ms 需要一个整数。');
      }
      if (!NUMBER_LITERAL.test(value)) {
        throw new UsageError(`--desktop-awareness-delay-ms 需要一个数字，收到：${value}`);
      }

      delayToken = value;
      index += 1;
      continue;
    }

    throw new UsageError(`未知参数：${String(token)}`);
  }

  if (dataDir === undefined) throw new UsageError('缺少必填参数：--data-dir');
  return { dataDir, delayToken };
}
