// The listening half of the authorization ingress.
//
// What this file owns: the endpoint's existence, the framing of what arrives on it, and its teardown.
// What it does not own: what any request means. A request it can frame is handed to the host through
// one method, and there is no table and no lookup behind that — one method is the whole of what this
// endpoint is for.
//
// It is deliberately not a handle. `unref()` is called on the listener and on every accepted socket so
// that an open endpoint is never a reason for the process to stay alive: the Runtime owns plugin
// lifetime and the Resident owns process lifetime, and an ingress that quietly took either decision
// over would make both of them decorations. What it does have to promise is the converse — that it is
// gone before the plugin that owns it — which is why `plugin.ts` registers `close()` with
// `context.defer` and lets the Runtime's own teardown ordering await it.
//
// This is not the Resident's control endpoint and it is not a generalisation of it. What this file and
// its sibling share is a lifecycle shape that has already been proven — including the parts that are
// easy to get wrong, like closing accepted connections before the listener and bounding an idle
// connection — and a proven shape is worth following even when copying it line for line is the honest
// way to follow it.

import { createServer, type Server, type Socket } from 'node:net';

import {
  ChangeableRepositoriesLineReader,
  decodeChangeableRepositoriesRequest,
  encodeChangeableRepositoriesReply,
} from './protocol.js';
import {
  MAX_CHANGEABLE_REPOSITORIES_REQUEST_LINE,
  type ChangeableRepositoriesReply,
  type ChangeableRepositoriesRequest,
} from './types.js';

/** The one thing this endpoint lets its owner do: answer a request that framed and decoded. */
export interface ChangeableRepositoriesHost {
  /**
   * Answers one decoded request.
   *
   * Never throws and never rejects. A refusal is an answer rather than an exception, and so is a
   * degraded one — by the time this resolves the host has already decided what the human is told, and
   * this endpoint has no vocabulary of its own to say it in. It is asynchronous because answering
   * waits for a durable write: that is the host's business, and this file carries the promise without
   * knowing why.
   */
  handle(request: ChangeableRepositoriesRequest): Promise<ChangeableRepositoriesReply>;
}

export interface ChangeableRepositoriesEndpoint {
  readonly path: string;
  /** Idempotent. Resolves once the listener and every accepted connection are gone. */
  close(): Promise<void>;
}

// A client that connects and then says nothing is not an error to report, it is a connection to end.
// Without this, a single local process could hold a connection open for as long as it liked, and the
// plugin's own unload would be the thing left waiting on it.
//
// It is also the outermost bound on an answer now that one waits for a durable write — and on this
// surface that bound matters more than it does on the sibling's. There the state had already moved by
// the time the write started; here the write is what *decides* whether the declaration is adopted, so
// a connection that goes away mid-write costs the human their answer and leaves the record as the only
// account of what happened. It never costs a wrong answer, which is the property worth having.
const IDLE_CONNECTION_MS = 5000;

export async function listenChangeableRepositoriesEndpoint(
  host: ChangeableRepositoriesHost,
  path: string,
): Promise<ChangeableRepositoriesEndpoint> {
  const connections = new Set<Socket>();

  const server: Server = createServer((socket) => {
    connections.add(socket);
    socket.on('close', () => connections.delete(socket));

    socket.unref();
    socket.setEncoding('utf8');
    socket.setTimeout(IDLE_CONNECTION_MS, () => socket.destroy());
    socket.on('error', () => socket.destroy());

    const reader = new ChangeableRepositoriesLineReader(MAX_CHANGEABLE_REPOSITORIES_REQUEST_LINE);
    let served = false;

    socket.on('data', (chunk: string) => {
      if (served) return;

      const read = reader.push(chunk);
      if (read.kind === 'pending') return;
      if (read.kind === 'overflow') {
        // Whoever is on the other end is not speaking this protocol, and answering an unbounded stream
        // with a reply would be answering a conversation that is not happening.
        socket.destroy();
        return;
      }

      served = true;
      serve(host, socket, read.line);
    });
  });

  await new Promise<void>((listening, failed) => {
    server.once('error', failed);
    server.listen(path, listening);
  });
  server.unref();

  return {
    path,
    async close() {
      // Ended connections first, then the listener. An accepted socket that is only forgotten would
      // still be an open handle, and "closed" would then mean "closed to new requests" — not what this
      // promises.
      for (const socket of connections) socket.destroy();
      connections.clear();
      await new Promise<void>((closed) => server.close(() => closed()));
    },
  };
}

function serve(host: ChangeableRepositoriesHost, socket: Socket, line: string): void {
  const decoded = decodeChangeableRepositoriesRequest(line);
  if (decoded.kind === 'refused') {
    respond(socket, { outcome: 'failed', lines: [decoded.reason] });
    return;
  }

  // The frame is the last thing this socket handler does with the request. Answering is a promise now,
  // and it is handed off rather than awaited here, because a rejection escaping into a `data` handler
  // would be an unhandled rejection in the process that owns the authorization. `answer` cannot reject,
  // so nothing here has to be guarded for one.
  void answer(host, socket, decoded.request);
}

// The host promises it never rejects; this catch is for the day it does. A broken promise ends one
// conversation instead of the process, and it does not become a reply — a reply would be this endpoint
// inventing a failure in the host's voice, and this file owns framing, not meanings.
async function answer(
  host: ChangeableRepositoriesHost,
  socket: Socket,
  request: ChangeableRepositoriesRequest,
): Promise<void> {
  try {
    respond(socket, await host.handle(request));
  } catch {
    socket.destroy();
  }
}

// A reply is worth writing only to a socket that is still there. The idle timeout can take this
// connection while the host is still working, and `end()` on a destroyed socket would report a socket
// problem this endpoint has already decided is not worth reporting.
function respond(socket: Socket, reply: ChangeableRepositoriesReply): void {
  if (socket.destroyed) return;
  socket.on('error', () => socket.destroy());
  socket.end(encodeChangeableRepositoriesReply(reply));
}
