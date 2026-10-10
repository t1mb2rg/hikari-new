// The listening half of the content read.
//
// What this file owns: the endpoint's existence, the framing of what arrives on it, and its teardown.
// What it does not own: what a request means, which window it is about, or what a read produces. A
// request it can frame is handed to the host through one method, and there is no table and no lookup
// behind that.
//
// It is deliberately not a handle. `unref()` is called on the listener and on every accepted socket so
// that an open endpoint is never a reason for the process to stay alive — the Runtime owns plugin
// lifetime and the Resident owns process lifetime, and an ingress that quietly took either decision
// would make both of them decorations. What it does promise is the converse: that it is gone before
// the plugin that owns it, which is why `plugin.ts` registers `close()` with `context.defer` and lets
// the Runtime's own teardown ordering await it.
//
// ---------------------------------------------------------------------------------------------
// The access boundary, stated where the boundary is
// ---------------------------------------------------------------------------------------------
//
// Read this beside `protocol.ts`, which carries the measurement. In short: this machine's named-pipe
// object has Windows' default descriptor, which grants Everyone and ANONYMOUS LOGON
// `FILE_GENERIC_READ` and no `FILE_WRITE_DATA`. Opening this pipe therefore does not get a foreign
// principal a read; *asking* does, and asking means writing a request line, which the descriptor
// denies. Nothing in this file is what enforces that, and nothing in this file should be read as
// claiming to. What this file does do is refuse to widen it: there is no unauthenticated verb here, no
// "just tell me the current window" convenience, and no reply that precedes a request.
//
// A caller who connects and says nothing gets nothing back and is disconnected after `IDLE_CONNECTION_MS`
// — which is also the shape `test/desktop-content-read.test.mjs` asserts, because it is the one part of
// this boundary that a test in this repository can check for itself.

import { createServer, type Server, type Socket } from 'node:net';

import { ContentReadLineReader, decodeContentReadRequest, encodeContentReadReply } from './protocol.js';
import {
  MAX_CONTENT_READ_REQUEST_LINE,
  type DesktopContentReadReply,
  type DesktopContentReadRequest,
} from './types.js';

/** The one thing this endpoint lets its owner do: answer a request that framed and decoded. */
export interface ContentReadHost {
  /**
   * Answers one decoded request.
   *
   * It may reject, and that is the expected shape of a failure here: reading a window can fail in every
   * way `types.ts` enumerates. The endpoint turns a rejection into a `failed` reply. Note what a
   * rejection is *not*: the five kinds in `types.ts` include `refused` and `unreadable`, and those are
   * answers rather than failures — they are about the window, and they arrive as an `ok` reply carrying
   * a rendering of the kind. A rejection is about this process.
   */
  handle(request: DesktopContentReadRequest): Promise<DesktopContentReadReply>;
}

export interface ContentReadEndpoint {
  readonly path: string;
  /** Idempotent. Resolves once the listener and every accepted connection are gone. */
  close(): Promise<void>;
}

// A client that connects and then says nothing is not an error to report, it is a connection to end.
// Without this, a single local process could hold a connection open for as long as it liked, and the
// plugin's own unload would be the thing left waiting on it.
const IDLE_CONNECTION_MS = 5000;

export async function listenContentReadEndpoint(
  host: ContentReadHost,
  path: string,
): Promise<ContentReadEndpoint> {
  const connections = new Set<Socket>();

  const server: Server = createServer((socket) => {
    connections.add(socket);
    socket.on('close', () => connections.delete(socket));

    socket.unref();
    socket.setEncoding('utf8');
    socket.setTimeout(IDLE_CONNECTION_MS, () => socket.destroy());
    socket.on('error', () => socket.destroy());

    const reader = new ContentReadLineReader(MAX_CONTENT_READ_REQUEST_LINE);
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
      // The bound above is on a client's silence before it asks, and it has now done its job. Leaving it
      // armed would put a five-second ceiling on a read whose walk is bounded by the walker's own
      // timeout, and it would enforce it by destroying the connection — so the human would be told
      // nothing at all rather than told the read was slow.
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
      // Connections first, then the listener. An accepted socket that is only forgotten would still be
      // an open handle, and "closed" would then mean "closed to new requests" — not what this promises.
      //
      // Destroyed, not ended, and the difference is the promise being kept rather than a shortcut. A
      // read that is mid-walk when the plugin unloads is cut off and its client is told the entry point
      // closed without answering, which is what happened. Waiting would make shutdown as long as a UIA
      // walk over a large window, and the plugin's unload would be the thing held open by whoever
      // happened to be asking.
      //
      // The walker's own `dispose()` is what stops the subprocess. This only stops waiting for it.
      for (const socket of connections) socket.destroy();
      connections.clear();
      await new Promise<void>((closed) => server.close(() => closed()));
    },
  };
}

async function serve(host: ContentReadHost, socket: Socket, line: string): Promise<void> {
  const decoded = decodeContentReadRequest(line);

  let reply: DesktopContentReadReply;
  if (decoded.kind === 'refused') {
    reply = { outcome: 'failed', lines: [decoded.reason] };
  } else {
    try {
      reply = await host.handle(decoded.request);
    } catch (error) {
      // The read could not be produced at all — there is no window Hikari can attribute to the human,
      // or the walk failed in a way that is about this process rather than about the window. That is
      // `failed`, and the detail travels with it because the human is the one who can act on it.
      reply = { outcome: 'failed', lines: [describeFailure(error)] };
    }
  }

  // A write that dies mid-reply must not become an unhandled rejection, and the socket may well be long
  // gone by now — the walk is asynchronous and can take seconds, and a client that gave up while it ran
  // has already closed. The human either gets the answer or gets nothing; what they must not get is a
  // process that reports a socket problem it has already decided is not worth reporting.
  socket.on('error', () => socket.destroy());
  socket.end(encodeContentReadReply(reply));
}

function describeFailure(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `桌面正文读取未能完成：${detail}`;
}
