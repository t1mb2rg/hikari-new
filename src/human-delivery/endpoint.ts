// The writing half of the delivery transport.
//
// What this file owns: the listener's existence, who is connected to it, framing a message onto the
// wire, and teardown. What it does not own: what a message means. It is handed lines and it writes
// them; there is no table, no queue and no lookup behind that, and it never looks inside the array.
//
// It is the mirror image of `language/endpoint.ts`, and the inversion is worth stating. That one is an
// ingress whose client asks and is answered, so it owns a request bound, an idle bound and a one-shot
// rule. This one is an egress whose client connects in order to listen, so it has none of those: the
// client sends nothing, there is nothing to frame on the way in, and the connection is meant to last.
// Whichever of the two a reader has open, the other's concerns are absent on purpose.
//
// The one bound it does own is on a single `write`, and the difference between that and the idle bound
// it deliberately does not have is the whole argument. `language/endpoint.ts` destroys a connection
// that has gone quiet, because its client's only job is to ask and silence means it is not going to.
// A subscriber's job is the opposite — it is *supposed* to sit there for hours saying nothing, and
// `cli/subscribe.ts` says so at length — so an idle bound here would hang up on a healthy human because
// Hikari happened to have nothing to say. What can genuinely fail to finish is one message: a peer that
// has stopped reading lets the pipe fill, and the write callback then never fires. Unbounded, that
// stalls the cadence that produced the message and hangs the shutdown that waits for it; bounded, it is
// one `failed` delivery, which is a value this contract already has.
//
// `unref()` is called on the listener and on the accepted socket, for the reason the language endpoint
// gives: an open endpoint is never a reason for the process to stay alive. The Runtime owns plugin
// lifetime and the Resident owns process lifetime, and a transport that quietly took either decision
// would make both of them decorations. What it does promise is the converse — that it is gone before
// the plugin that owns it — which is why `plugin.ts` registers `close()` with `context.defer`.
//
// A second connection is refused rather than swapped in, and the choice is the smaller of the two. The
// ruling says one client is enough, so "one" is enforced literally: a new client arriving while a
// client is connected is disconnected on the spot, and the connected one is left alone. Replacing would
// mean deciding, on no evidence, that the newer client is the one the human meant — and it would make
// delivery depend on the order two sockets happened to be accepted in. A client that disconnects
// clears the slot, so the ordinary reconnect — close, then open again — works without any of this
// being visible.

import { createServer, type Server, type Socket } from 'node:net';

import { encodeDelivery } from './protocol.js';
import type { DeliveryOutcome } from './types.js';

// How long one delivery may occupy the connection before the client is taken to have stopped reading.
// The number is `IDLE_CONNECTION_MS` from `language/endpoint.ts`, and only the number is borrowed: a
// local pipe hands a chunk to the operating system in microseconds, so nothing that is going to finish
// takes anything like this long, and the value is chosen to be the same order as the sibling bound
// rather than derived from anything here. What it is *not* is a latency budget — a delivery is not
// given five seconds to be read, only to be handed over, and the distinction is why this bound cannot
// fire on a subscriber that is simply idle.
const DELIVERY_WRITE_TIMEOUT_MS = 5000;

export interface DeliveryEndpoint {
  readonly path: string;
  /**
   * Frames one message onto the connected client, or reports that there is none.
   *
   * Never rejects. A transport problem is `failed`, which is an answer this endpoint gives rather than
   * an error it reports — the caller is a decider on a cadence, and a rejection escaping here would be
   * a transport failure climbing into the loop that perception runs on.
   */
  write(lines: readonly string[]): Promise<DeliveryOutcome>;
  /** Idempotent. Resolves once the listener and the connected client are gone. */
  close(): Promise<void>;
}

export async function listenDeliveryEndpoint(path: string): Promise<DeliveryEndpoint> {
  let client: Socket | undefined;

  const server: Server = createServer((socket) => {
    if (client !== undefined) {
      socket.destroy();
      return;
    }

    client = socket;
    socket.unref();
    socket.setEncoding('utf8');
    socket.on('error', () => socket.destroy());

    // Guarded on identity rather than cleared unconditionally, so that a socket closing late cannot
    // evict the client that replaced it. With the refusal above there is nothing to replace, but the
    // guard is what keeps that true if the refusal is ever revisited — the clearing is about *this*
    // socket, and saying so costs one comparison.
    socket.on('close', () => {
      if (client === socket) client = undefined;
    });
  });

  await new Promise<void>((listening, failed) => {
    server.once('error', failed);
    server.listen(path, listening);
  });
  server.unref();

  return {
    path,

    async write(lines) {
      const socket = client;
      // Nobody is connected. This is the ordinary case rather than a fault: a human opens the
      // listener when they want to be told things, and an evening with nobody listening is an evening
      // in which Hikari still noticed what it noticed. The message is not held: there is no queue in
      // this slice, and a buffer that existed only to serve the next client would be one.
      if (socket === undefined) return { outcome: 'unavailable' };

      try {
        await new Promise<void>((flushed, failed) => {
          // The deadline is what makes this promise settle at all when the peer has stopped reading.
          // The pipe fills, the callback below never fires, and without this the await would simply
          // never return — which is not a hung delivery but a hung *transport*: the decider awaiting it
          // never reschedules its next cycle, and a shutdown that waits for the activation to settle
          // waits for a write that will not finish. Destroying the socket is what ends it, and it is
          // also the recovery: the slot clears, so the human's next `hikari subscribe` connects.
          //
          // Unref'd like the socket it guards, because a bound that is only waiting to expire is not a
          // reason for the process to stay alive. It cannot be missed while the write is genuinely
          // pending: an unflushed write is itself a libuv request, which holds the loop open.
          const deadline = setTimeout(() => {
            socket.destroy();
            failed(new Error('delivery write did not reach the operating system in time'));
          }, DELIVERY_WRITE_TIMEOUT_MS);
          deadline.unref();

          // The callback fires once the chunk is handed to the operating system, which is the whole of
          // what `delivered` claims. A socket that died mid-write calls back with an error instead of
          // emitting one, so a transport failure arrives here rather than escaping as an unhandled
          // event on a connection nobody is watching.
          socket.write(encodeDelivery(lines), (error) => {
            clearTimeout(deadline);
            if (error) failed(error);
            else flushed();
          });
        });
        return { outcome: 'delivered' };
      } catch {
        // Deliberately without a reason. What went wrong here is a fact about a socket, and a caller
        // that could read it would be a caller in a position to make decisions about pipes — see
        // `types.ts` for why that is the coupling this contract exists to prevent.
        return { outcome: 'failed' };
      }
    },

    async close() {
      // The client first, then the listener, for the reason the language endpoint gives: an accepted
      // socket that was only forgotten would still be an open handle, and "closed" would then mean
      // "closed to new connections" — not what this promises. Destroyed rather than ended, because
      // there is no drain to wait for: a message mid-write when the plugin unloads is cut off, and the
      // client sees its connection end, which is what happened.
      if (client !== undefined) {
        client.destroy();
        client = undefined;
      }
      await new Promise<void>((closed) => server.close(() => closed()));
    },
  };
}
