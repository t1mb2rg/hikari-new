// The Resident's local control surface — discovery, wire vocabulary, and the client half of it.
//
// This is not a transport layer and it is not shared infrastructure. The only modules that import it
// are the Resident's own: `resident.ts` (which hands it to the endpoint), `control-endpoint.ts` (the
// listening half), and `control-command.ts` (the asking half). No plugin imports it, no
// module routes through it, and there is no registry behind it. The vocabulary below is closed, and
// it is closed because both of its words are the Resident's own: process lifetime (`stop`) and what
// an operator is told (`status`). A kind whose semantics belonged to another module would have to
// reach that module through here, and reaching another module is exactly what a router does — such a
// request belongs in that module's own endpoint instead.

import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { connect } from 'node:net';
import { resolve } from 'node:path';

import { RESIDENT_HINT } from './options.js';

/** The only version this build speaks. A mismatch is refused, never guessed at. */
export const CONTROL_PROTOCOL_VERSION = 1;

/**
 * A request is a short, exact word. There is deliberately no payload, no plugin id and no routing
 * field: nothing here is reserved for a future request, because a reserved field is a schema.
 */
export type ControlRequest = 'status' | 'stop';

export interface ControlReply {
  readonly outcome: 'ok' | 'failed';
  readonly lines: readonly string[];
}

/** The answer to a control request, in the four shapes the two commands have to tell apart. */
export type ControlOutcome =
  | { readonly kind: 'answered'; readonly outcome: 'ok' | 'failed'; readonly lines: readonly string[] }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unavailable'; readonly detail: string };

const PIPE_PREFIX = 'hikari-resident-';
const HASH_LENGTH = 16;

// Bounds on the decoded text, not on wire bytes. Both sides are ours, and the vocabulary is tiny:
// a request is about forty characters and a reply is seven short lines. The bound exists so that
// neither side can be made to buffer without limit by whoever is on the other end of the pipe.
export const MAX_CONTROL_REQUEST_LINE = 1024;
export const MAX_CONTROL_REPLY_LINE = 64 * 1024;
const REPLY_TIMEOUT_MS = 5000;

/**
 * The endpoint a data directory owns, or `undefined` on a host that has no pipe namespace.
 *
 * The name is derived rather than published, and that is a deliberate choice about which kind of
 * fact answers "is a resident running?". A published address file would answer it with a remembered
 * fact that can go stale — a file saying a resident exists after it is gone. A derived name is
 * answered by the operating system itself: connecting either finds a live endpoint or fails with
 * ENOENT, and ENOENT is not a cached opinion, it is the current truth.
 *
 * Both ends call this same function, so they agree by construction. That is also why the canonical
 * form is lowercased on Windows rather than left as the filesystem spelled it: `realpath` returns
 * the on-disk spelling when the directory exists and the lexical fallback is what runs when it does
 * not, and the two only meet if case is taken out of the comparison.
 */
export function controlEndpointPath(dataDir: string): string | undefined {
  if (process.platform !== 'win32') return undefined;

  const digest = createHash('sha256')
    .update(canonicalDataDir(dataDir), 'utf8')
    .digest('hex')
    .slice(0, HASH_LENGTH);

  return `\\\\.\\pipe\\${PIPE_PREFIX}${digest}`;
}

