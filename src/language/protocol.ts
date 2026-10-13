// The wire vocabulary of the language endpoint, owned by the module whose semantics it carries.
//
// Both ends call the encoders below, which is what keeps a client and a server from being two drifting
// statements of what an `ask` means. The client in `src/cli/ask.ts` does not have a protocol of its
// own and must not grow one.
//
// The envelope is the work focus's shape rather than the observe endpoint's, because this is the same
// kind of request: a word plus a payload the word's own type decides. It carries exactly three keys —
// `protocol`, `request`, `text` — and the strictness is the same strictness everywhere else in this
// repository, for the same reason: an envelope that shrugged at an unknown field would already be an
// extensible schema, and the next person to want a field would find the room already reserved.
//
// The request's `word` is checked here for the same reason, and by the same kind of hand-written test:
// the union in `types.ts` is a compile-time fact about our own code, and this is the runtime boundary
// where a string we did not write arrives. There is no table of words anywhere, because there is no
// second thing that needs one — the reader below names both, and a third fails to decode loudly.
//
// The reply's `outcome` is the five-word vocabulary from `types.ts` and it is checked here rather than
// assumed. That check is duplicated from the type on purpose, for the reason above.
//
// The five words are listed out below rather than derived from the union, which is the one place in
// this repository where a hand-written list guards a type that could produce it. Deriving it would need
// a runtime array of the outcomes, and a runtime array is a value a `types.ts` that promises to be a
// type declaration would then have to carry — so the list stays here, at the boundary that actually
// needs it, and a sixth outcome fails to decode loudly rather than silently.

import {
  LANGUAGE_PROTOCOL_VERSION,
  type LanguageReply,
  type LanguageRequest,
  type LanguageWord,
} from './types.js';

const REQUEST_KEYS: readonly string[] = ['protocol', 'request', 'text'];
const REPLY_KEYS: readonly string[] = ['protocol', 'outcome', 'lines'];

export function encodeLanguageRequest(request: LanguageRequest): string {
  return `${JSON.stringify({
    protocol: LANGUAGE_PROTOCOL_VERSION,
    request: request.word,
    text: request.text,
  })}\n`;
}

export function encodeLanguageReply(reply: LanguageReply): string {
  return `${JSON.stringify({ protocol: LANGUAGE_PROTOCOL_VERSION, ...reply })}\n`;
}

export type DecodedLanguageRequest =
  | { readonly kind: 'request'; readonly request: LanguageRequest }
  | { readonly kind: 'refused'; readonly reason: string };

/**
 * Reads one line into a request, or says why it will not.
 *
 * Everything decided here is structural, and the line between structural and semantic is drawn here
 * rather than left to be inferred. A question that is empty or absurdly long *decodes* — it is a
 * well-formed ask — and the plugin refuses it, because "this build will not answer that" is a
 * statement about the question and not about the envelope. `confirm` splits the same way at the same
 * place: an empty or absurdly long statement decodes, and the plugin refuses it. What fails to decode
 * is an envelope that is not this protocol's at all, and the endpoint answers those with `failed`,
 * exactly as the sibling endpoints do, because "whoever is on the other end is not speaking this
 * protocol" is not a refusal this build can make about a request it never received.
 *
 * The word is looked up rather than compared, so that both words carry the same field rules and the
 * same messages. The two differ in what the plugin *does* with the text and in nothing the envelope can
 * see; a reader with a branch per word would be two statements of one structure, and the second would
 * be the one that drifted.
 */
export function decodeLanguageRequest(line: string): DecodedLanguageRequest {
  const record = readObject(line);
  if (record === undefined) return refused('请求不是一个 JSON 对象。');

  const { protocol, request, text } = record;
  if (protocol !== LANGUAGE_PROTOCOL_VERSION) {
    return refused(
      `协议版本不匹配：Hikari 使用 ${LANGUAGE_PROTOCOL_VERSION}，请求使用 ${JSON.stringify(protocol)}。`,
    );
  }
  const word = readWord(request);
  if (word === undefined) {
    return refused(`未知请求：${JSON.stringify(request ?? null)}。`);
  }
  if (!hasExactlyKeys(record, REQUEST_KEYS)) {
    return refused(`请求 ${word} 的字段必须恰好是 ${REQUEST_KEYS.join('、')}。`);
  }
  if (typeof text !== 'string') {
    return refused(`${word} 的 text 必须是一个字符串。`);
  }

  return { kind: 'request', request: { word, text } };
}

