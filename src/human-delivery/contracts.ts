// The capability this module offers, and the whole of what it says about itself.
//
// The argument is `readonly string[]` and the return is a three-valued outcome, and both halves of that
// shape are load-bearing.
//
// The argument is lines rather than a domain value on purpose. A transport that took an occurrence — or
// an assessment, or a judgement — would have to know what one was in order to carry it, and the moment
// it knew, it would be entitled to have an opinion about it: to suppress a duplicate, to reorder by
// importance, to decide that this one need not be delivered at midnight. Every one of those is a
// judgement that already has an owner, and the transport is the last place in the path where a second
// one may be formed. Handing it opaque strings makes "this module does not understand what it carries"
// a property of the type rather than a promise in a comment.
//
// The return is an outcome rather than nothing, because a caller that cannot tell "nobody was there"
// from "it went out" cannot report either one to the human who configured it. What the outcome must
// *not* be used for is retrying: this contract has no queue and no retry, and a caller that treated
// `failed` as a reason to call again would be building the delivery guarantee this slice explicitly
// does not have.

import type { ServiceContract } from '../runtime/contracts.js';
import { defineService } from '../runtime/contracts.js';

import type { DeliveryOutcome } from './types.js';

/**
 * Delivery to a human, over a local connection the human opened.
 *
 * One client at a time, and the connection is the human's act rather than Hikari's: nothing here
 * dials out, nothing reconnects on the human's behalf, and a client that never connects is not an
 * error. The Service exists either way — its provider is `active` with nobody connected, which is what
 * keeps a transport's availability from being able to decide whether a Runtime composition is ready.
 */
export interface HumanDeliveryService {
  /**
   * Hands one message to whoever is connected.
   *
   * Resolves with what happened on the wire. It does not queue: a message handed over while nobody is
   * connected is `unavailable` and is gone, and the same message is not remembered for a client that
   * arrives later. It does not throw for a transport problem — a broken pipe is `failed`, which is an
   * answer this Service gives rather than an error it reports, and the caller that gets it is expected
   * to carry on rather than to retry.
   */
  deliver(lines: readonly string[]): Promise<DeliveryOutcome>;
}

export const humanDeliveryService: ServiceContract<HumanDeliveryService> = defineService<HumanDeliveryService>(
  'human-delivery.deliver',
  1,
);
