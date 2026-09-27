// The subscribing half of the delivery endpoint — discovery, the client end of the pipe, and the three
// ways a subscription can end.
//
// This file is the mirror image of `ask.ts`, and the inversion runs all the way down. `ask` connects,
// sends a sentence, waits for exactly one reply and exits; it is a question, and the connection is the
// span of the question. Nothing here sends anything at all: the human connects in order to *receive*,
// the resident never knows who is listening, and the connection lasts until one end decides it does not.
//
// That is why there is no timeout here and why its absence is deliberate rather than unfinished. `ask`
// carries a bound because a question has an answer and waiting past the point where one could arrive is
// a failure worth reporting. A subscription has no such moment: a quiet evening is not a slow answer,
// and a client that timed out on silence would end the human's listener precisely because Hikari had
// nothing to say — which is the ordinary case, since the whole point of this pipe is that most of the
// time nothing comes down it.
//
// The vocabulary is *not* here. The endpoint derivation, the framing and the length bound all come from
// `../human-delivery/index.js`, so the two ends of this pipe cannot disagree about what a delivery is
// without the compiler noticing first. This file is the reason that module's barrel exports a framing at
// all: an ingress client is written by the same owner as its server and could reach a private helper,
// but a subscriber has to speak the wire format, and `encodeDelivery` on one side with a hand-written
// parser on the other is exactly the drift that exporting it prevents.
//
// Three endings, and the first is not a failure:
//
//   ended         the connection closed. The resident stopped, or was restarted, or this client was not
//                 the subscriber that endpoint was serving. Nothing more can be said from here without
//                 guessing, which is why the command that prints this says all three.
//   absent        nothing is serving this endpoint on this data directory: no resident, or a resident
//                 started without `--proactive-ci-delay-ms` and therefore without this transport.
//   unavailable   something went wrong reaching the endpoint, or a frame arrived unreadable.
//
// A subscription ends silently in one ordinary case and it is worth naming: the resident destroys a
// second connection rather than replacing the one it is serving, so a human who forgot a listener in
// another terminal sees this one close immediately with nothing delivered. That is reported as `ended`
// because that is what it is — from this end it is indistinguishable from a shutdown, and inventing a
// distinction the wire does not carry would be this file guessing at another component's policy.

import { connect } from 'node:net';

import {
  DeliveryLineReader,
  MAX_DELIVERY_MESSAGE_LINE,
  decodeDelivery,
  humanDeliveryEndpointPath,
} from '../human-delivery/index.js';

export type SubscribeOutcome =
  | { readonly kind: 'ended' }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unavailable'; readonly detail: string };

/**
 * Connect to a data directory's delivery endpoint and call `onMessage` once per delivered message.
 *
 * Resolves when the subscription ends, and only then — the promise is the lifetime of the connection,
 * not of one exchange. It is not cancellable from here: the way a human stops listening is the way they
 * stop any foreground process, and a second cancellation mechanism would be a second policy about when
 * a listener should stop that nothing has asked for.
 *
 * Each message is handed over whole, as the lines the resident wrote. This function does not join them,
 * filter them, count them or look at what is in them; an empty message is passed through like any other,
 * because deciding that an empty one is not worth showing is a decision about content and this file does
 * not have one.
 */
export function subscribeToHumanDelivery(
  rootDir: string,
  onMessage: (lines: readonly string[]) => void,
): Promise<SubscribeOutcome> {
  const path = humanDeliveryEndpointPath(rootDir);
  if (path === undefined) {
    return Promise.resolve({
      kind: 'unavailable',
      detail: '人类投递入口依赖 Windows 命名管道，本机没有。',
    });
  }

  return new Promise<SubscribeOutcome>((settle) => {
    const socket = connect(path);
    const reader = new DeliveryLineReader(MAX_DELIVERY_MESSAGE_LINE);
    let settled = false;

    // First ending wins, and every path below goes through here. `close` follows `error` on a connection
    // that never connected, so without the guard a refused pipe would be reported as an ordinary end
    // behind whatever the error said.
    const finish = (outcome: SubscribeOutcome): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      settle(outcome);
    };

    socket.setEncoding('utf8');

    socket.on('data', (chunk: string) => {
      if (settled) return;

      // Drained rather than read once, and the difference is a message that goes missing. A socket
      // hands over whatever happened to arrive, so two frames the operating system coalesced into one
      // read arrive as one chunk — `DeliveryLineReader` has the first of them ready and the second
      // still in its buffer. Calling `push` once per chunk would leave that second frame sitting there
      // until the *next* read, which makes this client one message behind for the rest of the
      // connection and loses the last message before the far end stops entirely.
      //
      // The empty-string pushes are what drain the reader: it keeps its own remainder, so a call with
      // nothing new is how you ask it for the next line it is already holding, and `pending` is how it
      // says there is none. Verified by probe before this loop existed: one write carrying two frames
      // produced one message, and the second surfaced only when a later frame arrived.
      let pending = chunk;
      for (;;) {
        const read = reader.push(pending);
        pending = '';
        if (read.kind === 'pending') return;
        if (read.kind === 'overflow') {
          finish({ kind: 'unavailable', detail: '一个投递超过了长度上限。' });
          return;
        }

        const lines = decodeDelivery(read.line);
        if (lines === undefined) {
          // Both ends of this pipe are this repository, so an unreadable frame is not a protocol
          // negotiation that could be retried — it means something else wrote to the pipe name, or a
          // defect. Stopping and saying so is the honest response; skipping the frame would leave a
          // human believing they had seen everything that was said.
          finish({ kind: 'unavailable', detail: '这条投递的格式无法解析。' });
          return;
        }

        onMessage(lines);
      }
    });

    // ENOENT is the one failure that is an answer rather than an error: nothing is listening on this
    // data directory's delivery endpoint. Everything else — a refused connection, a broken pipe — is
    // reported as something that went wrong, for the reason `ask.ts` gives: folding those into "nothing
    // there" would tell a human there is nothing to find while something is there but broken.
    socket.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' || error.code === 'ECONNREFUSED') return finish({ kind: 'absent' });
      finish({ kind: 'unavailable', detail: error.message });
    });

    socket.on('close', () => finish({ kind: 'ended' }));
  });
}
