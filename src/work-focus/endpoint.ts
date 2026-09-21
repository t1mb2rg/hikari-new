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
  /** Answers one decoded request. Never throws — a refusal is an answer, not an exception. */
  handle(request: WorkFocusRequest): WorkFocusReply;
}

export interface WorkFocusEndpoint {
  readonly path: string;
  /** Idempotent. Resolves once the listener and every accepted connection are gone. */
  close(): Promise<void>;
}

// A client that connects and then says nothing is not an error to report, it is a connection to end.
// Without this, a single local process could hold a connection open for as long as it liked, and the
// plugin's own unload would be the thing left waiting on it.
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
  const reply: WorkFocusReply =
    decoded.kind === 'refused'
      ? { outcome: 'failed', lines: [decoded.reason] }
      : host.handle(decoded.request);

  // A write that dies mid-reply must not become an unhandled rejection. The human either gets the
  // answer or gets nothing; what they must not get is a process that reports a socket problem it has
  // already decided is not worth reporting.
  socket.on('error', () => socket.destroy());
  socket.end(encodeWorkFocusReply(reply));
}
