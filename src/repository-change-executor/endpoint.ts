// The listening half of the executor's ingress.
//
// What this file owns: the endpoint's existence, the framing of what arrives on it, and its teardown.
// What it does not own: what any request means. A request it can frame is handed to the host through one
// method, and there is no table and no lookup behind that — one method is the whole of what this endpoint
// is for. It is also not the place that decides whether a run may happen: by the time `handle` is called
// the request has only been read, and the declaration set has not been consulted.
//
// Same lifecycle shape as `changeable-repositories/endpoint.ts`, and one number differs on purpose. There
// the idle timeout is five seconds, because answering a `declare` is a durable write and nothing more.
// Here answering means running a bounded model loop against a real working directory, which is minutes:
// a five-second timeout would take the human's connection away while their own instruction was still
// being carried out, and the person would be told the resident could not be reached by a resident that is
// working on exactly what they asked for. The socket and the listener are still `unref()`ed — an open
// endpoint is never a reason for the process to stay alive.

import { createServer, type Server, type Socket } from 'node:net';

import {
  MAX_EXECUTOR_REQUEST_LINE,
  RepositoryChangeLineReader,
  decodeRepositoryChangeRequest,
  encodeRepositoryChangeReply,
  type RepositoryChangeWireReply,
} from './protocol.js';

/** The one thing this endpoint lets its owner do: answer a request that framed and decoded. */
export interface RepositoryChangeHost {
  /**
   * Answers one decoded request.
   *
   * Never throws and never rejects. A refusal is an answer rather than an exception, and so is a degraded
   * one — by the time this resolves the host has already decided what the human is told. It is
   * asynchronous because answering waits for a bounded run in a real working directory, and this file
   * carries the promise without knowing what is behind it.
   */
  handle(request: { readonly repository: string; readonly mandate: string }): Promise<RepositoryChangeWireReply>;
}

export interface RepositoryChangeEndpoint {
  readonly path: string;
  /** Idempotent. Resolves once the listener and every accepted connection are gone. */
  close(): Promise<void>;
}

// How long a connection may sit with nothing happening on it. See the file head for why this is minutes
// rather than the sibling endpoint's seconds.
const IDLE_CONNECTION_MS = 30 * 60 * 1000;

export async function listenRepositoryChangeEndpoint(
  host: RepositoryChangeHost,
  path: string,
): Promise<RepositoryChangeEndpoint> {
  const connections = new Set<Socket>();

  const server: Server = createServer((socket) => {
    connections.add(socket);
    socket.on('close', () => connections.delete(socket));

    socket.unref();
    socket.setEncoding('utf8');
    socket.setTimeout(IDLE_CONNECTION_MS, () => socket.destroy());
    socket.on('error', () => socket.destroy());

    const reader = new RepositoryChangeLineReader(MAX_EXECUTOR_REQUEST_LINE);
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
      // Ended connections first, then the listener. An accepted socket that is only forgotten would still
      // be an open handle, and "closed" would then mean "closed to new requests".
      for (const socket of connections) socket.destroy();
      connections.clear();
      await new Promise<void>((closed) => server.close(() => closed()));
    },
  };
}

function serve(host: RepositoryChangeHost, socket: Socket, line: string): void {
  const decoded = decodeRepositoryChangeRequest(line);
  if (decoded.kind === 'refused') {
    respond(socket, { outcome: 'failed', lines: [decoded.reason] });
    return;
  }

  // The frame is the last thing this socket handler does with the request. Answering is a promise, and it
  // is handed off rather than awaited here, because a rejection escaping into a `data` handler would be an
  // unhandled rejection in the process that owns the working directory. `answer` cannot reject.
  void answer(host, socket, decoded.request);
}

// The host promises it never rejects; this catch is for the day it does. A broken promise ends one
// conversation instead of the process, and it does not become a reply — a reply would be this endpoint
// inventing a failure in the host's voice, and this file owns framing, not meanings.
async function answer(
  host: RepositoryChangeHost,
  socket: Socket,
  request: { readonly repository: string; readonly mandate: string },
): Promise<void> {
  try {
    respond(socket, await host.handle(request));
  } catch {
    socket.destroy();
  }
}

function respond(socket: Socket, reply: RepositoryChangeWireReply): void {
  if (socket.destroyed) return;
  socket.on('error', () => socket.destroy());
  socket.end(encodeRepositoryChangeReply(reply));
}
