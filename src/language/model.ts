// The model, as this plugin's own implementation material, and the narrowest seam that can be tested.
//
// There is no Model Service, no router, no provider table and no configuration cascade. The model is
// something this one plugin talks to in order to do one thing, exactly as a window title is something
// the foreground plugin reads. Nothing else in the composition can reach it, nothing else knows it
// exists, and no other plugin could ask for it: what would they ask *with*? A plugin that wanted a
// model would be a plugin with a language concern, and this is where that concern lives.
//
// One wire shape, and it is named rather than abstracted: a POST of an OpenAI-compatible chat
// completion body, carrying a `tools` array and read back out of `choices[0].message`. That is a choice
// and not a framework — the endpoint is the operator's, the model name is the operator's, and an
// endpoint that speaks a different shape is a different slice with a real consumer. What is *not* built
// is a provider layer that could absorb that difference, because absorbing it for nobody is how a
// configuration surface becomes an architecture.
//
// Native tool calling is required rather than emulated, and the requirement is a real one for the
// operators of this build. The alternative — asking a model to write a JSON object in its content and
// parsing it out — was considered and refused, and the reason is not tidiness. A protocol that lives in
// the content channel shares that channel with the model's ordinary prose, so every reply becomes a
// question about which of the two it is; the guard for that would have to be a parse that fails on
// prose, which is precisely the fuzzy thing this surface has spent two slices replacing with closed
// sets. An endpoint that cannot do it fails the interaction and says so. It does not fall back, because
// a fallback would be a second protocol nobody selected.
//
// The seam is the injected factory, and it exists for the reason `github-ci/plugin.ts` gives for
// injecting its acquirer: the lifecycle has to be testable without a network. A test that wants to
// prove "the model's answer never reaches the human" has to be able to choose the answer — and now it
// also has to prove a *sequence*, since a loop is only observable as more than one step. Injecting the
// model is what lets a test write the sequence down.
//
// Nothing here logs, and that is part of the credential boundary rather than a gap in the diagnostics.
// A transport failure reports the endpoint's status or the socket error and never a request body, a
// header or a response body — the first because it carries the human's sentence, the second because it
// carries the secret, the third because it is the model's words.

import { LanguageError } from './errors.js';

/**
 * How much reasoning this build asks a model to do before it answers, as a closed set.
 *
 * `none` and `high` are the two members, and both are in the set for a reason this build can point at.
 * `high` is the effort every real-endpoint measurement behind this loop was taken under, and it is
 * usable at all because of the lifecycle described on `ModelStep.reasoningContent`: a mode that emits a
 * chain of thought and then requires those exact bytes back on the following request can only be asked
 * for by a loop that echoes them, and that echo is now part of the message plumbing. `none` stays
 * because a deployment with no use for a chain of thought should not have one imposed on it, and its
 * request is the one this build sent before the field existed.
 *
 * The members the experiments ran past are deliberately not here. A union that grows to hold every value
 * somebody tried once is a configuration surface rather than a decision, and each member added is a
 * promise that the lifecycle behind it works — so a member arrives when the product needs it, not on the
 * chance that it might.
 *
 * The name is the OpenAI-compatible request field, not any one provider's spelling of it, because the
 * body this transport sends *is* an OpenAI-compatible Chat Completions body. Nothing selects a value
 * from the endpoint: an operator configures an effort or does not, and the request carries exactly that.
 */
export type ReasoningEffort = 'none' | 'high';

/**
 * The members of `ReasoningEffort`, written once and typed by the union they spell.
 *
 * Typed *by* the union rather than beside it, so a member added above does not compile until it is added
 * here — which is the same table `options.ts` keeps for the work focus words, and it is here for the
 * reason stated there: without it, the set would be written twice, once as a type and once inside a
 * validation branch whose message would go on naming the members it used to have. A reader validates
 * against this table and lists it in the message it throws, so adding an effort is one edit in one place.
 *
 * A frozen object and not an array, because what is needed from it is membership and a readable list of
 * names, and an array would invite indexing and ordering questions it has no answers for.
 */
export const REASONING_EFFORTS: Readonly<Record<ReasoningEffort, true>> = Object.freeze({
  none: true,
  high: true,
});

