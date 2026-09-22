// The model, as this plugin's own implementation material, and the narrowest seam that can be tested.
//
// There is no Model Service, no router, no provider table and no configuration cascade. The model is
// something this one plugin talks to in order to do one thing, exactly as a window title is something
// the foreground plugin reads. Nothing else in the composition can reach it, nothing else knows it
// exists, and no other plugin could ask for it: what would they ask *with*? A plugin that wanted a
// model would be a plugin with a language concern, and this is where that concern lives.
//
// One wire shape, and it is named rather than abstracted: a POST of an OpenAI-compatible chat
// completion body, with the answer read out of `choices[0].message.content`. That is a choice and not
// a framework — the endpoint is the operator's, the model name is the operator's, and an endpoint that
// speaks a different shape is a different slice with a real consumer. What is *not* built is a
// provider layer that could absorb that difference, because absorbing it for nobody is how a
// configuration surface becomes an architecture.
//
// The seam is the injected factory, and it exists for the reason `github-ci/plugin.ts` gives for
// injecting its acquirer: the lifecycle has to be testable without a network. A test that wants to
// prove "the model's answer never reaches the human" has to be able to choose the answer, and the way
// to let it choose is to hand the plugin a classifier rather than to make the plugin reachable from a
// test's stub server.
//
// Nothing here logs, and that is part of the credential boundary rather than a gap in the diagnostics.
// A transport failure reports the endpoint's status or the socket error and never a request body, a
// header or a response body — the first because it carries the human's sentence, the second because it
// carries the secret, the third because it is the model's words and this slice puts those through a
// closed-set lookup rather than in front of a human.

import { LanguageError } from './errors.js';
import type { UnderstandingPrompt } from './understanding.js';

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
}

/**
 * The one thing this plugin asks of a model: put this sentence in one of these categories.
 *
 * It answers with the model's text and no interpretation of it. Turning that text into a topic is
 * `readUnderstanding`'s job and nobody else's, which is what keeps "the model's output is a string
 * that must survive a closed-set lookup" visible as a property of this interface rather than as a
 * convention at the call site.
 */
export interface LanguageClassifier {
  classify(prompt: UnderstandingPrompt): Promise<string>;
  /** Idempotent. Aborts anything in flight. */
  dispose(): void;
}

// This plugin's own bound on how long a classification may take, and not the operator's cadence: a
// question a human is waiting on has to be given up on eventually, and the alternative to a bound is a
// client waiting on a model that will never answer.
export const MODEL_TIMEOUT_MS = 15_000;

// Enough for a word and the whitespace around it. A model that ignores the instruction and starts
// writing prose is cut off rather than allowed to choose how much this process buffers and how much
// this plugin then has to refuse.
const MODEL_MAX_TOKENS = 16;

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

export function createHttpClassifier(connection: LanguageModelConnection): LanguageClassifier {
  // One controller for the activation, aborted by `dispose`. A question in flight when the plugin
  // unloads is a question whose answer nobody is left to receive, and leaving the socket open would
  // make the Runtime's teardown wait on a model.
  const controller = new AbortController();

  return {
    async classify(prompt: UnderstandingPrompt): Promise<string> {
      const response = await send(connection, prompt, controller.signal);
      return readContent(await readJson(response));
    },
    dispose(): void {
      controller.abort();
    },
  };
}

async function send(
  connection: LanguageModelConnection,
  prompt: UnderstandingPrompt,
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
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        temperature: 0,
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

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new LanguageError('模型端点的应答不是 JSON。');
  }
}

// The wire shape, read defensively: every step is a property that may not be there, because this is
// the one boundary in the plugin where bytes somebody else chose arrive. A shape this build does not
// recognise is a failure, not an empty answer — nothing here returns `''` to stand in for content it
// could not find, because an empty string is a string a model could legitimately have answered with.
function readContent(payload: unknown): string {
  const choices = readProperty(payload, 'choices');
  const first = Array.isArray(choices) ? choices[0] : undefined;
  const content = readProperty(readProperty(first, 'message'), 'content');

  if (typeof content !== 'string') {
    throw new LanguageError('模型端点的应答里没有 choices[0].message.content 这个字符串。');
  }
  return content;
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
