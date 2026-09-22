// The listening half of the language plugin.
//
// What this file owns: the endpoint's existence, the framing of what arrives on it, and its teardown.
// What it does not own: what a question means, or what the answer is. A request it can frame is handed
// to the host through one method, and there is no table and no lookup behind that.
//
// It is deliberately not a handle. `unref()` is called on the listener and on every accepted socket so
// that an open endpoint is never a reason for the process to stay alive — the Runtime owns plugin
// lifetime and the Resident owns process lifetime, and an ingress that quietly took either decision
// would make both of them decorations. What it does promise is the converse: that it is gone before
// the plugin that owns it, which is why `plugin.ts` registers `close()` with `context.defer` and lets
// the Runtime's own teardown ordering await it.
//
// `handle` is asynchronous, and here that is not merely the sibling endpoints' shape but the only one
// that could work: the answer to a question is a model call. Two consequences follow and both are
// handled below — a rejection has to be caught here rather than escaping, because a model that could
// not be reached is an answer this endpoint gives and not an error it reports; and the idle bound has
// to be lifted once a request has been framed, because the model and the desktop are not this
// endpoint's to bound.
//
// It stays a one-shot question and answer. There is no session, no subscription, no second frame on an
// open connection and no state between requests: two questions a second apart are two independent
// readings, and the only thing that could look like a conversation is the activation-local dialogue
// turn the plugin holds and this file never sees.

import { createServer, type Server, type Socket } from 'node:net';

import { decodeLanguageRequest, encodeLanguageReply, LanguageLineReader } from './protocol.js';
import { MAX_LANGUAGE_REQUEST_LINE, type LanguageReply, type LanguageRequest } from './types.js';

/** The one thing this endpoint lets its owner do: answer a request that framed and decoded. */
export interface LanguageHost {
  /**
   * Answers one decoded request.
   *
   * It may reject, and that is the expected shape of a failure here: the model may be unreachable and a
   * contract the answer is grounded in may reject. The endpoint turns a rejection into a `failed`
   * reply, which is a different thing from a `refused` one and must stay different — see `types.ts`.
   */
  handle(request: LanguageRequest): Promise<LanguageReply>;
}

export interface LanguageEndpoint {
  readonly path: string;
  /** Idempotent. Resolves once the listener and every accepted connection are gone. */
  close(): Promise<void>;
}

// A client that connects and then says nothing is not an error to report, it is a connection to end.
// Without this, a single local process could hold a connection open for as long as it liked, and the
// plugin's own unload would be the thing left waiting on it.
const IDLE_CONNECTION_MS = 5000;

export async function listenLanguageEndpoint(host: LanguageHost, path: string): Promise<LanguageEndpoint> {
  const connections = new Set<Socket>();

  const server: Server = createServer((socket) => {
    connections.add(socket);
    socket.on('close', () => connections.delete(socket));

    socket.unref();
    socket.setEncoding('utf8');
    socket.setTimeout(IDLE_CONNECTION_MS, () => socket.destroy());
    socket.on('error', () => socket.destroy());

    const reader = new LanguageLineReader(MAX_LANGUAGE_REQUEST_LINE);
    let served = false;

    socket.on('data', (chunk: string) => {
      if (served) return;

      const read = reader.push(chunk);
      if (read.kind === 'pending') return;
      if (read.kind === 'overflow') {
        // Whoever is on the other end is not speaking this protocol, and answering an unbounded stream
        // with a reply would be answering a conversation that is not happening. A question within
        // `MAX_LANGUAGE_TEXT_LENGTH` always frames — the line bound is generous over it by design — so
        // reaching here means the text was never a question, and the owner's own refusal never gets a
        // chance to say so.
        socket.destroy();
        return;
      }

      served = true;
      // The bound above is on a client's silence before it asks, and it has now done its job. Leaving
      // it armed would put a five-second ceiling on a model call and a desktop read, and it would do it
      // by destroying the connection, so the human would be told nothing at all rather than told the
      // question was slow.
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
      // Destroyed, not ended, and the difference is the promise being kept rather than a shortcut. There
      // is no drain here: a question that is mid-model-call when the plugin unloads is cut off and its
      // client is told the entry point closed without answering, which is what happened. Waiting for it
      // would make shutdown as long as a model's time-to-first-token, and the plugin's unload would be
      // the thing held open by whoever happened to be asking — the opposite of what `unref()` above
      // exists to establish.
      for (const socket of connections) socket.destroy();
      connections.clear();
      await new Promise<void>((closed) => server.close(() => closed()));
    },
  };
}

async function serve(host: LanguageHost, socket: Socket, line: string): Promise<void> {
  const decoded = decodeLanguageRequest(line);

  let reply: LanguageReply;
  if (decoded.kind === 'refused') {
    // A malformed envelope is `failed` and not `refused`, and the distinction is the one `types.ts`
    // draws: this build did not understand the *request*, so it has nothing to refuse about a question —
    // it never got one. Saying `refused` here would tell a human their question was out of scope when
    // what happened is that something spoke this protocol wrong.
    reply = { outcome: 'failed', lines: [decoded.reason] };
  } else {
    try {
      reply = await host.handle(decoded.request);
    } catch (error) {
      // Reaching here means the plugin itself came apart rather than answering — a bug, not a model that
      // is down, since a model that is down is a reply the handler returns. It is reported rather than
      // escaping so that one broken question leaves the endpoint standing for the next one.
      reply = { outcome: 'failed', lines: [describeFailure(error)] };
    }
  }

  // A write that dies mid-reply must not become an unhandled rejection, and the socket may well be long
  // gone by now — the answer is asynchronous and takes as long as a model call, and a client that gave
  // up while it ran has already closed. The human either gets the answer or gets nothing; what they
  // must not get is a process that reports a socket problem it has already decided is not worth
  // reporting.
  socket.on('error', () => socket.destroy());
  socket.end(encodeLanguageReply(reply));
}

function describeFailure(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `语言插件在回答时失败：${detail}`;
}