/**
 * One configured endpoint, one model, and a credential that may not be needed.
 *
 * `credential` is a resolved value and not a variable name, and it is resolved once, in `setup`, so
 * that the environment is read in one place and the secret never becomes configuration that travels.
 * What `status` can print about it is that it was configured and where from; the value is not written
 * anywhere it could be read back out.
 */
export interface LanguageModelConnection {
  readonly endpoint: string;
  readonly model: string;
  readonly credential: string | undefined;
  /**
   * The reasoning effort to ask for, or `undefined` to send no such field at all.
   *
   * `undefined` is not "the default effort" and it is not zero: it is the *absence* of the field, byte
   * for byte the request this build sent before the field existed. An endpoint that has never heard of
   * `reasoning_effort` is therefore unaffected by it, which is what keeps one operator's choice from
   * becoming every operator's 400. The distinction only holds if it is never spelled any other way, so
   * the field is required and its absence is written down at every construction site.
   */
  readonly reasoningEffort: ReasoningEffort | undefined;
}

/** One tool the model is offered, in the exact shape an OpenAI-compatible endpoint expects. */
export interface ModelTool {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Readonly<Record<string, unknown>>;
  };
}

/**
 * One tool call a model asked for.
 *
 * `arguments` stays a string, which is what the wire carries, and is not parsed here. Parsing is a
 * question about a *capability* — this build's capabilities take no arguments — and the transport has
 * no opinion about capabilities, so the translation belongs to `tools.ts` and the string is passed
 * through untouched. It also keeps a malformed arguments blob from being a transport failure: the JSON
 * is well formed at this layer, whatever it says.
 */
export interface ModelToolCall {
  readonly id: string;
  readonly name: string;
  /** The raw `arguments` string, exactly as it came off the wire. */
  readonly arguments: string;
}

/**
 * One model response.
 *
 * `truncated` records `finish_reason = length` and is carried rather than interpreted. It matters in
 * exactly one place — a conversational reply that was cut off mid-sentence — and reading it here is
 * what makes that decision possible without a second request. Nothing else in the loop consults it: a
 * truncated *tool call* is not a special case, because a call either has a name and an id or the
 * response was unreadable, and a truncated reply alongside calls carries no weight since content is
 * ignored in that branch anyway.
 */
export interface ModelStep {
  readonly content: string;
  readonly toolCalls: readonly ModelToolCall[];
  /**
   * The chain of thought the endpoint emitted beside this response, or `undefined` if it emitted none.
   *
   * This is protocol material and not a record. It is echoed back on the next request of the *same*
   * interaction — see `ModelMessage` — and it is gone when that interaction ends. Nothing else in this
   * plugin reads it: it is not shown to the human, not logged, not stored beside an answer, and not part
   * of any fact this build keeps. The reason is that it is the model talking to itself, and a build that
   * filed it would have invented a reasoning artifact it never decided to own.
   *
   * It is carried as an opaque string and never interpreted. The one question asked of it is whether it
   * is there, because a thinking mode requires the exact bytes it produced to come back on the following
   * turn; trimming, parsing, summarising or re-wrapping it would be this build editing a protocol message
   * it does not own. An empty string is therefore a string and not an absence: `undefined` means the
   * endpoint emitted nothing, and `''` means it emitted nothing *in particular* — a distinction the
   * request can only preserve if it is made here.
   */
  readonly reasoningContent: string | undefined;
  readonly truncated: boolean;
}

/**
 * One message in the conversation this plugin builds.
 *
 * Four shapes, and the two that are worth explaining are the assistant and the tool.
 *
 * The assistant message carries `toolCalls` and no content, and it is built from what the transport
 * parsed rather than kept as the model's raw reply. The model's prose is deliberately dropped on the
 * way back in, and the reason is that it was already dropped on the way out: when a step contains tool
 * calls, its content is ignored by the loop, so echoing it into the next request would tell the model it
 * had said something that no human ever saw. `content: null` on the wire is what says "you called these
 * and said nothing else", which is true.
 *
 * The tool message is a real OpenAI-compatible role and not a choice of this build. One consequence is
 * load-bearing and is asserted by the loop rather than here: every `tool_call_id` in an assistant
 * message must be answered by a tool message before the next request goes out, or the endpoint rejects
 * the request outright. `answer.ts` is structured so that cannot be got wrong.
 *
 * `reasoningContent` says what this assistant turn thought, and it rides on the same message as the calls
 * because that is what the wire requires: a thinking mode pairs the chain of thought with the turn it
 * belongs to, and a request that carries the calls without it — or carries somebody else's — is a request
 * the endpoint cannot match to anything it said. Its whole lifecycle is one interaction. It is written by
 * the step that produced it, read by the next request in the same answer, and dropped when that answer
 * ends; nothing accumulates it, nothing writes it anywhere, and no other interaction can see it. That is
 * why it is a field on a message this plugin builds per interaction rather than anything with a name of
 * its own.
 */
