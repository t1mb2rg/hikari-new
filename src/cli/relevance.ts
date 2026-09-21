// The asking half of the Repository CI relevance endpoint — discovery, the client end of the pipe,
// and the one discrimination this command exists to get right.
//
// The vocabulary is *not* here. The judgement, the verdict words and the endpoint derivation all come
// from `../repository-ci-relevance/index.js`, so the two ends of this pipe cannot disagree about what
// a `status` question means without the compiler noticing first. There is one question and this file
// sends it; it does not take a request as a parameter, because a parameter would be an argument
// surface for questions that do not exist.
//
// What this file does own is telling four situations apart, and the middle two are the reason it is
// not a copy of `focus.ts`:
//
//   answered       the judgement ran. `ok` carries a verdict; `failed` carries the reason it could
//                  not be completed, which is not `unknown` and must never render as one.
//   unavailable    something went wrong reaching the endpoint, or it answered unreadably.
//   unconfigured   a resident is running and its composition has no Repository CI capability.
//   absent         no resident is running on this data directory at all.
//
// The last two are the same ENOENT as far as the plugin's own endpoint is concerned — nothing is
// listening on either — so this file tells them apart by asking the *Resident's* control channel,
// which is the one endpoint in this product that deliberately outlives its Runtime. If control
// answers, a resident exists and this composition simply does not have the capability; if control is
// ENOENT too, there is no resident.
//
// That distinction is load-bearing rather than pedantic. `unknown` is a judgement that completed and
// established no equality; "this Hikari was never configured for Repository CI" is a judgement that
// does not exist in this composition at all. Reporting the second as the first would tell a human
// their declared focus was compared against a CI observation, when nothing compared anything.
//
// There is a third situation in the same ENOENT, and it is handled by wording rather than by a fourth
// case: a resident that is stopping unloads plugins in reverse load order, so this endpoint — loaded
// last — is gone while the control channel is still very much alive and still reporting. The message
// below therefore claims only what was actually established, and states the remedy conditionally,
// which is the same shape `focus.ts` arrives at for the same reason.

import { connect } from 'node:net';

import {
  MAX_RELEVANCE_REPLY_LINE,
  RelevanceLineReader,
  decodeRelevanceReply,
  encodeRelevanceRequest,
  relevanceEndpointPath,
  type RelevanceOutcome,
} from '../repository-ci-relevance/index.js';

import { requestControl } from './control.js';
import { RESIDENT_HINT } from './options.js';

// Longer than the work focus's bound and for a reason that is not a preference: this answer is a
// judgement, and the judgement reads a source whose acquisition is a subprocess. Five seconds is
// generous for a plugin answering out of its own memory and is not generous for `gh`. A client bound
// tied to the wrong one of those would report a failure for a judgement that was still running —
// which is worse than waiting, because it is a claim about a verdict that no one has reached.
const REPLY_TIMEOUT_MS = 30_000;

export function requestRelevance(rootDir: string): Promise<RelevanceOutcome> {
  const path = relevanceEndpointPath(rootDir);
  if (path === undefined) {
    return Promise.resolve({
      kind: 'unavailable',
      detail: 'Repository CI relevance 入口依赖 Windows 命名管道，本机没有。',
    });
  }

  return new Promise<RelevanceOutcome>((settle) => {
    const socket = connect(path);
    const reader = new RelevanceLineReader(MAX_RELEVANCE_REPLY_LINE);
    let settled = false;

    // First answer wins, and every path below goes through here. `close` follows `error` on a
    // connection that never connected, so without the guard the socket's own teardown would settle
    // the question with "no reply" behind whatever the error said.
    const finish = (outcome: RelevanceOutcome): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      settle(outcome);
    };

    socket.setEncoding('utf8');
    socket.setTimeout(REPLY_TIMEOUT_MS, () => {
      finish({ kind: 'unavailable', detail: `Repository CI relevance 入口在 ${REPLY_TIMEOUT_MS}ms 内没有应答。` });
    });

    socket.on('connect', () => socket.write(encodeRelevanceRequest({ word: 'status' })));

    socket.on('data', (chunk: string) => {
      if (settled) return;

      const read = reader.push(chunk);
      if (read.kind === 'pending') return;
      if (read.kind === 'overflow') {
        finish({ kind: 'unavailable', detail: 'Repository CI relevance 入口的应答超过了长度上限。' });
        return;
      }

      const decoded = decodeRelevanceReply(read.line);
      finish(
        decoded.kind === 'reply'
          ? { kind: 'answered', reply: decoded.reply }
          : { kind: 'unavailable', detail: decoded.reason },
      );
    });

    socket.on('error', (error: NodeJS.ErrnoException) => {
      // ENOENT (and a refused connection, which is the same claim made by a host that got further)
      // means nothing is listening on this plugin's endpoint. That is an answer rather than an error,
      // but it is not yet the whole answer: it is equally true of a resident without the capability
      // and of no resident at all, and only the control channel can say which. Everything else is
      // reported as something that went wrong, because folding it into "nothing there" would tell a
      // human there is nothing to find while something is there but broken.
      if (error.code === 'ENOENT' || error.code === 'ECONNREFUSED') {
        if (settled) return;
        // Settled here rather than by the probe's own result, because the socket's `close` arrives
        // while the probe is still running and would otherwise answer first with "no reply" — which
        // is true and is not the answer to the question that was asked.
        settled = true;
        socket.destroy();
        void reclassify(rootDir).then(settle, () =>
          settle({ kind: 'unavailable', detail: error.message }),
        );
        return;
      }
      finish({ kind: 'unavailable', detail: error.message });
    });

    socket.on('close', () => {
      finish({ kind: 'unavailable', detail: 'Repository CI relevance 入口关闭了连接，但没有应答。' });
    });
  });
}

// The Resident's control channel is the discriminator, and it is the only one. It outlives the
// Runtime of the resident that owns it, so its ENOENT means "no process" in the strict sense the
// plugin endpoint cannot offer — and anything other than its ENOENT means a control endpoint was
// there to answer, which is a resident.
//
// `unavailable` from the probe counts as a resident rather than as an unknown: every way it can
// happen — a timeout, an unreadable reply, a connection closed without one — requires something to
// have been listening in the first place. The one case that is not obvious, a host without pipes, is
// already impossible here: this function is only reached after a pipe path was successfully derived
// for the same data directory.
async function reclassify(rootDir: string): Promise<RelevanceOutcome> {
  const control = await requestControl(rootDir, 'status');
  return control.kind === 'absent' ? { kind: 'absent' } : { kind: 'unconfigured' };
}

/** What a human is told when the relevance endpoint could not answer. */
export function relevanceFailureLines(
  answer: Exclude<RelevanceOutcome, { readonly kind: 'answered' }>,
): readonly string[] {
  if (answer.kind === 'absent') {
    return ['没有正在运行的 Hikari 常驻。', RESIDENT_HINT];
  }
  if (answer.kind === 'unconfigured') {
    return [
      '当前 Hikari 常驻未配置 Repository CI capability：它启动时没有给出 --repository-root 与 --repository。',
      '这不是 unknown。unknown 表示判定完成但没有建立相关性；这里根本不存在这个判定。',
      '若该常驻确实配置了 Repository CI，则它可能正在启动或停止，请稍后重试。',
    ];
  }
  return [`无法访问 Hikari Repository CI relevance 入口：${answer.detail}`];
}