// All three words, spelled out here rather than compared inline at the one call site above, so that the
// envelope's reader has one statement of what a word is. The three are the same *shape* of request — a
// word and a sentence — and this is the function that says so.
//
// This is the runtime boundary the vocabulary is checked at, and it is the only one. What it decides is
// whether a word exists; what a word *does* is `plugin.ts`'s, and the two are kept apart so that adding a
// word means changing both and being told so by the compiler rather than by a request that quietly took
// the wrong branch.
function readWord(value: unknown): LanguageWord | undefined {
  if (value === 'ask') return 'ask';
  if (value === 'confirm') return 'confirm';
  if (value === 'screen') return 'screen';
  return undefined;
}

export type DecodedLanguageReply =
  | { readonly kind: 'reply'; readonly reply: LanguageReply }
  | { readonly kind: 'unreadable'; readonly reason: string };

export function decodeLanguageReply(line: string): DecodedLanguageReply {
  const record = readObject(line);
  if (record === undefined) return unreadable('应答不是一个 JSON 对象。');

  const { protocol, outcome } = record;
  if (protocol !== LANGUAGE_PROTOCOL_VERSION) {
    return unreadable(
      `协议版本不匹配：本机使用 ${LANGUAGE_PROTOCOL_VERSION}，应答使用 ${JSON.stringify(protocol)}。`,
    );
  }
  if (!hasExactlyKeys(record, REPLY_KEYS)) {
    return unreadable(`应答的字段必须恰好是 ${REPLY_KEYS.join('、')}。`);
  }

  // The five words, listed rather than derived — see the note at the top of this file for why this is
  // the one hand-written list in the repository that guards a type which could produce it.
  if (
    outcome !== 'chatted' &&
    outcome !== 'answered' &&
    outcome !== 'recorded' &&
    outcome !== 'refused' &&
    outcome !== 'failed'
  ) {
    return unreadable(`未知应答结果：${JSON.stringify(outcome)}。`);
  }

  const lines = readLines(record.lines);
  if (lines === undefined) return unreadable('应答的 lines 不是一个字符串数组。');
  return { kind: 'reply', reply: { outcome, lines } };
}

function refused(reason: string): DecodedLanguageRequest {
  return { kind: 'refused', reason };
}

function unreadable(reason: string): DecodedLanguageReply {
  return { kind: 'unreadable', reason };
}

function readLines(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) return undefined;
  return value as string[];
}

function readObject(line: string): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  return parsed as Record<string, unknown>;
}

function hasExactlyKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  if (Object.keys(record).length !== keys.length) return false;
  return keys.every((key) => Object.hasOwn(record, key));
}

// Line framing, because a pipe is a byte stream and a stream has no message boundaries. One line's
// worth of state, and a refusal to keep more than that.
//
// Written out again rather than imported, for the reason `endpoint-path.ts` gives below: the
// alternative is a domain plugin depending on the Resident's composition root, and this is thirty
// lines.
export type LanguageLineRead =
  | { readonly kind: 'pending' }
  | { readonly kind: 'line'; readonly line: string }
  | { readonly kind: 'overflow' };

export class LanguageLineReader {
  #pending = '';
  #overflowed = false;

  constructor(private readonly limit: number) {}

  push(chunk: string): LanguageLineRead {
    if (this.#overflowed) return { kind: 'overflow' };

    this.#pending += chunk;
    const newline = this.#pending.indexOf('\n');
    if (newline === -1) {
      if (this.#pending.length > this.limit) {
        this.#overflowed = true;
        return { kind: 'overflow' };
      }
      return { kind: 'pending' };
    }

    const line = this.#pending.slice(0, newline);
    if (line.length > this.limit) {
      this.#overflowed = true;
      return { kind: 'overflow' };
    }
    return { kind: 'line', line };
  }
}