export type ModelMessage =
  | { readonly role: 'system'; readonly content: string }
  | { readonly role: 'user'; readonly content: string }
  | {
      readonly role: 'assistant';
      readonly toolCalls: readonly ModelToolCall[];
      readonly reasoningContent: string | undefined;
    }
  | { readonly role: 'tool'; readonly toolCallId: string; readonly content: string };

/** One request: the conversation so far, and the tools that may be called next. */
export interface ModelRequest {
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly ModelTool[];
}

/**
 * The one thing this plugin asks of a model: given this conversation, what happens next.
 *
 * It answers with what the wire said — text, calls, whether it was cut off — and no interpretation of
 * any of it. Deciding what a call means is `tools.ts`'s job and deciding what to do about a step is
 * `answer.ts`'s, which is what keeps "the model's output is data that must survive a lookup" visible as
 * a property of this interface rather than as a convention at the call site.
 */
export interface LanguageModel {
  step(request: ModelRequest): Promise<ModelStep>;
  /** Idempotent. Aborts anything in flight. */
  dispose(): void;
}

// This plugin's own bound on how long one model call may take, and not the operator's cadence: a
// question a human is waiting on has to be given up on eventually, and the alternative to a bound is a
// client waiting on a model that will never answer. It bounds one *call*; how many calls an interaction
// may make is `answer.ts`'s business, and the client's own bound is `cli/ask.ts`'s.
export const MODEL_TIMEOUT_MS = 15_000;

// Enough for a conversational reply, and now also for the chain of thought that precedes one. The number
// has moved with what the loop lets a model produce: 16 when the prompt asked for a single word, 512 when
// a model was allowed to talk, and 4096 once a thinking mode could be configured. The last step was not
// estimated. A thinking effort spends the same ceiling before it reaches a selection, and a single
// variable comparison taken on the product's own endpoint saw `finish_reason = length` on three of
// twenty-four first turns at 512 and on none of twenty-four at 4096 — the ceiling, not the prompt, was
// what ran out.
//
// It is still not the start of a budget framework. There is no operator-facing knob, because no
// deployment has asked to spend less than one sentence's worth of thinking; an endpoint that reports
// `finish_reason = length` anyway has that reported honestly (see `truncatedLines`) rather than retried
// or resized; and a capability's tool result is not bounded by this and could not be — the ceiling
// applies to what the model generates, not to what it is shown.
const MODEL_MAX_TOKENS = 4096;

/**
 * The secret, read once from the environment variable the operator named.
 *
 * A named variable with no value is refused rather than treated as "no credential". The operator said
 * which variable holds it; a process that then spoke without one would be quietly ignoring a
 * configuration it was given, and the failure would arrive later as an authentication error the
 * operator cannot connect to anything they typed. A local endpoint needs no credential, and the way to
 * say so is to leave the flag off.
 *
 * A value that could not be an HTTP header value is refused here as well, and this is the only place
 * that can refuse it. The credential has exactly one destination — an `Authorization` header — and the
 * HTTP layer rejects some of what it is handed with a complaint that *quotes the value it rejected*.
 * Measured rather than supposed: a credential with a line break at the start or in the middle raises
 * `Headers.append: "Bearer <the whole secret>" is an invalid header value`, and that message is what a
 * failure line carries to a terminal. Left unchecked, the secret reaches the operator through the
 * failure message instead of through the request. Checking at the boundary where the secret enters is
 * what makes "the secret never appears in a message this process prints" a property of the value
 * rather than a hope about what some transport's error text contains: nothing downstream is ever
 * handed a credential that could be quoted back.
 *
 * The refusal is a rule about credentials and not a mirror of the transport, and the two are worth
 * telling apart because the transport is narrower than the rule. A *trailing* line break is stripped
 * by the header-value whitespace normalization — measured too, and it is the shape this guard refuses
 * that would otherwise have gone through — and a non-ASCII byte is accepted here and would be sent.
 * So the rule is the one stated below: a bearer credential is a printable ASCII token with no spaces.
 * Anything else is refused here, where the value enters, rather than left to whichever end of the
 * request finds out about it first.
 */
