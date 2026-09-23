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
  /**
   * The language plugin's model, or absent because none was configured.
   *
   * Absent is the default resident, and it is a complete answer: a Hikari that was not told which model
   * to ask does not ask one, and does not fall back to a public endpoint or to a credential found in the
   * environment. That is the whole of the reason this is optional rather than required — a default model
   * would be this file choosing to send a human's words somewhere nobody named.
   */
  readonly model?: ModelOptions;
}

/**
 * One explicit model, as an endpoint and a name.
 *
 * A pair, refused in halves, for the reason the Repository CI pair is: each value alone names something
 * the other one is needed to reach, and every way of completing the pair here would be a guess — an
 * endpoint inferred from a model name, a model inferred from an endpoint. Endpoint and model are the
 * two halves of one act of configuration, so they are one type rather than two optional fields.
 *
 * `credentialEnv` is a variable *name*, never a value. That is deliberate and it is the whole reason
 * this shape can be printed, logged or shown in a status line: the secret stays in the environment
 * where the operator put it, and the only thing that travels is the name of where to look. Which
 * variable holds a credential is the operator's decision; whether that variable exists at all is
 * checked at activation, by the plugin that needs it.
 */
export interface ModelOptions {
  readonly endpoint: string;
  readonly model: string;
  readonly credentialEnv: string | undefined;
  /**
   * The reasoning effort to ask the model for, or `undefined` to send no such field.
   *
   * Carried as the operator's own token, like `--model`, and deliberately not checked against a set of
   * legal values here — which efforts exist is the language plugin's question, asked at activation and
   * answered by the plugin's own `config.parse`, for the reason the comment above `readModelPairing`
   * gives. What this file knows is the one thing an argument *list* can know: whether a value was
   * supplied at all. That is the difference this flag carries — absent means the request is exactly the
   * one this build sent before the field existed, and no endpoint is told about a field it never asked
   * for.
   */
  readonly reasoningEffort: string | undefined;
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

// The one operand is the human's sentence, carried exactly as they typed it. Nothing here trims it,
// folds it, lowercases it or inspects it for intent: what a sentence means is the language plugin's
// question, asked with a model, and a CLI that formed its own idea of what was being asked would be
// answering a different question than the one the plugin was given. The only thing this file decides
// about it is how many operands there may be, which is grammar.
export interface AskOptions extends CliOptions {
  readonly text: string;
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
  | 'observe'
  | 'ask';

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
//
// `ask` has an arm of its own because it has an operand, and the operand is why it must: a sentence is
// not an option, so the first arm — whose whole obligation is a data directory — could not carry one
// without becoming an argument surface for text. What it does *not* carry is any model configuration.
// The model is the resident's, decided when the resident started; a client that could name an endpoint
// would be a second way to send a human's words somewhere, and the configuration belongs to the thing
// that holds the connection.
export type ParsedCommandLine =
  | {
      readonly command: 'init' | 'chronicle-init' | 'start' | 'status' | 'stop' | 'relevance' | 'observe';
      readonly options: CliOptions;
    }
  | { readonly command: 'resident'; readonly options: ResidentOptions }
  | { readonly command: 'focus'; readonly options: FocusOptions }
  | { readonly command: 'ask'; readonly options: AskOptions };

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
  '                  [--model-endpoint <url> --model <name>',
  '                   [--model-credential-env <ENV_NAME>]',
  '                   [--model-reasoning-effort <none|high>]]',
  '  hikari status --data-dir <path>',
  '  hikari stop --data-dir <path>',
  '  hikari focus declare --data-dir <path> <designation>',
  '  hikari focus replace --data-dir <path> <designation> [<designation> ...]',
  '  hikari focus clear --data-dir <path>',
  '  hikari focus status --data-dir <path>',
  '  hikari relevance repository-ci status --data-dir <path>',
  '  hikari observe desktop-session status --data-dir <path>',
  '  hikari ask --data-dir <path> "<text>"',
  '',
  '选项：',
  '  --data-dir <path>                        数据根目录，必填，没有默认值',
  '  --desktop-awareness-delay-ms <integer>   resident 的采集节奏，必填，没有默认值',
  '  --repository-root <path>                 Repository CI 的仓库根目录，与 --repository 成对出现',
  '  --repository <owner/name>                Repository CI 的 GitHub 仓库，与 --repository-root 成对出现',
  '  --model-endpoint <url>                   语言插件的模型端点，与 --model 成对出现，没有默认值',
  '  --model <name>                           语言插件请求的模型名，与 --model-endpoint 成对出现，没有默认值',
  '  --model-credential-env <ENV_NAME>        从该环境变量读取模型凭据；省略表示不带凭据',
  '  --model-reasoning-effort <none|high>     请求里带的 reasoning_effort；省略表示不带这个字段',
  '',
  '说明：',
  '  hikari resident 同时给出 --model-endpoint 与 --model 时才会加载语言插件；',
  '  没有给出时语言插件不加载，hikari ask 会说明没有语言入口。',
  '  hikari ask 会把你说的话原文发送到 --model-endpoint 指定的模型端点；',
  '  模型只负责决定这一句要不要读 Hikari 已经掌握的东西，以及读哪一些。',
  '  读到的内容由 Hikari 自己渲染成回答；模型不解释事实，也不替 Hikari 说话。',
  '  端点必须支持 OpenAI 兼容的原生 tool calling（tools / tool_calls / tool 结果消息）；',
  '  不支持的端点会让这次交互失败，Hikari 不会退回另一套协议。',
  '  --model-credential-env 给的是环境变量的名字，不是凭据本身。',
  '  --model-reasoning-effort 是写给端点的一个请求，Hikari 不判断端点认不认这个值；',
  '  省略时请求里不会有这个字段，因此对不认识它的端点没有任何影响。',
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

