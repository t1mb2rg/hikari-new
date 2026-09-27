// The public entry point of the delivery transport.
//
// Three audiences, and the third one is what makes this module different from every other domain
// package here. The composition imports the plugin; a test imports the endpoint and the vocabulary, so
// that the transport can be exercised without a resident; and `src/cli/subscribe.ts` — a client —
// imports the endpoint derivation and the framing, because both ends of this pipe are the owner's own
// statement of what the pipe means rather than two copies of it.
//
// That third audience is the shape of an egress, and it is why this barrel exports things its siblings
// keep. Every other domain in this repository is read by a human who asks it something, and its client
// lives beside it as a command that reaches the endpoint by name. Here the human connects in order to
// receive, which means the client has to speak the framing this module invented — so the framing is
// exported rather than duplicated, and `src/cli/subscribe.ts` holds no protocol of its own.
//
// There is no request vocabulary to export, and its absence is deliberate rather than unfinished: the
// client sends nothing. A reader looking for the counterpart to `decodeLanguageRequest` should find
// nothing, and the reason there is nothing is that a subscriber that had to ask would not be receiving
// unsolicited messages, which is the only kind this transport carries.

export { humanDeliveryService } from './contracts.js';
export type { HumanDeliveryService } from './contracts.js';
export { listenDeliveryEndpoint } from './endpoint.js';
export type { DeliveryEndpoint } from './endpoint.js';
export { humanDeliveryEndpointPath } from './endpoint-path.js';
export { HumanDeliveryError } from './errors.js';
export { humanDeliveryPlugin } from './plugin.js';
export type { HumanDeliveryPluginConfig } from './plugin.js';
export { DeliveryLineReader, decodeDelivery, encodeDelivery } from './protocol.js';
export type { DeliveryLineRead } from './protocol.js';
export { MAX_DELIVERY_MESSAGE_LINE } from './types.js';
export type { DeliveryOutcome } from './types.js';
