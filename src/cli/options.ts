import type { WorkFocusWord } from '../work-focus/index.js';

export interface CliOptions {
  readonly dataDir: string;
}

// `resident` takes options the one-shot commands do not, and none of them has a default: a resident
// that chose its own cadence would be deciding how often Hikari looks at the desktop, and one that
// chose its own repository scope would be deciding what Hikari looks at.
export interface ResidentOptions extends CliOptions {
  readonly desktopAwarenessDelayMs: number;
  /**
   * The Repository CI capability's configuration, or absent because it was not configured.
   *
   * Absent is a complete and ordinary answer — the default resident has no repository scope and does
   * not need one — so there is no third state and nothing to default to. The two values are one act
   * of configuration: a scope needs both ends, and only the operator knows which repository they
   * mean, so half of this is refused rather than completed by a guess.
   */
  readonly repositoryCi?: RepositoryCiOptions;
}

/**
 * One explicit Repository CI scope.
 *
 * `rootDir` is a path on this machine and `repository` is GitHub's own `owner/name` spelling. They
 * are not validated against each other and must not be: whether they describe the same repository is
 * a correspondence between two sources, and inferring it is exactly the judgement neither source is
 * allowed to make.
 */
export interface RepositoryCiOptions {
  readonly rootDir: string;
  readonly repository: string;
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

export type CliCommand =
  | 'init'
  | 'chronicle-init'
  | 'start'
  | 'resident'
  | 'status'
  | 'stop'
  | 'focus'
  | 'relevance'
  | 'observe';

// Only `resident` carries a parsed configuration, and the union is what keeps that obligation in the
// type rather than in a comment: the other commands cannot be handed a cadence or a repository scope
// at all. `status`, `stop` and `relevance` belong to the first arm for the same reason — what they
// need from argv is exactly a data directory, which is the whole of the first arm's obligation, so
// their arrival cannot widen any argument surface. In particular they do not take the cadence:
// reaching a running resident is not the same act as deciding how often it looks at the desktop, and
// a control command that could set a cadence would be a second way to configure the loop.
//
// That `relevance` is in this arm is the honest statement of what it is: a question put to whatever
// resident is already running, carrying no configuration of its own. What it must *not* have is a way
// to configure the capability it asks about — an operator who could enable Repository CI by asking
// about it would have a second composition root, and this is a client.
//
// `observe` is in this arm for the same reason and with one fewer way to be wrong: it asks about a
// capability that is always present in a running resident, so there is not even a half-configured
// state for it to name.
export type ParsedCommandLine =
  | {
      readonly command: 'init' | 'chronicle-init' | 'start' | 'status' | 'stop' | 'relevance' | 'observe';
      readonly options: CliOptions;
    }
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
  '                  [--repository-root <path> --repository <owner/name>]',
  '  hikari status --data-dir <path>',
  '  hikari stop --data-dir <path>',
  '  hikari focus declare --data-dir <path> <designation>',
  '  hikari focus replace --data-dir <path> <designation> [<designation> ...]',
  '  hikari focus clear --data-dir <path>',
  '  hikari focus status --data-dir <path>',
  '  hikari relevance repository-ci status --data-dir <path>',
  '  hikari observe desktop-session status --data-dir <path>',
  '',
  '选项：',
  '  --data-dir <path>                        数据根目录，必填，没有默认值',
  '  --desktop-awareness-delay-ms <integer>   resident 的采集节奏，必填，没有默认值',
  '  --repository-root <path>                 Repository CI 的仓库根目录，与 --repository 成对出现',
  '  --repository <owner/name>                Repository CI 的 GitHub 仓库，与 --repository-root 成对出现',
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

  // `relevance` resolves here for the same reason `focus` does, and for one more. It has operands —
  // a domain and a question — so a token list could not carry them; and reading them here rather than
  // in `readCommand` keeps the grammar of "which domain, which question" in one place, above the
  // point where a command's options are finished off.
  if (head === 'relevance') return readRelevanceCommand(rest);

  // `observe` resolves here for the same reason as the two above: a domain and a question are
  // operands, and an operand is not an option.
  if (head === 'observe') return readObserveCommand(rest);

