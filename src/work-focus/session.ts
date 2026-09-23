// One activation's work focus: the set it holds, and the only thing in Hikari that admits a durable
// fact about it.
//
// This is the whole of the sequenced decision — compute the transition, decide whether it was an
// occurrence, move the set, record it, answer — and it is here rather than inside `plugin.ts` because
// the decision has nothing to do with a pipe. `plugin.ts` wires it to an activation and an endpoint;
// this file never learns that either exists, which is what lets the admission rule be asserted without
// a host, on a machine with no named pipes.
//
// State and history are not wired to each other in either direction, and both halves are deliberate:
//
//   - The append cannot undo the state change. A failed `append` means this write did not get a
//     reliable persistence confirmation, which is not the same as "nothing was written" — so undoing
//     the change would invent a fact that may already be on disk, retrying would risk a second copy
//     of one that is, and throwing would end the process that owns the state. None of the three is
//     done. The change stands, and the human is told the record is unconfirmed.
//   - The history cannot restore the state. Nothing here reads a fact back, and a new activation still
//     starts from `emptyWorkFocus()` — which is what keeps `chronicle read()` a record of what
//     happened rather than a second place the work focus lives.

import type { ChronicleService } from '../chronicle/index.js';
import { workFocusFactDraft } from './facts.js';
import {
  applyWorkFocusRequest,
  emptyWorkFocus,
  renderWorkFocus,
  sameMembership,
  type WorkFocusState,
} from './state.js';
import type { WorkFocusReply, WorkFocusRequest } from './types.js';

/**
 * What a human is told when their change stands but its record does not have a persistence
 * confirmation.
 *
 * One deterministic line, appended to the same answer every other write gets. The envelope is not
 * widened for it: a new outcome would be a taxonomy with one member in it, and the reply shape a
 * caller has to handle should stay the shape it already handles. What it does carry is the whole
 * distinction — the answer is `ok` because the change is real, and the extra line is there because a
 * caller that cannot tell the two apart would be reading a degraded admission as a healthy one.
 */
const UNCONFIRMED = '（这次变化已生效，但没有取得 Chronicle 的可靠持久化确认，可能没有被记下来。）';

export interface WorkFocusSession {
  /** The set as it stands now. Read at call time, never a snapshot of when this was created. */
  current(): WorkFocusState;
  /** Answers one request, admitting a durable fact when the request moved the set. */
  answer(request: WorkFocusRequest): Promise<WorkFocusReply>;
}

export function createWorkFocusSession(chronicle: ChronicleService): WorkFocusSession {
  let state: WorkFocusState = emptyWorkFocus();

  return {
    current: () => state,

    async answer(request: WorkFocusRequest): Promise<WorkFocusReply> {
      const before = state;
      const transition = applyWorkFocusRequest(state, request);
      if (transition.kind === 'refused') {
        return { outcome: 'failed', lines: [transition.reason] };
      }

      // The state moves first, and on its own terms. Everything below is about *recording* that it
      // moved, and none of it decides whether it did: a request this plugin accepted has been
      // answered, and an unrecorded admission is a far smaller failure than a work focus that needs a
      // disk write to agree to what a human said.
      state = transition.state;
      // A write answers with the set it left behind, not with a claim about what it did. The human's
      // question after any of the three writes is the same question `status` asks.
      const lines = renderWorkFocus(state);

      // Whether this request is an occurrence is one question, and it is about the domain rather than
      // about the command: did the set actually move? Comparing the two states is what asks it — not
      // object identity, which would call a rebuilt equal set a change, and would call a real change
      // no change at all the day the transitions stopped reusing objects.
      const draft = sameMembership(before, state) ? undefined : workFocusFactDraft(request, state);
      if (draft === undefined) return { outcome: 'ok', lines };

      try {
        await chronicle.append(draft);
        return { outcome: 'ok', lines };
      } catch {
        // All of it, and deliberately: every way an append can fail means the same thing here — the
        // write did not get a reliable persistence confirmation. See the header for why nothing is
        // rolled back, retried, rethrown or swallowed.
        return { outcome: 'ok', lines: [...lines, UNCONFIRMED] };
      }
    },
  };
}
