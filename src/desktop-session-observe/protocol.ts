// The wire vocabulary of the desktop session observation endpoint, owned by the module whose
// semantics it carries.
//
// Both ends call the encoders below, which is what keeps a client and a server from being two
// drifting statements of what a `status` question means. The client in `src/cli/observe.ts` does not
// have a protocol of its own and must not grow one.
//
// The strictness is the same strictness the other endpoints in this repository use and it is here for
// the same reason: an envelope that shrugged at an unknown field would already be an extensible
// schema, and the next person to want a field would find the room already reserved. Unlike the
// relevance endpoint, both reply shapes have the same key set — `outcome` is what tells them apart —
// so there is one reply check rather than two, and a reply that claimed anything else fails to decode
// rather than being read as an observation.

import {
  DESKTOP_SESSION_OBSERVE_PROTOCOL_VERSION,
  type DesktopSessionObserveReply,
  type DesktopSessionObserveRequest,
} from './types.js';

const REQUEST_KEYS: readonly string[] = ['protocol', 'request'];
const REPLY_KEYS: readonly string[] = ['protocol', 'outcome', 'lines'];

export function encodeObserveRequest(request: DesktopSessionObserveRequest): string {
  return `${JSON.stringify({ protocol: DESKTOP_SESSION_OBSERVE_PROTOCOL_VERSION, request: request.word })}\n`;
}

export function encodeObserveReply(reply: DesktopSessionObserveReply): string {
  return `${JSON.stringify({ protocol: DESKTOP_SESSION_OBSERVE_PROTOCOL_VERSION, ...reply })}\n`;
}

export type DecodedObserveRequest =
  | { readonly kind: 'request'; readonly request: DesktopSessionObserveRequest }
  | { readonly kind: 'refused'; readonly reason: string };

/**
 * Reads one line into a request, or says why it will not.
 *
 * Everything decided here is structural — is this an object, is the version this build's, is the word
 * the one word this endpoint answers, are the fields exactly that word's. There is nothing else to
 * decide, because a request carries no payload: the question is about the composition's own current
 * state, and a client that could name a facet in it would be asking a different question than the one
 * this surface was built to answer.
 */
export function decodeObserveRequest(line: string): DecodedObserveRequest {
  const record = readObject(line);
  if (record === undefined) return { kind: 'refused', reason: '请求不是一个 JSON 对象。' };

  const { protocol, request } = record;
  if (protocol !== DESKTOP_SESSION_OBSERVE_PROTOCOL_VERSION) {
    return {
      kind: 'refused',
      reason: `协议版本不匹配：Hikari 使用 ${DESKTOP_SESSION_OBSERVE_PROTOCOL_VERSION}，请求使用 ${JSON.stringify(protocol)}。`,
    };
  }
  if (request !== 'status') {
    return { kind: 'refused', reason: `未知请求：${JSON.stringify(request ?? null)}。` };
  }
  if (!hasExactlyKeys(record, REQUEST_KEYS)) {
    return { kind: 'refused', reason: `请求 ${request} 的字段必须恰好是 ${REQUEST_KEYS.join('、')}。` };
  }

  return { kind: 'request', request: { word: 'status' } };
}

export type DecodedObserveReply =
  | { readonly kind: 'reply'; readonly reply: DesktopSessionObserveReply }
  | { readonly kind: 'unreadable'; readonly reason: string };

export function decodeObserveReply(line: string): DecodedObserveReply {
  const record = readObject(line);
  if (record === undefined) return unreadable('应答不是一个 JSON 对象。');

  const { protocol, outcome } = record;
  if (protocol !== DESKTOP_SESSION_OBSERVE_PROTOCOL_VERSION) {
    return unreadable(
      `协议版本不匹配：本机使用 ${DESKTOP_SESSION_OBSERVE_PROTOCOL_VERSION}，应答使用 ${JSON.stringify(protocol)}。`,
    );
  }
  if (!hasExactlyKeys(record, REPLY_KEYS)) {
    return unreadable(`应答的字段必须恰好是 ${REPLY_KEYS.join('、')}。`);
  }

  // The two-word check is duplicated from `types.ts` on purpose: that union is a compile-time fact
  // about our own code, and this is the runtime boundary where a string we did not write arrives.
  if (outcome !== 'ok' && outcome !== 'failed') {
    return unreadable(`未知应答结果：${JSON.stringify(outcome)}。`);
  }

  const read = readLines(record.lines);
  if (read === undefined) return unreadable('应答的 lines 不是一个字符串数组。');
  return { kind: 'reply', reply: { outcome, lines: read } };
}

function unreadable(reason: string): DecodedObserveReply {
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
// Written out again rather than imported, for the reason given in `endpoint-path.ts`: the alternative
// is a domain plugin depending on the Resident's composition root, and this is thirty lines.
export type ObserveLineRead =
  | { readonly kind: 'pending' }
  | { readonly kind: 'line'; readonly line: string }
  | { readonly kind: 'overflow' };

export class ObserveLineReader {
  #pending = '';
  #overflowed = false;

  constructor(private readonly limit: number) {}

  push(chunk: string): ObserveLineRead {
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
