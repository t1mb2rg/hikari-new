// The asking half of the authorization ingress — discovery, and the client end of the pipe.
//
// The vocabulary is *not* here. `declare` / `replace` / `clear` / `status` mean something to the
// authorization plugin, so the plugin owns them and this file imports them: the encoder, the decoder and
// the endpoint derivation all come from `../changeable-repositories/index.js`, which means the two ends
// of this pipe cannot disagree about what a request is without the compiler noticing first.
//
// What this file does own is the three ways asking can fail — and on this surface there is a fourth
// reason for the same bytes, which the wording has to survive. The Resident's control endpoint
// deliberately outlives its Runtime, so ENOENT there means "no process". This endpoint belongs to a
// plugin and cannot outlive its activation, so ENOENT also covers a resident in the act of stopping;
// and unlike its sibling it covers one more case, because this plugin refuses to activate at all when it
// cannot read its own history — an authorization it cannot read is not one it will serve.
//
// So the absent line claims only what ENOENT actually proves — nothing is serving this ingress — and
// nothing about why. Naming a cause would be this client choosing among three situations it cannot tell
// apart, and the one it named would be wrong about two of them.

import { connect } from 'node:net';

import {
  MAX_CHANGEABLE_REPOSITORIES_REPLY_LINE,
  ChangeableRepositoriesLineReader,
  changeableRepositoriesEndpointPath,
  decodeChangeableRepositoriesReply,
  encodeChangeableRepositoriesRequest,
  type ChangeableRepositoriesOutcome,
  type ChangeableRepositoriesRequest,
} from '../changeable-repositories/index.js';

import { RESIDENT_HINT } from './options.js';

const REPLY_TIMEOUT_MS = 5000;

export function requestChangeableRepositories(
  rootDir: string,
  request: ChangeableRepositoriesRequest,
): Promise<ChangeableRepositoriesOutcome> {
  const path = changeableRepositoriesEndpointPath(rootDir);
  if (path === undefined) {
    return Promise.resolve({
      kind: 'unavailable',
      detail: '可改仓库入口依赖 Windows 命名管道，本机没有。',
    });
  }

  return new Promise<ChangeableRepositoriesOutcome>((settle) => {
    const socket = connect(path);
    const reader = new ChangeableRepositoriesLineReader(MAX_CHANGEABLE_REPOSITORIES_REPLY_LINE);
    let settled = false;

    const finish = (outcome: ChangeableRepositoriesOutcome): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      settle(outcome);
    };

    socket.setEncoding('utf8');
    // Longer than the sibling's, because the answer now waits for a durable write that decides whether
    // the declaration is adopted. It is still a bound on the client's patience rather than on the
    // write: exceeding it costs the human their answer, and the record is then the only account of what
    // happened. It never costs a wrong answer.
    socket.setTimeout(REPLY_TIMEOUT_MS, () => {
      finish({ kind: 'unavailable', detail: `可改仓库入口在 ${REPLY_TIMEOUT_MS}ms 内没有应答。` });
    });

    socket.on('connect', () => socket.write(encodeChangeableRepositoriesRequest(request)));

    socket.on('data', (chunk: string) => {
      const read = reader.push(chunk);
      if (read.kind === 'pending') return;
      if (read.kind === 'overflow') {
        finish({ kind: 'unavailable', detail: '可改仓库入口的应答超过了长度上限。' });
        return;
      }

      const decoded = decodeChangeableRepositoriesReply(read.line);
      finish(
        decoded.kind === 'reply'
          ? { kind: 'answered', outcome: decoded.outcome, lines: decoded.lines }
          : { kind: 'unavailable', detail: decoded.reason },
      );
    });

    // ENOENT is the one failure that is an answer rather than an error: nothing is listening on this
    // root directory's authorization endpoint. Everything else — a refused connection, an unreadable
    // reply, a socket that closed mid-question — is reported as something that went wrong, because
    // folding those into "nothing there" would tell a human there is nothing to find while something is
    // there but broken.
    socket.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' || error.code === 'ECONNREFUSED') return finish({ kind: 'absent' });
      finish({ kind: 'unavailable', detail: error.message });
    });

    socket.on('close', () => {
      finish({ kind: 'unavailable', detail: '可改仓库入口关闭了连接，但没有应答。' });
    });
  });
}

/** What a human is told when the authorization ingress could not answer. */
export function changeFailureLines(
  answer: Exclude<ChangeableRepositoriesOutcome, { readonly kind: 'answered' }>,
): readonly string[] {
  if (answer.kind === 'absent') {
    return [
      '这个数据目录上没有正在提供可改仓库入口的 Hikari 常驻。',
      `若常驻尚未启动，${RESIDENT_HINT}；若它正在启动或停止，请稍后重试。`,
    ];
  }
  return [`无法访问 Hikari 可改仓库入口：${answer.detail}`];
}
