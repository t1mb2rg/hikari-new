// The asking half of the work focus ingress — discovery, and the client end of the pipe.
//
// The vocabulary is *not* here. `declare` / `replace` / `clear` / `status` mean something to the work
// focus plugin, so the plugin owns them and this file imports them: the encoder, the decoder and the
// endpoint derivation all come from `../work-focus/index.js`, which means the two ends of this pipe
// cannot disagree about what a request is without the compiler noticing first.
//
// What this file does own is the three ways asking can fail, and — unlike the control channel's
// client — the wording of one of them has to be different. The Resident's control endpoint
// deliberately outlives its Runtime, so ENOENT there means "no process". The work focus endpoint
// belongs to a plugin and cannot outlive its activation, and a shutdown unloads plugins in reverse
// load order, so work-focus — loaded last — is the first thing to go while the resident is still
// very much alive and still answering on its control channel. ENOENT here therefore covers a second
// case as well: a resident a human can see, in the act of stopping.
//
// That second case is not hypothetical, and the wording below is shaped by it. Measured against the
// production resident at t+287ms into a `hikari stop`, the control channel was reporting
// `Hikari 常驻正在停止。` and `work-focus：Runtime 中没有这个插件的记录` while this client said
// "no resident is running" and offered `hikari resident` as the remedy — which the same product
// refused with `数据目录已被另一个 Hikari 常驻占用` in that same window. So the absent line claims
// only what ENOENT actually proves — nothing is serving this ingress — and the remedy is stated
// conditionally, because the unconditional form is advice this product will not take.

import { connect } from 'node:net';

import {
  MAX_WORK_FOCUS_REPLY_LINE,
  WorkFocusLineReader,
  decodeWorkFocusReply,
  encodeWorkFocusRequest,
  workFocusEndpointPath,
  type WorkFocusOutcome,
  type WorkFocusRequest,
} from '../work-focus/index.js';

import { RESIDENT_HINT } from './options.js';

const REPLY_TIMEOUT_MS = 5000;

export function requestWorkFocus(
  rootDir: string,
  request: WorkFocusRequest,
): Promise<WorkFocusOutcome> {
  const path = workFocusEndpointPath(rootDir);
  if (path === undefined) {
    return Promise.resolve({
      kind: 'unavailable',
      detail: '工作焦点入口依赖 Windows 命名管道，本机没有。',
    });
  }

  return new Promise<WorkFocusOutcome>((settle) => {
    const socket = connect(path);
    const reader = new WorkFocusLineReader(MAX_WORK_FOCUS_REPLY_LINE);
    let settled = false;

    const finish = (outcome: WorkFocusOutcome): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      settle(outcome);
    };

    socket.setEncoding('utf8');
    socket.setTimeout(REPLY_TIMEOUT_MS, () => {
      finish({ kind: 'unavailable', detail: `工作焦点入口在 ${REPLY_TIMEOUT_MS}ms 内没有应答。` });
    });

    socket.on('connect', () => socket.write(encodeWorkFocusRequest(request)));

    socket.on('data', (chunk: string) => {
      const read = reader.push(chunk);
      if (read.kind === 'pending') return;
      if (read.kind === 'overflow') {
        finish({ kind: 'unavailable', detail: '工作焦点入口的应答超过了长度上限。' });
        return;
      }

      const decoded = decodeWorkFocusReply(read.line);
      finish(
        decoded.kind === 'reply'
          ? { kind: 'answered', outcome: decoded.outcome, lines: decoded.lines }
          : { kind: 'unavailable', detail: decoded.reason },
      );
    });

    // ENOENT is the one failure that is an answer rather than an error: nothing is listening on this
    // root directory's work focus endpoint. Everything else — a refused connection, an unreadable
    // reply, a socket that closed mid-question — is reported as something that went wrong, because
    // folding those into "nothing there" would tell a human there is nothing to find while something
    // is there but broken.
    socket.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' || error.code === 'ECONNREFUSED') return finish({ kind: 'absent' });
      finish({ kind: 'unavailable', detail: error.message });
    });

    socket.on('close', () => {
      finish({ kind: 'unavailable', detail: '工作焦点入口关闭了连接，但没有应答。' });
    });
  });
}

/** What a human is told when the work focus ingress could not answer. */
export function focusFailureLines(
  answer: Exclude<WorkFocusOutcome, { readonly kind: 'answered' }>,
): readonly string[] {
  if (answer.kind === 'absent') {
    return [
      '这个数据目录上没有正在提供工作焦点入口的 Hikari 常驻。',
      `若常驻尚未启动，${RESIDENT_HINT}；若它正在启动或停止，请稍后重试。`,
    ];
  }
  return [`无法访问 Hikari 工作焦点入口：${answer.detail}`];
}
