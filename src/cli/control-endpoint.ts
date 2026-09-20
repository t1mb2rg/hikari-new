// The listening half of the Resident's control surface.
//
// What this file owns: the endpoint's existence, the framing of what arrives on it, and its teardown.
// What it does not own: what any request means. A request it understands is handed to the host —
// the resident — through one of two named behaviours, and there is no third, no table and no lookup,
// because the two behaviours are the whole of what this endpoint is for.
//
// It is deliberately not a handle. `unref()` is called on the listener and on every accepted socket
// so that an open endpoint is never a reason for the process to stay alive: the resident decides how
// long it lives, through its own lease, and a control channel that quietly took that decision over
// would make the lease a decoration. What the endpoint does have to promise is the converse — that
// it is gone before the process is — which is why the resident awaits `close()` during shutdown.

import { createServer, type Server, type Socket } from 'node:net';

import {
  ControlLineReader,
  decodeControlRequest,
  encodeControlReply,
  MAX_CONTROL_REQUEST_LINE,
} from './control.js';

/** The two things the resident lets its own endpoint do. Both are the resident's own semantics. */
export interface ControlHost {
  /** What the Runtime already knows, as lines an operator can read. */
  status(): readonly string[];
  /** The same effect as the first termination signal. */
  stop(): void;
}

export interface ControlEndpoint {
  readonly path: string;
  /** Idempotent. Resolves once the listener and every accepted connection are gone. */
  close(): Promise<void>;
}

// A client that connects and then says nothing is not an error to report, it is a connection to end.
// Without this, a single local process could hold a connection open for as long as it liked, and the
// resident's own shutdown would be the thing left waiting on it.
const IDLE_CONNECTION_MS = 5000;

export async function listenControlEndpoint(host: ControlHost, path: string): Promise<ControlEndpoint> {
  const connections = new Set<Socket>();

  const server: Server = createServer((socket) => {
    connections.add(socket);
    socket.on('close', () => connections.delete(socket));

    socket.unref();
    socket.setEncoding('utf8');
    socket.setTimeout(IDLE_CONNECTION_MS, () => socket.destroy());
    socket.on('error', () => socket.destroy());

    const reader = new ControlLineReader(MAX_CONTROL_REQUEST_LINE);
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

function serve(host: ControlHost, socket: Socket, line: string): void {
  const decoded = decodeControlRequest(line);
  if (decoded.kind === 'refused') {
    socket.end(encodeControlReply({ outcome: 'failed', lines: [decoded.reason] }));
    return;
  }

  if (decoded.request === 'status') {
    socket.end(encodeControlReply({ outcome: 'ok', lines: host.status() }));
    return;
  }

  // Termination is requested once, and it is not conditional on the client staying to hear about it.
  // The reply goes out first and the request is made when that write has either flushed or died —
  // whichever comes first — so a human who asked is never answered with silence *and* no shutdown.
  let asked = false;
  const ask = (): void => {
    if (asked) return;
    asked = true;
    host.stop();
  };

  socket.once('close', ask);
  socket.end(encodeControlReply({ outcome: 'ok', lines: ['已请求 Hikari 常驻停止。'] }), ask);
}
