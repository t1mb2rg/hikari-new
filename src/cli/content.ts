// The asking half of the desktop content read endpoint — discovery, the client end of the pipe, and
// the three ways asking can fail.
//
// The vocabulary is *not* here. The request word, the reply shapes and the endpoint derivation all come
// from `../desktop-content-read/index.js`, so the two ends of this pipe cannot disagree about what a
// `status` question means without the compiler noticing first. There is one question and this file
// sends it; it does not take a request as a parameter, because a parameter would be an argument surface
// for questions that do not exist — and here that is a stronger statement than it is for the sibling
// client, because a parameter that could name a window would let whoever holds this function choose
// what Hikari reads.
//
// The three situations are the sibling client's three, with the same missing fourth and the same
// reason:
//
//   answered      the read ran. The reply may still say `failed` — a window that closed, a window
//                 Hikari cannot attribute to a human — and that is Hikari answering, not this command
//                 failing. The exit code follows what it said.
//   unavailable   something went wrong reaching the endpoint, or it answered unreadably.
//   absent        nothing is serving this endpoint on this data directory.
//
// `absent` is not quite one fact, and it is the same second fact the sibling client faces: a resident
// unloading plugins in reverse load order takes this endpoint down while the process is still alive
// and still answering on its control channel. This plugin loads after `desktop-session-observe` and
// before `work-focus` in the base roster (`src/cli/resident.ts`), so it is unloaded between them — the
// same narrow window, and the wording below claims only what was established.
//
// ---------------------------------------------------------------------------------------------
// Why the bound is what it is
// ---------------------------------------------------------------------------------------------
//
// Longer than the sibling's, and again not a preference. That answer is an assessment, which acquires
// two sources through subprocesses. This one acquires nothing: the window was sampled on an earlier
// awareness cadence, and what remains is one UIA walk, which the walker bounds at 20 seconds of its
// own. The bound here is what stops a client waiting on an endpoint that has stopped answering
// altogether, so it has to sit above the walker's own bound with room to frame the reply — hence 30
// seconds against the walker's 20, the same pair the sibling uses for a different reason.
//
// A client bound tied to the wrong one of those would report a failure for a read that was still
// running, which is worse than waiting: it is a claim about a window that no one has established.

import { connect } from 'node:net';

import {
  ContentReadLineReader,
  MAX_CONTENT_READ_REPLY_LINE,
  contentReadEndpointPath,
  decodeContentReadReply,
  encodeContentReadRequest,
  type DesktopContentReadOutcome,
} from '../desktop-content-read/index.js';

import { RESIDENT_HINT } from './options.js';

const REPLY_TIMEOUT_MS = 30_000;

export function requestDesktopContentRead(rootDir: string): Promise<DesktopContentReadOutcome> {
  const path = contentReadEndpointPath(rootDir);
  if (path === undefined) {
    return Promise.resolve({
      kind: 'unavailable',
      detail: '桌面正文读取入口依赖 Windows 命名管道，本机没有。',
    });
  }

  return new Promise<DesktopContentReadOutcome>((settle) => {
    const socket = connect(path);
    const reader = new ContentReadLineReader(MAX_CONTENT_READ_REPLY_LINE);
    let settled = false;

    // First answer wins, and every path below goes through here. `close` follows `error` on a
    // connection that never connected, so without the guard the socket's own teardown would settle the
    // question with "no reply" behind whatever the error said.
    const finish = (outcome: DesktopContentReadOutcome): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      settle(outcome);
    };

    socket.setEncoding('utf8');
    socket.setTimeout(REPLY_TIMEOUT_MS, () => {
      finish({ kind: 'unavailable', detail: `桌面正文读取入口在 ${REPLY_TIMEOUT_MS}ms 内没有应答。` });
    });

    socket.on('connect', () => socket.write(encodeContentReadRequest({ word: 'status' })));

    socket.on('data', (chunk: string) => {
      if (settled) return;

      const read = reader.push(chunk);
      if (read.kind === 'pending') return;
      if (read.kind === 'overflow') {
        finish({ kind: 'unavailable', detail: '桌面正文读取入口的应答超过了长度上限。' });
        return;
      }

      const decoded = decodeContentReadReply(read.line);
      finish(
        decoded.kind === 'reply'
          ? { kind: 'answered', reply: decoded.reply }
          : { kind: 'unavailable', detail: decoded.reason },
      );
    });

    // ENOENT is the one failure that is an answer rather than an error: nothing is listening on this
    // data directory's content read endpoint. Everything else — a refused connection, an unreadable
    // reply, a socket that closed mid-question — is reported as something that went wrong, because
    // folding those into "nothing there" would tell a human there is nothing to find while something is
    // there but broken.
    socket.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' || error.code === 'ECONNREFUSED') return finish({ kind: 'absent' });
      finish({ kind: 'unavailable', detail: error.message });
    });

    socket.on('close', () => {
      finish({ kind: 'unavailable', detail: '桌面正文读取入口关闭了连接，但没有应答。' });
    });
  });
}

/** What a human is told when the content read endpoint could not answer. */
export function contentReadFailureLines(
  answer: Exclude<DesktopContentReadOutcome, { readonly kind: 'answered' }>,
): readonly string[] {
  if (answer.kind === 'absent') {
    return [
      '这个数据目录上没有正在提供桌面正文读取入口的 Hikari 常驻。',
      `若常驻尚未启动，${RESIDENT_HINT}；若它正在启动或停止，请稍后重试。`,
    ];
  }
  return [`无法访问 Hikari 桌面正文读取入口：${answer.detail}`];
}