  const { command, tokens } = readCommand(head, rest);
  if (command === 'resident') return { command, options: readResidentOptions(tokens) };
  return { command, options: readOptions(tokens) };
}

// The commands with operands are excluded because this reader never produces them: their grammar
// needs more than options, so they resolve to a whole `ParsedCommandLine` in `parseCommandLine`
// before this reader is reached. Saying so in the type is what keeps the token list below from being
// handed a command that has no token list to give.
interface CommandTokens {
  readonly command: Exclude<CliCommand, 'focus' | 'relevance' | 'observe'>;
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

  const { dataDir, operands } = readOperandTokens(tokens);
  readFocusArity(word, operands);
  return { command: 'focus', options: { dataDir, word, designations: operands } };
}

interface OperandTokens {
  readonly dataDir: string;
  readonly operands: readonly string[];
}

// One domain and one question, so the grammar is two literals and two literal comparisons.
//
// `focus` derives its word list from the plugin's own union because that plugin owns a vocabulary of
// four and the CLI must not have an opinion about what they mean. There is no equivalent worth
// building here: a table typed by a union of one would be a framework for the second domain that does
// not exist, and the messages below are better for naming the domain and the question separately —
// an operator who typed the right domain and the wrong question should be told which half was wrong.
//
// What is deliberately *not* here is any check on the values themselves. This reader knows the two
// words `repository-ci` and `status` because they are the address of a question, not because it has
// an opinion about repositories or about statuses; whether the resident can answer is the resident's
// business, and this file never learns the difference.
function readRelevanceCommand(rest: readonly string[]): ParsedCommandLine {
  const [domain, word, ...tokens] = rest;

  if (domain !== 'repository-ci') {
    throw new UsageError(`relevance 目前只支持 repository-ci，收到：${domain ?? '(缺失)'}`);
  }
  if (word !== 'status') {
    throw new UsageError(`relevance repository-ci 目前只支持 status，收到：${word ?? '(缺失)'}`);
  }

  const { dataDir, operands } = readOperandTokens(tokens);
  if (operands.length > 0) {
    throw new UsageError('relevance repository-ci status 不接受额外参数。');
  }

  return { command: 'relevance', options: { dataDir } };
}

// One domain and one question, and the same shape as `readRelevanceCommand` on purpose.
//
// The two readers are adjacent and near-identical, and folding them together is the thing not to do.
// A merged reader would need the set of domains and, for each, the set of questions — which is a
// table, and a table is a claim that these addresses are one grammar with two rows. They are not:
// `relevance` asks a judgement about work the human declared, `observe` reads a perception chain
// back, and they only look alike because a person addresses both of them. A shared table would make
// the next domain's arrival a row rather than a decision, which is exactly the framework neither
// command's vocabulary is allowed to become.
//
// What is *not* here is any check on the values. This reader knows the two words `desktop-session`
// and `status` because they are the address of a question, not because it has an opinion about
// desktop sessions or about statuses; whether the resident can answer is the resident's business, and
// this file never learns the difference.
function readObserveCommand(rest: readonly string[]): ParsedCommandLine {
  const [domain, word, ...tokens] = rest;

  if (domain !== 'desktop-session') {
    throw new UsageError(`observe 目前只支持 desktop-session，收到：${domain ?? '(缺失)'}`);
  }
  if (word !== 'status') {
    throw new UsageError(`observe desktop-session 目前只支持 status，收到：${word ?? '(缺失)'}`);
  }

  const { dataDir, operands } = readOperandTokens(tokens);
  if (operands.length > 0) {
    throw new UsageError('observe desktop-session status 不接受额外参数。');
  }

  return { command: 'observe', options: { dataDir } };
}

