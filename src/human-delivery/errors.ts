/**
 * Everything this plugin refuses at its own boundary, and nothing it learns while running.
 *
 * A `HumanDeliveryError` says the transport was handed something it will not start with — a config it
 * cannot use, or a host with no pipe namespace. It is never a delivery that went wrong. A client that
 * disconnected, a write that failed, a message handed over while nobody was connected: all three are
 * outcomes this Service *returns*, and the whole point of `DeliveryOutcome` is that they reach the
 * caller as answers rather than as errors.
 *
 * The distinction matters more here than in an ingress plugin, and it runs the other way. An error
 * thrown from here reaches the Runtime, which fails the plugin — and because a decider requires this
 * Service, a failed transport takes the decider's `waiting` state with it. That is the right outcome
 * for a host that cannot deliver at all, because starting anyway would be a resident that silently
 * never tells anyone anything. It is emphatically not the right outcome for a client that went away,
 * which is an ordinary evening.
 */
export class HumanDeliveryError extends Error {}
