// The listening half of the work focus ingress.
//
// What this file owns: the endpoint's existence, the framing of what arrives on it, and its teardown.
// What it does not own: what any request means. A request it can frame is handed to the host through
// one method, and there is no table and no lookup behind that — one method is the whole of what this
// endpoint is for.
//
// It is deliberately not a handle. `unref()` is called on the listener and on every accepted socket
// so that an open endpoint is never a reason for the process to stay alive: the Runtime owns plugin
// lifetime and the Resident owns process lifetime, and an ingress that quietly took either decision
// over would make both of them decorations. What it does have to promise is the converse — that it is
// gone before the plugin that owns it — which is why `plugin.ts` registers `close()` with
// `context.defer` and lets the Runtime's own teardown ordering await it.
//
// This is not the Resident's control endpoint and it is not a generalisation of it. That endpoint's
// two behaviours are the Resident's own semantics and it is closed to everything else; this one
// answers exactly one question about one plugin's state. What the two share is a lifecycle shape that
// has already been proven — including the parts that are easy to get wrong, like closing accepted
// connections before the listener and bounding an idle connection — and a proven shape is worth
// following even when copying it line for line is the honest way to follow it.

import { createServer, type Server, type Socket } from 'node:net';

import {
  decodeWorkFocusRequest,
  encodeWorkFocusReply,
  WorkFocusLineReader,
} from './protocol.js';
import { MAX_WORK_FOCUS_REQUEST_LINE, type WorkFocusReply, type WorkFocusRequest } from './types.js';

/** The one thing this endpoint lets its owner do: answer a request that framed and decoded. */
export interface WorkFocusHost {
  /**
   * Answers one decoded request.
   *
   * Never throws and never rejects. A refusal is an answer rather than an exception, and so is a
   * degraded one — by the time this resolves the host has already decided what the human is told, and
   * this endpoint has no vocabulary of its own to say it in. It is asynchronous because answering may
   * now take as long as a durable write takes; that is the host's business, and this file carries the
   * promise without knowing why.
   */
  handle(request: WorkFocusRequest): Promise<WorkFocusReply>;
}

export interface WorkFocusEndpoint {
  readonly path: string;
  /** Idempotent. Resolves once the listener and every accepted connection are gone. */
  close(): Promise<void>;
}

// A client that connects and then says nothing is not an error to report, it is a connection to end.
// Without this, a single local process could hold a connection open for as long as it liked, and the
// plugin's own unload would be the thing left waiting on it.
//
// It is also the outermost bound on an answer now that one can wait for a durable write. Nothing here
// measures the write — the number is not derived from it and is not a budget anyone tuned — so the
// honest statement is about what exceeding it costs: the connection goes and the human gets no
// answer. It never costs a *wrong* answer, which is the property worth having, since the state change
// has already happened by the time the write starts and nothing below can take it back.
const IDLE_CONNECTION_MS = 5000;

export async function listenWorkFocusEndpoint(
  host: WorkFocusHost,
  path: string,
): Promise<WorkFocusEndpoint> {
  const connections = new Set<Socket>();

  const server: Server = createServer((socket) => {
    connections.add(socket);
    socket.on('close', () => connections.delete(socket));

    socket.unref();
    socket.setEncoding('utf8');
    socket.setTimeout(IDLE_CONNECTION_MS, () => socket.destroy());
    socket.on('error', () => socket.destroy());

    const reader = new WorkFocusLineReader(MAX_WORK_FOCUS_REQUEST_LINE);
    let served = false;

    socket.on('data', (chunk: string) => {
      if (served) return;

      const read = reader.push(chunk);
      if (read.kind === 'pending') return;
      if (read.kind === 'overflow') {
        // Whoever is on the other end is not speaking this protocol, and answering an unbounded
        // stream with a reply would be answering a conversation that is not happening.
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
      // still be an open handle, and "closed" would then mean "closed to new requests" — not what
      // this promises.
      for (const socket of connections) socket.destroy();
      connections.clear();
      await new Promise<void>((closed) => server.close(() => closed()));
    },
  };
}

function serve(host: WorkFocusHost, socket: Socket, line: string): void {
  const decoded = decodeWorkFocusRequest(line);
  if (decoded.kind === 'refused') {
    respond(socket, { outcome: 'failed', lines: [decoded.reason] });
    return;
  }

  // The frame is the last thing this socket handler does with the request. Answering is a promise
  // now, and it is handed off rather than awaited here, because a rejection escaping into a `data`
  // handler would be an unhandled rejection in the process that owns the plugin's state. `answer`
  // cannot reject, so nothing here has to be guarded for one.
  void answer(host, socket, decoded.request);
}

// The host promises it never rejects; this catch is for the day it does. A broken promise ends one
// conversation instead of the process, and it does not become a reply — a reply would be this
// endpoint inventing a failure in the host's voice, and this file owns framing, not meanings.
async function answer(host: WorkFocusHost, socket: Socket, request: WorkFocusRequest): Promise<void> {
  try {
    respond(socket, await host.handle(request));
  } catch {
    socket.destroy();
  }
}

// A reply is worth writing only to a socket that is still there. The idle timeout can take this
// connection while the host is still working, and `end()` on a destroyed socket would report a socket
// problem this endpoint has already decided is not worth reporting.
function respond(socket: Socket, reply: WorkFocusReply): void {
  if (socket.destroyed) return;
  socket.on('error', () => socket.destroy());
  socket.end(encodeWorkFocusReply(reply));
}