// Close to `readOptionTokens` and deliberately not folded into it. That reader's contract is that
// every token is either a known option or an error, which is exactly right for commands that take no
// operands and exactly wrong here — a designation, a domain and a question are all tokens nobody can
// enumerate in advance as *values*, however closed the vocabulary they are drawn from.
//
// The one option it does know is a data directory, and it is the same option `readOptionTokens` reads
// with the same three rules for it. What is shared is a shape rather than a code path: this reader
// has nowhere to put a cadence or a repository scope, so a command that gained an operand grammar
// could not accidentally gain one of those with it.
function readOperandTokens(tokens: readonly string[]): OperandTokens {
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

// One reader for both grammars, because the difference between them is a set of flags: a command
// either accepts one or it does not know the argument. Which set it is, is the parameter, so widening
// the reader for `resident` still cannot widen `start` — the one-shot commands' argument surface, and
// every test written against it, is intact by construction rather than by review.
type OptionGrammar = 'data-dir-only' | 'resident';

function readOptions(tokens: readonly string[]): CliOptions {
  const { dataDir } = readOptionTokens(tokens, 'data-dir-only');
  return { dataDir };
}

function readResidentOptions(tokens: readonly string[]): ResidentOptions {
  const { dataDir, delayToken, repositoryRoot, repository } = readOptionTokens(tokens, 'resident');
  if (delayToken === undefined) {
    throw new UsageError('缺少必填参数：--desktop-awareness-delay-ms');
  }

  const delay = { dataDir, desktopAwarenessDelayMs: Number(delayToken) };
  const repositoryCi = readRepositoryCiPairing(repositoryRoot, repository);
  return repositoryCi === undefined ? delay : { ...delay, repositoryCi };
}

// The two flags are one configuration or neither, and that is decided here rather than by the
// composition that consumes them. A resident started with only half of it would have to supply the
// other half, and every way of doing that is a way this design has already refused: a repository root
// inferred from the process's working directory, a GitHub repository inferred from a git remote. So
// the reader refuses instead, and names the half that is missing — an operator who typed one of the
// two has shown they know which repository they mean and can type the other.
//
// Neither value is checked beyond being non-empty. Whether a repository is at that path, and whether
// the name is a shape GitHub uses, are the two plugins' own questions, asked where they are asked
// today; a second copy of either rule here would be a second answer to a question that already has
// one, and the two would eventually disagree about some name or some path.
function readRepositoryCiPairing(
  rootDir: string | undefined,
  repository: string | undefined,
): RepositoryCiOptions | undefined {
  if (rootDir === undefined && repository === undefined) return undefined;

  if (rootDir === undefined) {
    throw new UsageError('--repository 需要与 --repository-root 成对出现；缺少：--repository-root');
  }
  if (repository === undefined) {
    throw new UsageError('--repository-root 需要与 --repository 成对出现；缺少：--repository');
  }

  return Object.freeze({ rootDir, repository });
}

interface OptionTokens {
  readonly dataDir: string;
  readonly delayToken: string | undefined;
  readonly repositoryRoot: string | undefined;
  readonly repository: string | undefined;
}

function readOptionTokens(tokens: readonly string[], grammar: OptionGrammar): OptionTokens {
  let dataDir: string | undefined;
  let delayToken: string | undefined;
  let repositoryRoot: string | undefined;
  let repository: string | undefined;

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

    if (token === '--desktop-awareness-delay-ms' && grammar === 'resident') {
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

    // The pairing of these two is checked after the loop, once both have had their chance to appear
    // in either order. Checking it here would make `--repository` before `--repository-root` an error
    // and the reverse not one, which is a rule about argument order rather than about configuration.
    if (token === '--repository-root' && grammar === 'resident') {
      if (repositoryRoot !== undefined) throw new UsageError('--repository-root 只能指定一次。');

      const value = tokens[index + 1];
      if (value === undefined) throw new UsageError('--repository-root 需要一个路径。');
      if (!value.trim()) throw new UsageError('--repository-root 不能是空路径。');

      repositoryRoot = value;
      index += 1;
      continue;
    }

    if (token === '--repository' && grammar === 'resident') {
      if (repository !== undefined) throw new UsageError('--repository 只能指定一次。');

      const value = tokens[index + 1];
      if (value === undefined) throw new UsageError('--repository 需要一个 owner/name。');
      if (!value.trim()) throw new UsageError('--repository 不能是空值。');

      repository = value;
      index += 1;
      continue;
    }

    throw new UsageError(`未知参数：${String(token)}`);
  }

  if (dataDir === undefined) throw new UsageError('缺少必填参数：--data-dir');
  return { dataDir, delayToken, repositoryRoot, repository };
}
