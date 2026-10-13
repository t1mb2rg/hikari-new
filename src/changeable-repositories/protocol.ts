// The wire vocabulary of the authorization endpoint, owned by the module whose semantics it carries.
//
// This file is the reason the CLI does not have a protocol of its own. A client half that re-encoded
// requests would be a second, drifting statement of what `declare` means on the wire; here both ends
// call the same encoder, so they agree by construction rather than by convention.
//
// It is deliberately a near-copy of `work-focus/protocol.ts`, and the copy is the honest shape. The two
// differ in exactly one thing — the payload of the two moving words is a list of directories rather
// than a piece of text — and importing the sibling's codec would mean one module's envelope being
// reused by a module that admits different fields, which is how a shared codec starts to grow a union
// of everybody's payloads. What is shared is the *shape* of the discipline (strict envelopes, exact
// key sets, bounded framing), and sharing the shape is not the same as sharing the code.

import {
  CHANGEABLE_REPOSITORIES_PROTOCOL_VERSION,
  type ChangeableRepositoriesReply,
  type ChangeableRepositoriesRequest,
  type ChangeableRepositoriesWord,
} from './types.js';

const WORDS: readonly ChangeableRepositoriesWord[] = ['declare', 'replace', 'clear', 'status'];

// Exactly these keys and no others, per word. The strictness is the point: an envelope that shrugged at
// an unknown field would already be an extensible schema, and the next person to want a field would
// find the room already reserved for them.
//
// `declare` and `replace` admit the same key. That is not a shortcut — the two words take the same
// shape and differ only in whether the earlier members survive, so an envelope that told them apart
// would be encoding a difference the request does not have.
const REQUEST_KEYS: Readonly<Record<ChangeableRepositoriesWord, readonly string[]>> = {
  declare: ['protocol', 'request', 'repositories'],
  replace: ['protocol', 'request', 'repositories'],
  clear: ['protocol', 'request'],
  status: ['protocol', 'request'],
};

const REPLY_KEYS: readonly string[] = ['protocol', 'outcome', 'lines'];

// Written out per word rather than spread, because the wire says `request` and the type says `word`. A
// spread would have put `word` on the wire and encoded nothing at all that `decode` could read back —
// a round trip that only looks like one.
export function encodeChangeableRepositoriesRequest(request: ChangeableRepositoriesRequest): string {
  const envelope: Record<string, unknown> = {
    protocol: CHANGEABLE_REPOSITORIES_PROTOCOL_VERSION,
    request: request.word,
  };
  if (request.word === 'declare' || request.word === 'replace') {
    envelope.repositories = request.repositories;
  }

  return `${JSON.stringify(envelope)}\n`;
}

export function encodeChangeableRepositoriesReply(reply: ChangeableRepositoriesReply): string {
  return `${JSON.stringify({ protocol: CHANGEABLE_REPOSITORIES_PROTOCOL_VERSION, ...reply })}\n`;
}

export type DecodedChangeableRepositoriesRequest =
  | { readonly kind: 'request'; readonly request: ChangeableRepositoriesRequest }
  | { readonly kind: 'refused'; readonly reason: string };

/**
 * Reads one line into a request, or says why it will not.
 *
 * Everything decided here is structural: is this an object, is the version this build's, is the word
 * one of the four, are the fields exactly the ones that word has, is the payload an array of strings.
 * Whether a directory is *acceptable* is not decided here — is it absolute, is it there, is it a
 * directory: those are statements about the authorization set, and they belong to the module that
 * holds it. This file never touches a disk, which is what keeps the two questions from meeting.
 */
export function decodeChangeableRepositoriesRequest(line: string): DecodedChangeableRepositoriesRequest {
  const record = readObject(line);
  if (record === undefined) return refused('请求不是一个 JSON 对象。');

  const { protocol, request } = record;
  if (protocol !== CHANGEABLE_REPOSITORIES_PROTOCOL_VERSION) {
    return refused(
      `协议版本不匹配：Hikari 使用 ${CHANGEABLE_REPOSITORIES_PROTOCOL_VERSION}，请求使用 ${JSON.stringify(protocol)}。`,
    );
  }
  if (typeof request !== 'string' || !isWord(request)) {
    return refused(`未知请求：${JSON.stringify(request ?? null)}。`);
  }

  const keys = REQUEST_KEYS[request];
  if (!hasExactlyKeys(record, keys)) {
    return refused(`请求 ${request} 的字段必须恰好是 ${keys.join('、')}。`);
  }

  if (request === 'declare' || request === 'replace') {
    const { repositories } = record;
    if (!Array.isArray(repositories) || repositories.some((value) => typeof value !== 'string')) {
      return refused(`${request} 的 repositories 必须是一个字符串数组。`);
    }
    return { kind: 'request', request: { word: request, repositories: repositories as string[] } };
  }

  return { kind: 'request', request: { word: request } };
}

export type DecodedChangeableRepositoriesReply =
  | { readonly kind: 'reply'; readonly outcome: 'ok' | 'failed'; readonly lines: readonly string[] }
  | { readonly kind: 'unreadable'; readonly reason: string };

export function decodeChangeableRepositoriesReply(line: string): DecodedChangeableRepositoriesReply {
  const record = readObject(line);
  if (record === undefined) return { kind: 'unreadable', reason: '应答不是一个 JSON 对象。' };
  if (!hasExactlyKeys(record, REPLY_KEYS)) {
    return { kind: 'unreadable', reason: `应答的字段必须恰好是 ${REPLY_KEYS.join('、')}。` };
  }

  const { protocol, outcome, lines } = record;
  if (protocol !== CHANGEABLE_REPOSITORIES_PROTOCOL_VERSION) {
    return {
      kind: 'unreadable',
      reason: `协议版本不匹配：本机使用 ${CHANGEABLE_REPOSITORIES_PROTOCOL_VERSION}，应答使用 ${JSON.stringify(protocol)}。`,
    };
  }
  if (outcome !== 'ok' && outcome !== 'failed') {
    return { kind: 'unreadable', reason: `未知应答结果：${JSON.stringify(outcome)}。` };
  }
  if (!Array.isArray(lines) || lines.some((value) => typeof value !== 'string')) {
    return { kind: 'unreadable', reason: '应答的 lines 不是一个字符串数组。' };
  }

  return { kind: 'reply', outcome, lines: lines as string[] };
}

function isWord(value: string): value is ChangeableRepositoriesWord {
  return (WORDS as readonly string[]).includes(value);
}

function refused(reason: string): DecodedChangeableRepositoriesRequest {
  return { kind: 'refused', reason };
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

// Line framing, because a pipe is a byte stream and a stream has no message boundaries. The reader
// keeps one line's worth of state and refuses to keep more than that.
//
// Written out again rather than imported, for the reason the sibling's is: importing it would mean a
// domain plugin reaching into another plugin for a transport detail. Two instances is not enough to
// justify an abstraction, and an abstraction in the wrong place is harder to withdraw than a
// repetition is to remove.
export type ChangeableRepositoriesLineRead =
  | { readonly kind: 'pending' }
  | { readonly kind: 'line'; readonly line: string }
  | { readonly kind: 'overflow' };

export class ChangeableRepositoriesLineReader {
  #pending = '';
  #overflowed = false;

  constructor(private readonly limit: number) {}

  push(chunk: string): ChangeableRepositoriesLineRead {
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