function canonicalDataDir(dataDir: string): string {
  const canonical = readCanonicalPath(dataDir) ?? resolve(dataDir);
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

// `realpathSync.native` is the filesystem's own answer: the on-disk spelling of every segment, one
// separator form, no trailing separator. It throws when the path does not exist, and a data
// directory that does not exist is an ordinary case here — it is exactly what `hikari init` has not
// created yet — so the lexical form stands in rather than turning that into an error this module
// has no business raising.
function readCanonicalPath(dataDir: string): string | undefined {
  try {
    return realpathSync.native(dataDir);
  } catch {
    return undefined;
  }
}

export function encodeControlRequest(request: ControlRequest): string {
  return `${JSON.stringify({ protocol: CONTROL_PROTOCOL_VERSION, request })}\n`;
}

export function encodeControlReply(reply: ControlReply): string {
  return `${JSON.stringify({ protocol: CONTROL_PROTOCOL_VERSION, ...reply })}\n`;
}

export type DecodedRequest =
  | { readonly kind: 'request'; readonly request: ControlRequest }
  | { readonly kind: 'refused'; readonly reason: string };

export function decodeControlRequest(line: string): DecodedRequest {
  const envelope = readEnvelope(line, ['protocol', 'request']);
  if (envelope === undefined) {
    return { kind: 'refused', reason: '请求不是一个只含 protocol 与 request 的对象。' };
  }

  const { protocol, request } = envelope;
  if (protocol !== CONTROL_PROTOCOL_VERSION) {
    return {
      kind: 'refused',
      reason: `协议版本不匹配：常驻使用 ${CONTROL_PROTOCOL_VERSION}，请求使用 ${JSON.stringify(protocol)}。`,
    };
  }
  if (request !== 'status' && request !== 'stop') {
    return { kind: 'refused', reason: `未知请求：${JSON.stringify(request)}。` };
  }

  return { kind: 'request', request };
}

export type DecodedReply =
  | { readonly kind: 'reply'; readonly outcome: 'ok' | 'failed'; readonly lines: readonly string[] }
  | { readonly kind: 'unreadable'; readonly reason: string };

export function decodeControlReply(line: string): DecodedReply {
  const envelope = readEnvelope(line, ['protocol', 'outcome', 'lines']);
  if (envelope === undefined) {
    return { kind: 'unreadable', reason: '应答不是一个只含 protocol、outcome 与 lines 的对象。' };
  }

  const { protocol, outcome, lines } = envelope;
  if (protocol !== CONTROL_PROTOCOL_VERSION) {
    return {
      kind: 'unreadable',
      reason: `协议版本不匹配：本机使用 ${CONTROL_PROTOCOL_VERSION}，应答使用 ${JSON.stringify(protocol)}。`,
    };
  }
  if (outcome !== 'ok' && outcome !== 'failed') {
    return { kind: 'unreadable', reason: `未知应答结果：${JSON.stringify(outcome)}。` };
  }
  if (!Array.isArray(lines) || lines.some((line) => typeof line !== 'string')) {
    return { kind: 'unreadable', reason: '应答的 lines 不是一个字符串数组。' };
  }

  return { kind: 'reply', outcome, lines };
}

// Exactly these keys and no others. The strictness is the point: an envelope that shrugged at
// unknown fields would already be an extensible schema, and "no payload, no routing, no plugin id"
// would stop being true of this build and become a promise about the next one instead.
function readEnvelope(line: string, keys: readonly string[]): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length) return undefined;
  for (const key of keys) if (!Object.hasOwn(record, key)) return undefined;
  return record;
}

// Line framing, because a pipe is a byte stream and a stream has no message boundaries. The reader
// keeps one line's worth of state and refuses to keep more than that.
export type LineRead =
  | { readonly kind: 'pending' }
  | { readonly kind: 'line'; readonly line: string }
  | { readonly kind: 'overflow' };

export class ControlLineReader {
  #pending = '';
  #overflowed = false;

  constructor(private readonly limit: number) {}

  push(chunk: string): LineRead {
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

export function requestControl(dataDir: string, request: ControlRequest): Promise<ControlOutcome> {
  const path = controlEndpointPath(dataDir);
  if (path === undefined) {
    return Promise.resolve({
      kind: 'unavailable',
      detail: '控制通道依赖 Windows 命名管道，本机没有。',
    });
  }

  return new Promise<ControlOutcome>((settle) => {
    const socket = connect(path);
    const reader = new ControlLineReader(MAX_CONTROL_REPLY_LINE);
    let settled = false;

    const finish = (outcome: ControlOutcome): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      settle(outcome);
    };

    socket.setEncoding('utf8');
    socket.setTimeout(REPLY_TIMEOUT_MS, () => {
      finish({ kind: 'unavailable', detail: `常驻在 ${REPLY_TIMEOUT_MS}ms 内没有应答。` });
    });

    socket.on('connect', () => socket.write(encodeControlRequest(request)));

    socket.on('data', (chunk: string) => {
      const read = reader.push(chunk);
      if (read.kind === 'pending') return;
      if (read.kind === 'overflow') {
        finish({ kind: 'unavailable', detail: '常驻的应答超过了长度上限。' });
        return;
      }

      const decoded = decodeControlReply(read.line);
      finish(
        decoded.kind === 'reply'
          ? { kind: 'answered', outcome: decoded.outcome, lines: decoded.lines }
          : { kind: 'unavailable', detail: decoded.reason },
      );
    });

    // ENOENT is the one failure that is an answer rather than an error: nothing is listening on this
    // data directory's endpoint, which is precisely "no resident is running". Everything else — a
    // refused connection, an unreadable reply, a socket that closed mid-question — is reported as
    // something that went wrong, because folding those into "no resident" would tell a human there
    // is nothing to find while something is there but broken.
    socket.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' || error.code === 'ECONNREFUSED') return finish({ kind: 'absent' });
      finish({ kind: 'unavailable', detail: error.message });
    });

    socket.on('close', () => {
      finish({ kind: 'unavailable', detail: '常驻关闭了连接，但没有应答。' });
    });
  });
}

/** What an operator is told when the control channel could not answer. */
export function controlFailureLines(answer: Exclude<ControlOutcome, { readonly kind: 'answered' }>): readonly string[] {
  if (answer.kind === 'absent') return ['没有正在运行的 Hikari 常驻。', RESIDENT_HINT];
  return [`无法访问 Hikari 常驻的控制通道：${answer.detail}`];
}