export function readModelCredential(envName: string | undefined): string | undefined {
  if (envName === undefined) return undefined;

  const value = process.env[envName];
  if (value === undefined || value === '') {
    throw new LanguageError(`--model-credential-env 指定的环境变量 ${envName} 没有值。`);
  }
  if (!isHeaderValueSafe(value)) {
    // The message names the variable and says what is wrong with the value. It does not quote the
    // value and does not name the offending character, because the offending character is part of the
    // secret — a diagnostic that pointed at it would be the leak it is reporting.
    //
    // It says what this build accepts rather than "the HTTP layer would refuse this", because the two
    // are not the same set: a trailing newline would be stripped and would work, and this guard refuses
    // it anyway. Telling an operator their credential "could not be a header value" when it demonstrably
    // could would be a reason they could check and find wrong, and a refusal they then learn not to
    // trust. The rule is the observable fact; the reason is not something they can act on.
    throw new LanguageError(
      `--model-credential-env 指定的环境变量 ${envName} 的值本构建不接受：` +
        '凭据只能由可打印的 ASCII 字符组成，且不含空格。从文件里 export 出来的值常常带一个多余的换行。',
    );
  }
  return value;
}

// What may follow `Bearer ` in an `Authorization` header: printable ASCII with no spaces. Every real
// credential is in this set — a UUID, a base64 blob, an `sk-…` key — and the set answers the question
// the guard is actually asking, which is not "would the transport reject this" but "is this a bearer
// token". A `Bearer` credential is a printable ASCII token by definition, so the value is judged
// against what it claims to be rather than against a list of bytes some library happens to complain
// about.
//
// That distinction is not pedantry, because the two sets differ in both directions and I measured
// both: a line break at the start or in the middle is rejected *and quoted back*, a trailing line
// break is stripped and would have gone through, and a non-ASCII byte is accepted outright. Enumerating
// the bytes that break would therefore be a guard that is simultaneously too wide (refusing what works)
// and too narrow (passing bytes nothing has been measured against), and one that would need revisiting
// every time the transport changed its mind. Refusing the whole complement of a set this process can
// reason about completely is what makes the property hold without depending on that.
function isHeaderValueSafe(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? -1;
    if (code < 0x21 || code > 0x7e) return false;
  }
  return true;
}

export function createHttpModel(connection: LanguageModelConnection): LanguageModel {
  // One controller for the activation, aborted by `dispose`. A question in flight when the plugin
  // unloads is a question whose answer nobody is left to receive, and leaving the socket open would
  // make the Runtime's teardown wait on a model.
  const controller = new AbortController();

  return {
    async step(request: ModelRequest): Promise<ModelStep> {
      const response = await send(connection, request, controller.signal);
      return readStep(await readJson(response));
    },
    dispose(): void {
      controller.abort();
    },
  };
}

