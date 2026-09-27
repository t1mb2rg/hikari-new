// The wire and contract vocabulary of the delivery transport, owned by the module that carries it.
//
// There are three outcomes and there is deliberately no fourth. What they are *not* is a
// success/failure pair with a detail string hung off the failure arm, and that absence is the design
// rather than a shortage of effort. This transport does not own a failure taxonomy: an operating
// system error code, a socket state, or a reason a client went away are all facts about a mechanism
// that nobody outside this module could act on differently. A caller that received them would either
// ignore them — in which case they were noise — or start making decisions about pipes, which is the
// coupling the whole contract exists to prevent.
//
// What a caller genuinely has to tell apart is three different situations with three different
// meanings, and they are the three below. Two of them look alike from a distance and must not be
// merged: `unavailable` is Hikari saying nobody was there to tell, and `failed` is Hikari saying
// somebody was there and the telling did not work. Neither one is a judgement about whether the thing
// being said mattered — this module does not know what it is carrying, and the lines it is handed are
// opaque to it.

/**
 * What happened when a message was handed to the transport.
 *
 * `delivered` is the smallest claim that can be made honestly: **the bytes were written**. It is not
 * "the human received it", not "the human read it", and not "the human was at their desk". The
 * transport has one client and one socket, and it can see the far side of neither.
 */
export type DeliveryOutcome =
  | { readonly outcome: 'delivered' }
  | { readonly outcome: 'unavailable' }
  | { readonly outcome: 'failed' };

/**
 * The framing bound, on decoded text rather than wire bytes.
 *
 * A delivered message is one JSON array of lines on one line, so a line may escape to six bytes per
 * character; the bound here is generous over anything a renderer in this repository produces. It is
 * not a statement about what may be said — the owner of the words decides that — it is what keeps
 * whoever is on the far end of the pipe from choosing how much this process buffers. The reader that
 * enforces it lives in `protocol.ts`, and the client enforces the same bound from the same constant
 * rather than picking its own.
 */
export const MAX_DELIVERY_MESSAGE_LINE = 64 * 1024;
