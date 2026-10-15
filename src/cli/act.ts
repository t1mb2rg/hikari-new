// The client half of the executor's local endpoint.
//
// A person types an instruction at a terminal, the resident's executor does the work, and this module is
// the wire between them. It is the same shape as `src/cli/change.ts`, for the same reasons, with one
// deliberate difference: the answer can take as long as a real run takes, because it *is* one — the model
// has to read a repository, decide, and act before there is anything to say. The timeout here is
// therefore the run's own budget rather than a round trip's, and it exists to bound a wedged endpoint
// rather than to bound a person's patience.
//
// Two failures are answers, not errors: no endpoint at all, and an endpoint that is not listening. Both
// mean "no resident is here", which is something a person can act on, and both are told apart from the
// rest by the operating system's own words — `ENOENT` for a pipe nobody created, `ECONNREFUSED` for one
// that closed. Every other failure is `unavailable`, because guessing which of them was "really" absence
// would be this file inventing a fact about the resident.

import { connect } from 'node:net';

import {
  decodeRepositoryChangeReply,
  encodeRepositoryChangeRequest,
  MAX_EXECUTOR_REQUEST_LINE,
  RepositoryChangeLineReader,
  repositoryChangeEndpointPath,
} from '../repository-change-executor/index.js';
import { RESIDENT_HINT } from './options.js';

/** How long a client waits for a run to finish before it stops waiting. */
const REPLY_TIMEOUT_MS = 30 * 60 * 1000;

export type RepositoryChangeAnswer =
  | { kind: 'answered'; outcome: 'ok' | 'failed'; lines: readonly string[] }
  | { kind: 'absent' }
  | { kind: 'unavailable'; detail: string };

export function requestRepositoryChange(
  rootDir: string,
  repository: string,
  mandate: string,
): Promise<RepositoryChangeAnswer> {
  const path = repositoryChangeEndpointPath(rootDir);
  if (path === undefined) {
    // The same sentence every sibling client in this CLI prints on a host without named pipes. It is a
    // different answer from `absent` on purpose: `absent` says "this data directory has no resident", and
    // on this platform there is no endpoint to have — the person is told which of the two they are in.
    return Promise.resolve({
      kind: 'unavailable',
      detail: '执行者入口依赖 Windows 命名管道，本机没有。',
    });
  }

  return new Promise<RepositoryChangeAnswer>((resolve) => {
    // Settled once, whatever arrives first: an answer, a refusal, or the clock.
    let settled = false;
    const finish = (answer: RepositoryChangeAnswer): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(answer);
    };

    const socket = connect(path);
    const reader = new RepositoryChangeLineReader(MAX_EXECUTOR_REQUEST_LINE);

    socket.setEncoding('utf8');
    socket.setTimeout(REPLY_TIMEOUT_MS, () => {
      finish({ kind: 'unavailable', detail: '常驻在回答之前就没有下文了。' });
    });

    socket.on('connect', () => {
      socket.write(encodeRepositoryChangeRequest({ repository, mandate }));
    });

    socket.on('data', (chunk: string) => {
      const read = reader.push(chunk);
      if (read.kind === 'pending') return;
      if (read.kind === 'overflow') {
        finish({ kind: 'unavailable', detail: '常驻的应答超过了能读的长度。' });
        return;
      }

      const decoded = decodeRepositoryChangeReply(read.line);
      if (decoded.kind === 'unreadable') {
        finish({ kind: 'unavailable', detail: `常驻的应答读不懂：${decoded.reason}` });
        return;
      }

      finish({ kind: 'answered', outcome: decoded.outcome, lines: decoded.lines });
    });

    socket.on('error', (error: NodeJS.ErrnoException) => {
      const code = error.code;
      if (code === 'ENOENT' || code === 'ECONNREFUSED') {
        finish({ kind: 'absent' });
        return;
      }
      finish({ kind: 'unavailable', detail: error.message });
    });

    // A resident that answers and then closes is an ordinary ending, and it arrives here after `data`.
    socket.on('close', () => {
      finish({ kind: 'unavailable', detail: '常驻在回答之前就把连接关掉了。' });
    });
  });
}

/**
 * What to print when the executor did not do the thing.
 *
 * The resident hint is the same sentence every other absent-endpoint path in this CLI prints — the person
 * reading it has one obvious next move, and the move is the same one.
 */
export function repositoryChangeFailureLines(answer: RepositoryChangeAnswer): readonly string[] {
  if (answer.kind === 'absent') {
    return ['这个数据目录上没有正在运行的 Hikari 常驻，没有任何执行者可以接受这条指令。', RESIDENT_HINT];
  }
  if (answer.kind === 'unavailable') {
    return [`执行者没有回应：${answer.detail}`, RESIDENT_HINT];
  }
  return answer.lines;
}