async function send(
  connection: LanguageModelConnection,
  request: ModelRequest,
  signal: AbortSignal,
): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  // The only place the credential is ever used, and it goes into a header rather than into the URL.
  // A query parameter would put the secret into every error message that ever mentions an address.
  if (connection.credential !== undefined) {
    headers.authorization = `Bearer ${connection.credential}`;
  }

  let response: Response;
  try {
    response = await fetch(connection.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: connection.model,
        messages: request.messages.map(toWireMessage),
        tools: request.tools,
        // Named rather than left to the endpoint's default. `auto` *is* the default when tools are
        // present, so this changes nothing about what an endpoint does — it changes what this build has
        // said. The loop's whole first-turn branch is "the model may talk instead of reading", and that
        // permission should be a sentence in the request rather than an assumption about a default some
        // other implementation chose and could revisit.
        tool_choice: 'auto',
        temperature: 0,
        // Added by spreading or not spreading, so that "no configured effort means no such key" is a
        // property of how this object is built rather than of `JSON.stringify` dropping undefined
        // values. The two agree today; the day a serializer disagrees, the request to an endpoint that
        // never asked for this field is the one that changes silently, and that is the failure this
        // build least wants to discover from a 400.
        ...(connection.reasoningEffort === undefined
          ? {}
          : { reasoning_effort: connection.reasoningEffort }),
        max_tokens: MODEL_MAX_TOKENS,
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(MODEL_TIMEOUT_MS)]),
    });
  } catch (error) {
    throw new LanguageError(`模型端点没有应答：${describeTransport(error)}`);
  }

  if (!response.ok) {
    // The status, and not the body. The body is the model's words, and an error message is a road to
    // a human.
    throw new LanguageError(`模型端点返回了 ${response.status}。`);
  }
  return response;
}

// The assistant message goes back with `content: null` and no prose, per the note on `ModelMessage`.
// The tool message uses the wire's own snake_case key, which is the one place in this file where a
// field name is not this repository's; renaming it would be inventing a dialect.
function toWireMessage(message: ModelMessage): Record<string, unknown> {
  switch (message.role) {
    case 'assistant':
      return {
        role: 'assistant',
        content: null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments },
        })),
        // Put back by spreading or not spreading, for the reason stated at `reasoning_effort` below: the
        // day a serializer disagrees about `undefined`, the request that changes silently is the one to
        // an endpoint that never emitted a chain of thought. What is spread is the string exactly as it
        // arrived — not trimmed, not re-encoded, and not skipped when it is empty, because an empty
        // string is one of the things the endpoint said and this build has no standing to shorten its
        // own protocol message.
        ...(message.reasoningContent === undefined
          ? {}
          : { reasoning_content: message.reasoningContent }),
      };
    case 'tool':
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
    default:
      return { role: message.role, content: message.content };
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new LanguageError('模型端点的应答不是 JSON。');
  }
}

// The wire shape, read defensively: every step is a property that may not be there, because this is
// the one boundary in the plugin where bytes somebody else chose arrive.
//
// The split of responsibility is drawn deliberately here. Everything below is *structure*: is there a
// message, is `content` a string or absent, is `tool_calls` an array, does each call have an id and a
// name. A shape this build does not recognise throws, and a throw becomes `failed` — the endpoint said
// something this transport cannot read, which is a different fact from the model saying something the
// loop will not act on. Whether a name means anything, or whether arguments are acceptable, is not
// asked here: those are questions about capabilities, `tools.ts` answers them, and their answer is
// `refused`. Keeping the two apart is what stops an unknown tool name from being reported as a broken
// endpoint.
//
// Nothing here substitutes a default for something missing in a way that could be mistaken for an
// answer. An absent `content` becomes `''` because an assistant message that only calls tools genuinely
// has none; an absent `tool_calls` becomes `[]` because that is what "no calls" is on the wire. Neither
// is an answer — both are read by the loop, which decides what they mean.
function readStep(payload: unknown): ModelStep {
  const choices = readProperty(payload, 'choices');
  const first = Array.isArray(choices) ? choices[0] : undefined;
  const message = readProperty(first, 'message');
  if (typeof message !== 'object' || message === null) {
    throw new LanguageError('模型端点的应答里没有 choices[0].message 这个对象。');
  }

  return Object.freeze({
    content: readContent(message),
    toolCalls: readToolCalls(message),
    reasoningContent: readReasoningContent(message),
    truncated: readProperty(first, 'finish_reason') === 'length',
  });
}

// An absent key and `null` both read as `undefined`, which is what "this endpoint emitted no chain of
// thought" is. An empty string is deliberately not one of those cases: it is a string the endpoint sent,
// and folding it into absence would be this build deciding a protocol message said nothing when the wire
// said it said nothing — a distinction nothing downstream could recover once it had been made. Any other
// non-string is a shape this build does not know and is refused rather than coerced, exactly as `content`
// is: a number or an array here means the endpoint speaks something else, and stringifying it would put
// invented bytes into a request whose whole purpose is to return the endpoint's own.
function readReasoningContent(message: object): string | undefined {
  const reasoning = readProperty(message, 'reasoning_content');
  if (reasoning === undefined || reasoning === null) return undefined;
  if (typeof reasoning !== 'string') {
    throw new LanguageError(
      '模型端点的应答里 choices[0].message.reasoning_content 既不是字符串也不是 null。',
    );
  }
  return reasoning;
}

