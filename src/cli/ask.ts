// The asking half of the language endpoint — discovery, the client end of the pipe, and the three ways
// asking can fail.
//
// The vocabulary is *not* here. The request word, the reply shapes and the endpoint derivation all come
// from `../language/index.js`, so the two ends of this pipe cannot disagree about what an `ask` means
// without the compiler noticing first. This file carries a sentence in and lines out and forms no
// opinion about either; in particular it does not decide whether a question is answerable, does not
// pre-check its length against the plugin's bound, and does not translate an `outcome` word into one of
// its own. Every one of those decisions has an owner on the other side of the pipe, and a second copy
// here would be a second answer to a question that already has one.
//
// Three situations, the same three as the observation client, and for the same reason: this plugin is
// loaded only when an operator configured a model, and a resident either has it or is not running.
//
//   replied       the question was processed. The reply's own `outcome` — `answered`, `refused` or
//                 `failed` — is carried through untouched, because those three are the language
//                 plugin's statement about what happened and this file has no standing to merge,
//                 rename or re-derive any of them.
//   unavailable   something went wrong reaching the endpoint, or it answered unreadably.
//   absent        nothing is serving this endpoint on this data directory.
//
// `absent` really is two facts, and this is the one place they are worth naming together: no resident
// at all, or a resident that was started without both `--model-endpoint` and `--model` and therefore
// never loaded this plugin. Neither is an error and neither is distinguishable from here, which is what
// `askFailureLines` says rather than guessing between them.
//
// Nothing here probes the Resident's control channel. A surface that reached for the Resident's own
// vocabulary to explain a domain plugin's absence would be the first step toward routing domain
// questions through it, and that channel's whole design is two words about the process.

import { connect } from 'node:net';

import {
  MAX_LANGUAGE_REPLY_LINE,
  LanguageLineReader,
  decodeLanguageReply,
  encodeLanguageRequest,
  languageEndpointPath,
  type LanguageOutcome,
} from '../language/index.js';
import { oneLine } from '../terminal-text/index.js';

import { RESIDENT_HINT } from './options.js';

// Longer than either of the two bounds this answer sits on top of, and deliberately so. The model call
// carries its own 15s bound and the desktop read behind a `peek` is the observation client's 30s
// concern; this is the bound on the client's wait for the whole exchange, so a value at or below
// either of them would report "no answer" for a question that was still being answered. A timeout
// here is a claim about how long the human waited, and it should only be made once waiting has
// genuinely stopped being reasonable.
const REPLY_TIMEOUT_MS = 60_000;

export function requestLanguageAsk(rootDir: string, text: string): Promise<LanguageOutcome> {
  const path = languageEndpointPath(rootDir);
  if (path === undefined) {
    return Promise.resolve({
      kind: 'unavailable',
      detail: '语言入口依赖 Windows 命名管道，本机没有。',
    });
  }

  return new Promise<LanguageOutcome>((settle) => {
    const socket = connect(path);
    const reader = new LanguageLineReader(MAX_LANGUAGE_REPLY_LINE);
    let settled = false;

    // First answer wins, and every path below goes through here. `close` follows `error` on a
    // connection that never connected, so without the guard the socket's own teardown would settle
    // the question with "no reply" behind whatever the error said.
    const finish = (outcome: LanguageOutcome): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      settle(outcome);
    };

    socket.setEncoding('utf8');
    socket.setTimeout(REPLY_TIMEOUT_MS, () => {
      finish({ kind: 'unavailable', detail: `语言入口在 ${REPLY_TIMEOUT_MS}ms 内没有应答。` });
    });

    socket.on('connect', () => socket.write(encodeLanguageRequest({ word: 'ask', text })));

    socket.on('data', (chunk: string) => {
      if (settled) return;

      const read = reader.push(chunk);
      if (read.kind === 'pending') return;
      if (read.kind === 'overflow') {
        finish({ kind: 'unavailable', detail: '语言入口的应答超过了长度上限。' });
        return;
      }

      const decoded = decodeLanguageReply(read.line);
      finish(
        decoded.kind === 'reply'
          ? { kind: 'replied', reply: decoded.reply }
          : { kind: 'unavailable', detail: decoded.reason },
      );
    });

    // ENOENT is the one failure that is an answer rather than an error: nothing is listening on this
    // data directory's language endpoint. Everything else — a refused connection, an unreadable reply,
    // a socket that closed mid-question — is reported as something that went wrong, because folding
    // those into "nothing there" would tell a human there is nothing to find while something is there
    // but broken.
    socket.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' || error.code === 'ECONNREFUSED') return finish({ kind: 'absent' });
      finish({ kind: 'unavailable', detail: error.message });
    });

    socket.on('close', () => {
      finish({ kind: 'unavailable', detail: '语言入口关闭了连接，但没有应答。' });
    });
  });
}

/**
 * What a human is told when the language endpoint could not answer.
 *
 * Both conditions are stated rather than the likelier one guessed at, because from this end they are
 * the same observation. The remedy for the second is a different command line, and an operator who is
 * told only to start a resident that is already running would go looking for a problem that is not
 * there.
 */
export function askFailureLines(
  answer: Exclude<LanguageOutcome, { readonly kind: 'replied' }>,
): readonly string[] {
  if (answer.kind === 'absent') {
    return [
      '这个数据目录上没有正在提供语言入口的 Hikari 常驻。',
      `若常驻尚未启动，${RESIDENT_HINT}；若它正在启动或停止，请稍后重试。`,
      '语言入口只在常驻启动时同时给了 --model-endpoint 与 --model 才会加载。',
    ];
  }
  // Escaped at the interpolation, because this is the one line this file prints that it did not write:
  // `detail` is what a socket error or an unreadable reply said, and `decodeLanguageReply` builds some
  // of its reasons out of the values it found on the wire. The other two lines above are this
  // repository's own fixed words and need nothing.
  return [`无法访问 Hikari 语言入口：${oneLine(answer.detail)}`];
}
