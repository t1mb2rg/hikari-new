// The listening half of the desktop session observation.
//
// What this file owns: the endpoint's existence, the framing of what arrives on it, and its teardown.
// What it does not own: what a request means. A request it can frame is handed to the host through one
// method, and there is no table and no lookup behind that.
//
// It is deliberately not a handle. `unref()` is called on the listener and on every accepted socket so
// that an open endpoint is never a reason for the process to stay alive — the Runtime owns plugin
// lifetime and the Resident owns process lifetime, and an ingress that quietly took either decision
// would make both of them decorations. What it does promise is the converse: that it is gone before
// the plugin that owns it, which is why `plugin.ts` registers `close()` with `context.defer` and lets
// the Runtime's own teardown ordering await it.
//
// `handle` is asynchronous for the same reason the relevance endpoint's is, and it changes the same
// two things. A rejection has to be caught here rather than escaping, because a dependency that
// refused is an answer this endpoint gives and not an error it reports; and the idle bound has to be
// lifted once a request has been framed, because the assessment behind the answer reads sources whose
// acquisition is not this endpoint's to bound.

import { createServer, type Server, type Socket } from 'node:net';

import { decodeObserveRequest, encodeObserveReply, ObserveLineReader } from './protocol.js';
import { MAX_OBSERVE_REQUEST_LINE, type DesktopSessionObserveReply, type DesktopSessionObserveRequest } from './types.js';

/** The one thing this endpoint lets its owner do: answer a request that framed and decoded. */
export interface ObserveHost {
  /**
   * Answers one decoded request.
   *
   * It may reject, and that is the expected shape of a failure here: acquiring what the assessment
   * needs can fail. The endpoint turns a rejection into a `failed` reply, which is a different thing
   * from an `unavailable` facet and must stay different — see `types.ts`.
   */
  handle(request: DesktopSessionObserveRequest): Promise<DesktopSessionObserveReply>;
}

export interface ObserveEndpoint {
  readonly path: string;
  /** Idempotent. Resolves once the listener and every accepted connection are gone. */
  close(): Promise<void>;
}

// A client that connects and then says nothing is not an error to report, it is a connection to end.
// Without this, a single local process could hold a connection open for as long as it liked, and the
// plugin's own unload would be the thing left waiting on it.
const IDLE_CONNECTION_MS = 5000;

export async function listenObserveEndpoint(host: ObserveHost, path: string): Promise<ObserveEndpoint> {
  const connections = new Set<Socket>();

  const server: Server = createServer((socket) => {
    connections.add(socket);
    socket.on('close', () => connections.delete(socket));

    socket.unref();
    socket.setEncoding('utf8');
    socket.setTimeout(IDLE_CONNECTION_MS, () => socket.destroy());
    socket.on('error', () => socket.destroy());

    const reader = new ObserveLineReader(MAX_OBSERVE_REQUEST_LINE);
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
      // The bound above is on a client's silence before it asks, and it has now done its job. Leaving
      // it armed would put a five-second ceiling on how long the desktop may take to answer a question
      // that only the dependencies can time — and it would do it by destroying the connection, so the
      // human would be told nothing at all rather than told the observation was slow.
      socket.setTimeout(0);
      void serve(host, socket, read.line);
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
      // Connections first, then the listener. An accepted socket that is only forgotten would still
      // be an open handle, and "closed" would then mean "closed to new requests" — not what this
      // promises.
      //
      // Destroyed, not ended, and the difference is the promise being kept rather than a shortcut.
      // There is no drain here: a question that is mid-assessment when the plugin unloads is cut off
      // and its client is told the entry point closed without answering, which is what happened.
      // Waiting for it would make shutdown as long as a PowerShell launch, and the plugin's unload
      // would be the thing held open by whoever happened to be asking — the opposite of what
      // `unref()` above exists to establish.
      for (const socket of connections) socket.destroy();
      connections.clear();
      await new Promise<void>((closed) => server.close(() => closed()));
    },
  };
}

async function serve(host: ObserveHost, socket: Socket, line: string): Promise<void> {
  const decoded = decodeObserveRequest(line);

  let reply: DesktopSessionObserveReply;
  if (decoded.kind === 'refused') {
    reply = { outcome: 'failed', lines: [decoded.reason] };
  } else {
    try {
      reply = await host.handle(decoded.request);
    } catch (error) {
      // A dependency that rejected means the observation did not happen. Reporting it as an `ok` whose
      // facets read `unavailable` would tell a human that the World reported no source, which is a
      // sentence about an observation that never ran — so it is `failed`, and the detail travels with
      // it because the human is the one who can act on it.
      reply = { outcome: 'failed', lines: [describeFailure(error)] };
    }
  }

  // A write that dies mid-reply must not become an unhandled rejection, and the socket may well be
  // long gone by now — the assessment is asynchronous, and a client that gave up while it ran has
  // already closed. The human either gets the answer or gets nothing; what they must not get is a
  // process that reports a socket problem it has already decided is not worth reporting.
  socket.on('error', () => socket.destroy());
  socket.end(encodeObserveReply(reply));
}

function describeFailure(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `桌面会话观察未能完成：${detail}`;
}
