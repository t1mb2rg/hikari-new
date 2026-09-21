// The wire vocabulary of the work focus endpoint, owned by the module whose semantics it carries.
//
// This file is the reason the CLI does not have a protocol of its own. A client half that re-encoded
// requests would be a second, drifting statement of what `declare` means on the wire; here both ends
// call the same encoder, so they agree by construction rather than by convention.
//
// It is not a copy of `src/cli/control.ts` and it must not become one. That module's whole design is
// that its two words are the Resident's own and its envelope has no payload; this one carries text a
// human wrote, and that difference shows up in every line below — a per-word key set, payload types
// to check, and a request bound three orders of magnitude larger. What is shared is the *shape* of
// the discipline (strict envelopes, exact key sets, bounded framing), and sharing the shape is not
// the same as sharing the code.

import { WORK_FOCUS_PROTOCOL_VERSION, type WorkFocusReply, type WorkFocusRequest, type WorkFocusWord } from './types.js';

const WORDS: readonly WorkFocusWord[] = ['declare', 'replace', 'clear', 'status'];

// Exactly these keys and no others, per word. The strictness is the point: an envelope that shrugged
// at an unknown field would already be an extensible schema, and the next person to want a field
// would find the room already reserved for them.
const REQUEST_KEYS: Readonly<Record<WorkFocusWord, readonly string[]>> = {
  declare: ['protocol', 'request', 'designation'],
  replace: ['protocol', 'request', 'designations'],
  clear: ['protocol', 'request'],
  status: ['protocol', 'request'],
};

const REPLY_KEYS: readonly string[] = ['protocol', 'outcome', 'lines'];

// Written out per word rather than spread, because the wire says `request` and the type says `word`.
// A spread would have put `word` on the wire and encoded nothing at all that `decodeWorkFocusRequest`
// could read back — a round trip that only looks like one.
export function encodeWorkFocusRequest(request: WorkFocusRequest): string {
  const envelope: Record<string, unknown> = { protocol: WORK_FOCUS_PROTOCOL_VERSION, request: request.word };
  if (request.word === 'declare') envelope.designation = request.designation;
  if (request.word === 'replace') envelope.designations = request.designations;

  return `${JSON.stringify(envelope)}\n`;
}

export function encodeWorkFocusReply(reply: WorkFocusReply): string {
  return `${JSON.stringify({ protocol: WORK_FOCUS_PROTOCOL_VERSION, ...reply })}\n`;
}

export type DecodedWorkFocusRequest =
  | { readonly kind: 'request'; readonly request: WorkFocusRequest }
  | { readonly kind: 'refused'; readonly reason: string };

/**
 * Reads one line into a request, or says why it will not.
 *
 * Everything decided here is structural: is this an object, is the version this build's, is the word
 * one of the four, are the fields exactly the ones that word has, do the payloads have the type they
 * claim. Whether a designation is *acceptable* is not decided here — an empty import list, a blank
 * designation, a duplicate: those are statements about the focus set, and they belong to the module
 * that holds it.
 */
export function decodeWorkFocusRequest(line: string): DecodedWorkFocusRequest {
  const record = readObject(line);
  if (record === undefined) return refused('请求不是一个 JSON 对象。');

  const { protocol, request } = record;
  if (protocol !== WORK_FOCUS_PROTOCOL_VERSION) {
    return refused(
      `协议版本不匹配：Hikari 使用 ${WORK_FOCUS_PROTOCOL_VERSION}，请求使用 ${JSON.stringify(protocol)}。`,
    );
  }
  if (typeof request !== 'string' || !isWord(request)) {
    return refused(`未知请求：${JSON.stringify(request ?? null)}。`);
  }

  const keys = REQUEST_KEYS[request];
  if (!hasExactlyKeys(record, keys)) {
    return refused(`请求 ${request} 的字段必须恰好是 ${keys.join('、')}。`);
  }

  if (request === 'declare') {
    const { designation } = record;
    if (typeof designation !== 'string') return refused('declare 的 designation 必须是一个字符串。');
    return { kind: 'request', request: { word: 'declare', designation } };
  }

  if (request === 'replace') {
    const { designations } = record;
    if (!Array.isArray(designations) || designations.some((value) => typeof value !== 'string')) {
      return refused('replace 的 designations 必须是一个字符串数组。');
    }
    return { kind: 'request', request: { word: 'replace', designations: designations as string[] } };
  }

  return { kind: 'request', request: { word: request } };
}

export type DecodedWorkFocusReply =
  | { readonly kind: 'reply'; readonly outcome: 'ok' | 'failed'; readonly lines: readonly string[] }
  | { readonly kind: 'unreadable'; readonly reason: string };

export function decodeWorkFocusReply(line: string): DecodedWorkFocusReply {
  const record = readObject(line);
  if (record === undefined) return { kind: 'unreadable', reason: '应答不是一个 JSON 对象。' };
  if (!hasExactlyKeys(record, REPLY_KEYS)) {
    return { kind: 'unreadable', reason: `应答的字段必须恰好是 ${REPLY_KEYS.join('、')}。` };
  }

  const { protocol, outcome, lines } = record;
  if (protocol !== WORK_FOCUS_PROTOCOL_VERSION) {
    return {
      kind: 'unreadable',
      reason: `协议版本不匹配：本机使用 ${WORK_FOCUS_PROTOCOL_VERSION}，应答使用 ${JSON.stringify(protocol)}。`,
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

function isWord(value: string): value is WorkFocusWord {
  return (WORDS as readonly string[]).includes(value);
}

function refused(reason: string): DecodedWorkFocusRequest {
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
// This is the same algorithm the control channel's reader runs, written out again rather than
// imported. Importing it would mean a domain plugin reaching into `src/cli/` — the Resident's own
// composition root — for a transport detail, and a plugin that depends on the composition root is a
// plugin whose lifetime is entangled with a command. Two instances is not enough to justify that,
// and an abstraction in the wrong place is harder to withdraw than a repetition is to remove.
export type WorkFocusLineRead =
  | { readonly kind: 'pending' }
  | { readonly kind: 'line'; readonly line: string }
  | { readonly kind: 'overflow' };

export class WorkFocusLineReader {
  #pending = '';
  #overflowed = false;

  constructor(private readonly limit: number) {}

  push(chunk: string): WorkFocusLineRead {
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
