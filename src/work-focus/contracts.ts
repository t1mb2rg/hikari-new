// The current explicit work focus, as a contract with the rest of Hikari.
//
// This Service was withheld for one round, and the reason it was withheld is the reason it exists
// now. A contract is created when something actually calls it, and until `repository-ci-relevance`
// there was nothing to call it: `hikari focus` is a *client*, not a consumer — it reaches this plugin
// over the plugin's own endpoint, and a Service published to the whole composition in order to serve
// a client that arrives through a pipe would have been published for nobody.
//
// What it exposes is the designation set, and the whole of it: the text a human declared, byte for
// byte. It cannot declare, replace or clear anything. It carries no ingress, no occurrence history,
// no timestamps, no provenance, no priority and no replacement history — the plugin holds none of
// those, and a contract cannot expose what its owner does not have.

import { defineService } from '../runtime/contracts.js';

export interface WorkFocusCurrentService {
  /**
   * The designations currently held, as the human typed them, in no promised order.
   *
   * Frozen, and returned by reference to the state the plugin is holding rather than to a copy of it,
   * so a consumer cannot reach back into the focus by keeping what it was handed.
   *
   * There is no failure mode here and nothing is acquired, which is the one structural difference
   * from every other Service in this repository. It is `async` anyway so that a consumer awaiting its
   * dependencies does not have to know which of them is the special one.
   */
  current(): Promise<readonly string[]>;
}

export const workFocusCurrentService = defineService<WorkFocusCurrentService>('work-focus.current', 1);