  // `ask` resolves here for the same reason, and its operand is the one this CLI carries on a human's
  // behalf rather than choosing between a closed set. That is exactly why the resolution cannot wait
  // for `readCommand`: a sentence is not a token any table can enumerate.
  if (head === 'ask') return readAskCommand(rest);

  const { command, tokens } = readCommand(head, rest);
  if (command === 'resident') return { command, options: readResidentOptions(tokens) };
  return { command, options: readOptions(tokens) };
}

// The commands with operands are excluded because this reader never produces them: their grammar
// needs more than options, so they resolve to a whole `ParsedCommandLine` in `parseCommandLine`
// before this reader is reached. Saying so in the type is what keeps the token list below from being
// handed a command that has no token list to give.
interface CommandTokens {
  readonly command: Exclude<CliCommand, 'focus' | 'relevance' | 'observe' | 'ask'>;
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

// One operand, and the arity is the whole of what this reader decides.
//
// It is not a third copy of `readRelevanceCommand`/`readObserveCommand`: those two address a question
// from a closed vocabulary and their readers know the words because the words are the address. There is
// no vocabulary here — a human's sentence is exactly the thing this CLI is not allowed to have an
// opinion about — so the reader has nothing to compare against and only one rule to state, which is how
// many sentences may be given at once.
//
// The message for too many operands tells the human what to do about it rather than just what went
// wrong, because the mistake is nearly always the same one: an unquoted sentence arrives as a dozen
// tokens, and the human who typed it knows exactly what they meant. Nothing is reassembled from those
// tokens. Joining them back together would be this file guessing where the sentence boundaries were,
// and a guess that silently repairs the argument list is worse than a refusal that names the fix.
function readAskCommand(rest: readonly string[]): ParsedCommandLine {
  const { dataDir, operands } = readOperandTokens(rest);
  const [text, ...extra] = operands;

  if (text === undefined) {
    throw new UsageError('ask 需要一个问题；请把整句话用引号括起来。');
  }
  if (extra.length > 0) {
    throw new UsageError(`ask 只接受一个问题，收到 ${operands.length} 个；请把整句话用引号括起来。`);
  }

  return { command: 'ask', options: { dataDir, text } };
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
  const {
    dataDir,
    delayToken,
    repositoryRoot,
    repository,
    modelEndpoint,
    model,
    modelCredentialEnv,
    modelReasoningEffort,
  } = readOptionTokens(tokens, 'resident');
  if (delayToken === undefined) {
    throw new UsageError('缺少必填参数：--desktop-awareness-delay-ms');
  }

  const delay = { dataDir, desktopAwarenessDelayMs: Number(delayToken) };
  const repositoryCi = readRepositoryCiPairing(repositoryRoot, repository);
  const withRepository = repositoryCi === undefined ? delay : { ...delay, repositoryCi };

  const language = readModelPairing(modelEndpoint, model, modelCredentialEnv, modelReasoningEffort);
  return language === undefined ? withRepository : { ...withRepository, model: language };
}

// The endpoint and the model are one configuration or neither, decided here rather than by the plugin
// that consumes them, for the reason the Repository CI pair is decided here: a resident started with
// only half of it would have to supply the other half, and every way of doing that is a way this design
// has already refused. An endpoint with no model name means picking a model on the operator's behalf,
// and a model name with no endpoint means picking an endpoint — which, for a language model, is
// choosing whose servers a human's words are sent to. Neither is a default this file may invent.
//
// Two members of the set may be absent, and the difference is real rather than a convenience. A model
// served on this machine needs no credential, so requiring one would make the local case impossible to
// configure; a model that reasons by default needs no effort configured, and the honest way to say
// "send nothing" is to send nothing. What is *not* allowed is either one for a model that was never
// configured: a credential names a variable nothing will read, and an effort is a field on a request
// that will never be sent — in both cases an operator typed something believing it does work that
// nothing does.
//
// No value is checked beyond being non-empty. Whether an endpoint is reachable, whether the name is a
// model the endpoint serves, whether the named variable holds anything, and which efforts the endpoint
// understands are the plugin's own questions, asked at activation where the answers can be acted on. A
// second copy of any of them here would be a second answer to a question that already has one, and the
// two would eventually disagree.
function readModelPairing(
  endpoint: string | undefined,
  model: string | undefined,
  credentialEnv: string | undefined,
  reasoningEffort: string | undefined,
): ModelOptions | undefined {
  if (endpoint === undefined && model === undefined) {
    // Named one at a time rather than listed together, because the sentence an operator needs is
    // "the flag you typed needs those two", and which flag it is, is the part they do not already know.
    if (credentialEnv !== undefined) {
      throw new UsageError(
        '--model-credential-env 需要与 --model-endpoint 和 --model 一起出现；缺少：--model-endpoint、--model',
      );
    }
    if (reasoningEffort !== undefined) {
      throw new UsageError(
        '--model-reasoning-effort 需要与 --model-endpoint 和 --model 一起出现；缺少：--model-endpoint、--model',
      );
    }
    return undefined;
  }

  if (endpoint === undefined) {
    throw new UsageError('--model 需要与 --model-endpoint 成对出现；缺少：--model-endpoint');
  }
  if (model === undefined) {
    throw new UsageError('--model-endpoint 需要与 --model 成对出现；缺少：--model');
  }

  return Object.freeze({ endpoint, model, credentialEnv, reasoningEffort });
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
  readonly modelEndpoint: string | undefined;
  readonly model: string | undefined;
  readonly modelCredentialEnv: string | undefined;
  readonly modelReasoningEffort: string | undefined;
}

function readOptionTokens(tokens: readonly string[], grammar: OptionGrammar): OptionTokens {
  let dataDir: string | undefined;
  let delayToken: string | undefined;
  let repositoryRoot: string | undefined;
  let repository: string | undefined;
  let modelEndpoint: string | undefined;
  let model: string | undefined;
  let modelCredentialEnv: string | undefined;
  let modelReasoningEffort: string | undefined;

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

    if (token === '--model-endpoint' && grammar === 'resident') {
      if (modelEndpoint !== undefined) throw new UsageError('--model-endpoint 只能指定一次。');

      const value = tokens[index + 1];
      if (value === undefined) throw new UsageError('--model-endpoint 需要一个 URL。');
      if (!value.trim()) throw new UsageError('--model-endpoint 不能是空值。');

      modelEndpoint = value;
      index += 1;
      continue;
    }

    if (token === '--model' && grammar === 'resident') {
      if (model !== undefined) throw new UsageError('--model 只能指定一次。');

      const value = tokens[index + 1];
      if (value === undefined) throw new UsageError('--model 需要一个模型名。');
      if (!value.trim()) throw new UsageError('--model 不能是空值。');

      model = value;
      index += 1;
      continue;
    }

    // The value here is the *name* of an environment variable, and that is the whole reason it is safe
    // for it to be an argument at all. The credential itself is never a token: an argument list is
    // visible to every process on the machine and is kept in shell history, so a secret passed here
    // would be disclosed by the act of configuring it. This CLI has no flag that accepts a credential
    // value, and that absence is deliberate rather than unimplemented.
    if (token === '--model-credential-env' && grammar === 'resident') {
      if (modelCredentialEnv !== undefined) throw new UsageError('--model-credential-env 只能指定一次。');

      const value = tokens[index + 1];
      if (value === undefined) throw new UsageError('--model-credential-env 需要一个环境变量名。');
      if (!value.trim()) throw new UsageError('--model-credential-env 不能是空值。');

      modelCredentialEnv = value;
      index += 1;
      continue;
    }

    if (token === '--model-reasoning-effort' && grammar === 'resident') {
      if (modelReasoningEffort !== undefined) throw new UsageError('--model-reasoning-effort 只能指定一次。');

      const value = tokens[index + 1];
      if (value === undefined) throw new UsageError('--model-reasoning-effort 需要一个值。');
      if (!value.trim()) throw new UsageError('--model-reasoning-effort 不能是空值。');

      modelReasoningEffort = value;
      index += 1;
      continue;
    }

    throw new UsageError(`未知参数：${String(token)}`);
  }

  if (dataDir === undefined) throw new UsageError('缺少必填参数：--data-dir');
  return {
    dataDir,
    delayToken,
    repositoryRoot,
    repository,
    modelEndpoint,
    model,
    modelCredentialEnv,
    modelReasoningEffort,
  };
}
