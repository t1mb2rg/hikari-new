// One activation's authorization: the set it holds, and the only thing in Hikari that admits a durable
// fact about it.
//
// This is the whole of the sequenced decision — compute the transition, decide whether it was an
// occurrence, record it, move the set, answer — and it is here rather than inside `plugin.ts` because
// the decision has nothing to do with a pipe. `plugin.ts` wires it to an activation and an endpoint;
// this file never learns that either exists, which is what lets the admission rule be asserted without
// a host, on a machine with no named pipes.
//
// **The order is the opposite of the sibling's, and that is the freeze's ruling rather than a
// preference.** A work focus moves its state first and then tries to record the move, on the reasoning
// that an unrecorded focus is a far smaller failure than a focus that needs a disk write to agree to
// what a human said. Here the write comes first and the set moves only once the record is confirmed:
//
//   > 一条不持久的授权不是授权。
//
// A designation that is forgotten is a convenience lost. An authorization that is forgotten is a
// permission that silently evaporates while the person who granted it believes it is in force — and the
// next activation, reading back an empty history, would answer `status` by telling them they had
// authorized nothing. So a write that cannot be confirmed leaves the set exactly where it was, and the
// human is told the declaration was not adopted.
//
// What this file does *not* do is the other half of that question: it never reads the history. The
// initial set arrives as an argument, loaded once by `plugin.ts` before the endpoint exists, so that a
// session is only ever constructed around a set somebody already managed to read.

import type { ChronicleService } from '../chronicle/index.js';
import { changeableRepositoriesFactDraft } from './facts.js';
import { realDirectoryReader, type DirectoryReader } from './paths.js';
import {
  applyChangeableRepositoriesRequest,
  renderChangeableRepositories,
  sameMembership,
  type ChangeableRepositoriesState,
} from './state.js';
import type { ChangeableRepositoriesReply, ChangeableRepositoriesRequest } from './types.js';

/**
 * What a human is told when their declaration was not adopted because it could not be recorded.
 *
 * One deterministic line, and it is a `failed` answer rather than an `ok` one with a warning appended.
 * That is the whole visible difference the ruling makes: the sibling answers `ok` and adds a line
 * because its change is real, and this one has no change to report, so the reason *is* the answer.
 *
 * It is also the answer for the one branch below that cannot be reached. A word that moved the set
 * without admitting a fact is a disagreement between this file and `facts.ts`, and saying "not
 * recorded, so not adopted" is true of it too — which is worth more than a distinguished sentence
 * describing a state nobody can get into.
 */
const NOT_RECORDED = '记不下这次授权，所以没有采纳它。';

export interface ChangeableRepositoriesSession {
  /** The set as it stands now. Read at call time, never a snapshot of when this was created. */
  current(): ChangeableRepositoriesState;
  /** Answers one request, admitting a durable fact when the request moved the set. */
  answer(request: ChangeableRepositoriesRequest): Promise<ChangeableRepositoriesReply>;
}

export function createChangeableRepositoriesSession(
  chronicle: ChronicleService,
  initial: ChangeableRepositoriesState,
  reader: DirectoryReader = realDirectoryReader,
): ChangeableRepositoriesSession {
  let state: ChangeableRepositoriesState = initial;

  return {
    current: () => state,

    async answer(request: ChangeableRepositoriesRequest): Promise<ChangeableRepositoriesReply> {
      const before = state;
      const transition = applyChangeableRepositoriesRequest(state, request, reader);
      if (transition.kind === 'refused') {
        return { outcome: 'failed', lines: [transition.reason] };
      }

      const next = transition.state;

      // Whether this request is an occurrence is one question, and it is about the domain rather than
      // about the command: did the set actually move? Comparing the two states is what asks it — not
      // object identity, which would call a rebuilt equal set a change, and would call a real change no
      // change at all the day the transitions stopped reusing objects.
      //
      // It is also what keeps `status` and the two no-ops from ever reaching the write: a declaration of
      // something already declared moved nothing, so there is nothing to record and nothing to confirm.
      if (sameMembership(before, next)) return { outcome: 'ok', lines: renderChangeableRepositories(next) };

      const draft = changeableRepositoriesFactDraft(request, next);
      if (draft === undefined) return { outcome: 'failed', lines: [NOT_RECORDED] };

      try {
        await chronicle.append(draft);
      } catch {
        // All of it, and deliberately: every way an append can fail means the same thing here — the
        // record did not get a reliable persistence confirmation. See the header for why the set does
        // not move, and why nothing is retried.
        return { outcome: 'failed', lines: [NOT_RECORDED] };
      }

      state = next;
      // A write answers with the set it left behind, not with a claim about what it did. The human's
      // question after any of the three writes is the same question `status` asks.
      return { outcome: 'ok', lines: renderChangeableRepositories(state) };
    },
  };
}
