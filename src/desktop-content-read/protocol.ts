// The wire vocabulary of the content read endpoint, owned by the module whose semantics it carries.
//
// The same arrangement as `desktop-session-observe/protocol.ts`, and for the same reason: both ends
// call these encoders, so a client and a server cannot become two drifting statements of what a
// `status` question means. The client in `src/cli/content.ts` has no protocol of its own and must not
// grow one.
//
// The strictness is the same strictness the other endpoints in this repository use, and it carries
// more here than it does there. There the schema was protecting a vocabulary; here it is also the
// *access* boundary. Check B of the implementation mandate measured this machine's named-pipe
// security: the object's default descriptor grants Everyone and ANONYMOUS LOGON `FILE_GENERIC_READ`,
// which lets a foreign principal *open* the pipe but grants no `FILE_WRITE_DATA` — and a named-pipe
// client must write to say anything. So a caller who is not entitled to this content cannot drive a
// request through this socket, and it is this file's exact-key envelope, not the transport, that is
// what makes that true. A permissive decoder would hand the same caller the content the transport
// declined to carry.
//
// The measurement is recorded in the delivery notes rather than asserted here, and it is asserted
// where it can be checked — `test/desktop-content-read.test.mjs` connects without sending and requires
// that nothing comes back.

import {
  DESKTOP_CONTENT_READ_PROTOCOL_VERSION,
  type DesktopContentReadReply,
  type DesktopContentReadRequest,
} from './types.js';

const REQUEST_KEYS: readonly string[] = ['protocol', 'request'];
const REPLY_KEYS: readonly string[] = ['protocol', 'outcome', 'lines'];

export function encodeContentReadRequest(request: DesktopContentReadRequest): string {
  return `${JSON.stringify({ protocol: DESKTOP_CONTENT_READ_PROTOCOL_VERSION, request: request.word })}\n`;
}

export function encodeContentReadReply(reply: DesktopContentReadReply): string {
  return `${JSON.stringify({ protocol: DESKTOP_CONTENT_READ_PROTOCOL_VERSION, ...reply })}\n`;
}

export type DecodedContentReadRequest =
  | { readonly kind: 'request'; readonly request: DesktopContentReadRequest }
  | { readonly kind: 'refused'; readonly reason: string };

/**
 * Reads one line into a request, or says why it will not.
 *
 * Everything decided here is structural, and the vocabulary is deliberately one word wide. A request
 * that could name a window would be a request that chooses the target, and choosing the target is the
 * one decision §3.4 spends its whole length making un-forgeable from outside: the window is the one
 * Hikari observed, and a caller who could name a handle could ask about a window Hikari never saw.
 */
export function decodeContentReadRequest(line: string): DecodedContentReadRequest {
  const record = readObject(line);
  if (record === undefined) return { kind: 'refused', reason: '请求不是一个 JSON 对象。' };

  const { protocol, request } = record;
  if (protocol !== DESKTOP_CONTENT_READ_PROTOCOL_VERSION) {
    return {
      kind: 'refused',
      reason: `协议版本不匹配：Hikari 使用 ${DESKTOP_CONTENT_READ_PROTOCOL_VERSION}，请求使用 ${JSON.stringify(protocol)}。`,
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

export type DecodedContentReadReply =
  | { readonly kind: 'reply'; readonly reply: DesktopContentReadReply }
  | { readonly kind: 'unreadable'; readonly reason: string };

export function decodeContentReadReply(line: string): DecodedContentReadReply {
  const record = readObject(line);
  if (record === undefined) return unreadable('应答不是一个 JSON 对象。');

  const { protocol, outcome } = record;
  if (protocol !== DESKTOP_CONTENT_READ_PROTOCOL_VERSION) {
    return unreadable(
      `协议版本不匹配：本机使用 ${DESKTOP_CONTENT_READ_PROTOCOL_VERSION}，应答使用 ${JSON.stringify(protocol)}。`,
    );
  }
  if (!hasExactlyKeys(record, REPLY_KEYS)) {
    return unreadable(`应答的字段必须恰好是 ${REPLY_KEYS.join('、')}。`);
  }

  // Duplicated from `types.ts` on purpose, as in the sibling endpoint: that union is a compile-time
  // fact about our own code, and this is the runtime boundary where a string we did not write arrives.
  if (outcome !== 'ok' && outcome !== 'failed') {
    return unreadable(`未知应答结果：${JSON.stringify(outcome)}。`);
  }

  const read = readLines(record.lines);
  if (read === undefined) return unreadable('应答的 lines 不是一个字符串数组。');
  return { kind: 'reply', reply: { outcome, lines: read } };
}

function unreadable(reason: string): DecodedContentReadReply {
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
// Written out again rather than imported, for the reason `endpoint-path.ts` gives: the alternative is
// a domain plugin depending on a sibling domain module for thirty lines of framing.
export type ContentReadLineRead =
  | { readonly kind: 'pending' }
  | { readonly kind: 'line'; readonly line: string }
  | { readonly kind: 'overflow' };

export class ContentReadLineReader {
  #pending = '';
  #overflowed = false;

  constructor(private readonly limit: number) {}

  push(chunk: string): ContentReadLineRead {
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
