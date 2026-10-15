// The wire vocabulary of the executor's ingress, owned by the module whose semantics it carries.
//
// One word, one question, one answer: the human's sentence and the repository it is about go in, and the
// lines the executor decided to say come back. Nothing about *whether* a run may happen is decided here
// — that is `execute.ts`, which asks the declaration set before anything starts. This file decides
// structure only: is it an object, is the version this build's, is the word the one word, are the fields
// exactly the ones that word has, are both payloads strings.
//
// Same discipline as `changeable-repositories/protocol.ts` and deliberately not its code: that module's
// codec carries a list of directories and its own version, and importing it would mean one module's
// envelope being reused by a module that admits different fields — which is how a shared codec starts to
// grow a union of everybody's payloads.

export const EXECUTOR_PROTOCOL = 'repository-change-executor.act';

/** What a request may be: one word, one repository, one sentence. */
export interface RepositoryChangeWireRequest {
  readonly repository: string;
  readonly mandate: string;
}

/** What comes back: lines the human reads, and whether the asking got as far as an answer. */
export interface RepositoryChangeWireReply {
  readonly outcome: 'ok' | 'failed';
  readonly lines: readonly string[];
}

/** The most a single request line may be: a repository name and a sentence, generously sized. */
export const MAX_EXECUTOR_REQUEST_LINE = 16 * 1024;

const REQUEST_KEYS: readonly string[] = ['protocol', 'request', 'repository', 'mandate'];
const REPLY_KEYS: readonly string[] = ['protocol', 'outcome', 'lines'];
const WORD = 'act';

export function encodeRepositoryChangeRequest(request: RepositoryChangeWireRequest): string {
  return `${JSON.stringify({
    protocol: EXECUTOR_PROTOCOL,
    request: WORD,
    repository: request.repository,
    mandate: request.mandate,
  })}\n`;
}

export function encodeRepositoryChangeReply(reply: RepositoryChangeWireReply): string {
  return `${JSON.stringify({ protocol: EXECUTOR_PROTOCOL, outcome: reply.outcome, lines: reply.lines })}\n`;
}

export type DecodedRepositoryChangeRequest =
  | { readonly kind: 'request'; readonly request: RepositoryChangeWireRequest }
  | { readonly kind: 'refused'; readonly reason: string };

export function decodeRepositoryChangeRequest(line: string): DecodedRepositoryChangeRequest {
  const record = readObject(line);
  if (record === undefined) return { kind: 'refused', reason: '请求不是一个 JSON 对象。' };

  const { protocol, request } = record;
  if (protocol !== EXECUTOR_PROTOCOL) {
    return {
      kind: 'refused',
      reason: `协议版本不匹配：Hikari 使用 ${EXECUTOR_PROTOCOL}，请求使用 ${JSON.stringify(protocol ?? null)}。`,
    };
  }
  if (request !== WORD) {
    return { kind: 'refused', reason: `未知请求：${JSON.stringify(request ?? null)}。` };
  }
  if (!hasExactlyKeys(record, REQUEST_KEYS)) {
    return { kind: 'refused', reason: `请求 ${WORD} 的字段必须恰好是 ${REQUEST_KEYS.join('、')}。` };
  }

  const { repository, mandate } = record;
  if (typeof repository !== 'string' || typeof mandate !== 'string') {
    return { kind: 'refused', reason: 'repository 与 mandate 都必须是字符串。' };
  }

  return { kind: 'request', request: { repository, mandate } };
}

export type DecodedRepositoryChangeReply =
  | { readonly kind: 'reply'; readonly outcome: 'ok' | 'failed'; readonly lines: readonly string[] }
  | { readonly kind: 'unreadable'; readonly reason: string };

export function decodeRepositoryChangeReply(line: string): DecodedRepositoryChangeReply {
  const record = readObject(line);
  if (record === undefined) return { kind: 'unreadable', reason: '应答不是一个 JSON 对象。' };
  if (!hasExactlyKeys(record, REPLY_KEYS)) {
    return { kind: 'unreadable', reason: `应答的字段必须恰好是 ${REPLY_KEYS.join('、')}。` };
  }

  const { protocol, outcome, lines } = record;
  if (protocol !== EXECUTOR_PROTOCOL) {
    return {
      kind: 'unreadable',
      reason: `协议版本不匹配：本机使用 ${EXECUTOR_PROTOCOL}，应答使用 ${JSON.stringify(protocol ?? null)}。`,
    };
  }
  if (outcome !== 'ok' && outcome !== 'failed') {
    return { kind: 'unreadable', reason: `未知应答结果：${JSON.stringify(outcome ?? null)}。` };
  }
  if (!Array.isArray(lines) || lines.some((value) => typeof value !== 'string')) {
    return { kind: 'unreadable', reason: '应答的 lines 不是一个字符串数组。' };
  }

  return { kind: 'reply', outcome, lines: lines as string[] };
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

// Line framing, because a pipe is a byte stream and a stream has no message boundaries. Written out here
// rather than imported, for the reason the sibling's is: a domain module reaching into another plugin for
// a transport detail is a worse thing than two short classes.
export type RepositoryChangeLineRead =
  | { readonly kind: 'pending' }
  | { readonly kind: 'line'; readonly line: string }
  | { readonly kind: 'overflow' };

export class RepositoryChangeLineReader {
  #pending = '';
  #overflowed = false;

  constructor(private readonly limit: number) {}

  push(chunk: string): RepositoryChangeLineRead {
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
