// The asking half of the desktop session observation endpoint — discovery, the client end of the
// pipe, and the three ways asking can fail.
//
// The vocabulary is *not* here. The request word, the reply shapes and the endpoint derivation all
// come from `../desktop-session-observe/index.js`, so the two ends of this pipe cannot disagree about
// what a `status` question means without the compiler noticing first. There is one question and this
// file sends it; it does not take a request as a parameter, because a parameter would be an argument
// surface for questions that do not exist.
//
// Three situations, not the relevance client's four, and the missing one is the point. `unconfigured`
// meant "a resident is running and its composition has no Repository CI capability", which is
// sayable there because that chain is loaded only on request. This plugin is a member of the base
// composition, so a resident either has it or is not running, and there is no third thing for the
// Resident's control channel to tell apart. Nothing here probes control, and nothing here should:
// a surface that reached for the Resident's own vocabulary to explain a domain plugin's absence
// would be the first step toward asking it domain questions.
//
// So the three are:
//
//   answered      the observation ran. `ok` carries the transcription; `failed` carries the reason
//                 the assessment could not be produced, which is not an `unavailable` facet and must
//                 never render as one.
//   unavailable   something went wrong reaching the endpoint, or it answered unreadably.
//   absent        nothing is serving this endpoint on this data directory.
//
// `absent` is not quite one fact either, and it is the same second fact the work focus client faces:
// a resident unloading plugins in reverse load order takes this endpoint down while the process is
// still alive and still answering on its control channel. The order, stated exactly, because getting
// it backwards is easy and this comment had it backwards: this plugin loads *before* `work-focus`, so
// it is unloaded *after* it — `work-focus` first, then this endpoint — and both go before the
// Resident's control channel, which outlives the Runtime entirely. The window is therefore narrower
// than `focus.ts`'s, not wider, but it is the same window.
//
// The wording below consequently claims only what was actually established and states the remedy
// conditionally, which is the shape `focus.ts` arrives at for the same reason and after the same
// measurement.

import { connect } from 'node:net';

import {
  MAX_OBSERVE_REPLY_LINE,
  ObserveLineReader,
  decodeObserveReply,
  encodeObserveRequest,
  observeEndpointPath,
  type DesktopSessionObserveOutcome,
} from '../desktop-session-observe/index.js';

import { RESIDENT_HINT } from './options.js';

// Longer than the work focus's bound and for a reason that is not a preference: this answer is an
// assessment, and the assessment acquires two sources through subprocesses. Five seconds is generous
// for a plugin answering out of its own memory and is not generous for a PowerShell launch. A client
// bound tied to the wrong one of those would report a failure for an observation that was still
// running — which is worse than waiting, because it is a claim about what Hikari sees that no one
// has established.
const REPLY_TIMEOUT_MS = 30_000;

export function requestDesktopSessionObserve(rootDir: string): Promise<DesktopSessionObserveOutcome> {
  const path = observeEndpointPath(rootDir);
  if (path === undefined) {
    return Promise.resolve({
      kind: 'unavailable',
      detail: '桌面会话观察入口依赖 Windows 命名管道，本机没有。',
    });
  }

  return new Promise<DesktopSessionObserveOutcome>((settle) => {
    const socket = connect(path);
    const reader = new ObserveLineReader(MAX_OBSERVE_REPLY_LINE);
    let settled = false;

    // First answer wins, and every path below goes through here. `close` follows `error` on a
    // connection that never connected, so without the guard the socket's own teardown would settle
    // the question with "no reply" behind whatever the error said.
    const finish = (outcome: DesktopSessionObserveOutcome): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      settle(outcome);
    };

    socket.setEncoding('utf8');
    socket.setTimeout(REPLY_TIMEOUT_MS, () => {
      finish({ kind: 'unavailable', detail: `桌面会话观察入口在 ${REPLY_TIMEOUT_MS}ms 内没有应答。` });
    });

    socket.on('connect', () => socket.write(encodeObserveRequest({ word: 'status' })));

    socket.on('data', (chunk: string) => {
      if (settled) return;

      const read = reader.push(chunk);
      if (read.kind === 'pending') return;
      if (read.kind === 'overflow') {
        finish({ kind: 'unavailable', detail: '桌面会话观察入口的应答超过了长度上限。' });
        return;
      }

      const decoded = decodeObserveReply(read.line);
      finish(
        decoded.kind === 'reply'
          ? { kind: 'answered', reply: decoded.reply }
          : { kind: 'unavailable', detail: decoded.reason },
      );
    });

    // ENOENT is the one failure that is an answer rather than an error: nothing is listening on this
    // data directory's observation endpoint. Everything else — a refused connection, an unreadable
    // reply, a socket that closed mid-question — is reported as something that went wrong, because
    // folding those into "nothing there" would tell a human there is nothing to find while something
    // is there but broken.
    socket.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' || error.code === 'ECONNREFUSED') return finish({ kind: 'absent' });
      finish({ kind: 'unavailable', detail: error.message });
    });

    socket.on('close', () => {
      finish({ kind: 'unavailable', detail: '桌面会话观察入口关闭了连接，但没有应答。' });
    });
  });
}

/** What a human is told when the observation endpoint could not answer. */
export function observeFailureLines(
  answer: Exclude<DesktopSessionObserveOutcome, { readonly kind: 'answered' }>,
): readonly string[] {
  if (answer.kind === 'absent') {
    return [
      '这个数据目录上没有正在提供桌面会话观察入口的 Hikari 常驻。',
      `若常驻尚未启动，${RESIDENT_HINT}；若它正在启动或停止，请稍后重试。`,
    ];
  }
  return [`无法访问 Hikari 桌面会话观察入口：${answer.detail}`];
}