// `null` is what the wire carries for "this message has no text" — an assistant turn that is nothing but
// tool calls — so it and an absent key both read as `''`. Any other non-string is a shape this build
// does not know, and is refused rather than coerced: a number or an array here means the endpoint is
// speaking something else, and `String(...)` would turn that into a reply somebody has to read.
function readContent(message: object): string {
  const content = readProperty(message, 'content');
  if (content === undefined || content === null) return '';
  if (typeof content !== 'string') {
    throw new LanguageError('模型端点的应答里 choices[0].message.content 既不是字符串也不是 null。');
  }
  return content;
}

function readToolCalls(message: object): readonly ModelToolCall[] {
  const calls = readProperty(message, 'tool_calls');
  if (calls === undefined || calls === null) return Object.freeze([]);
  if (!Array.isArray(calls)) {
    throw new LanguageError('模型端点的应答里 choices[0].message.tool_calls 不是数组。');
  }

  const parsed = calls.map(readToolCall);

  // The one shape the check above cannot see, because it is a property of the batch rather than of a
  // call: two calls sharing an id. It is unreadable for the same reason a call with no id is — an id is
  // how the wire pairs an answer with a question, and two questions pairing to one answer is not a batch
  // this build can complete — and it is not merely untidy: the loop can reach it, since two *different*
  // fresh capabilities in one message is exactly the batch this build's exposure set makes possible. Left
  // alone, both reads succeed and the next request goes out carrying an assistant message whose two tool
  // results are keyed by the same id, which an endpoint that indexes results by id rejects outright. The
  // human would then be told the endpoint was broken, about a reading that had in fact worked.
  const seen = new Set<string>();
  for (const call of parsed) {
    if (seen.has(call.id)) {
      throw new LanguageError('模型端点的应答里有重复的 tool_call id。');
    }
    seen.add(call.id);
  }

  return Object.freeze(parsed);
}

// A call without an id, a name or a function object is not a call that can be looked up, answered, or
// echoed back — and it cannot be silently skipped either, because the endpoint requires every call in an
// assistant message to be answered. There is no way to complete the batch, so the response is
// unreadable rather than partially usable.
function readToolCall(call: unknown): ModelToolCall {
  const id = readProperty(call, 'id');
  const fn = readProperty(call, 'function');
  const name = readProperty(fn, 'name');
  const args = readProperty(fn, 'arguments');

  if (typeof id !== 'string' || id === '') {
    throw new LanguageError('模型端点的应答里有一个 tool_call 没有 id。');
  }
  if (typeof name !== 'string' || name === '') {
    throw new LanguageError('模型端点的应答里有一个 tool_call 没有 function.name。');
  }
  if (args !== undefined && args !== null && typeof args !== 'string') {
    throw new LanguageError('模型端点的应答里有一个 tool_call 的 function.arguments 不是字符串。');
  }
  return Object.freeze({ id, name, arguments: typeof args === 'string' ? args : '' });
}

function readProperty(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  return (value as Record<string, unknown>)[key];
}

// Node's `fetch` reports a connection failure as a bare `fetch failed` and puts the actual socket
// error in `cause`, which is unhelpful to an operator who is trying to find out whether their endpoint
// is running. Both are reported.
//
// What makes that safe is not this function but `readModelCredential`, and the reason is worth stating
// where the message is built rather than only where the check is. An error raised by the HTTP layer can
// quote the header it rejected, so "an error that mentions a host has not mentioned the secret" is not
// a property of error messages — it is a property of the value, established before any request exists.
// A guard here would have to anticipate every transport's idea of what an error says, which is why
// there is not one.
function describeTransport(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  const cause: unknown = (error as { cause?: unknown }).cause;
  if (cause instanceof Error && cause.message) return `${error.message}（${cause.message}）`;
  return error.message;
}
