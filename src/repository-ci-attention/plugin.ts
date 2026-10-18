// The one plugin in this repository that speaks without being asked.
//
// What it owns: when Hikari looks at the CI of the repository an operator named, and whether what it
// found is something it has not already said. What it does not own: what CI is (that is `github-ci`),
// how a failure is worded (that is `language`), whether a human is there to receive it (that is
// `human-delivery`), or what a durable fact is (that is `chronicle`). It requires all four and provides
// nothing.
//
// It is also the first plugin in this repository to read its own durable history back, and that is the
// whole of what it uses Chronicle for. Reading is owner-local: this module, and only this module, knows
// what a `repository-ci-attention.delivered` fact means. The Runtime supplies the store and knows
// nothing about CI; `chronicle` stores the line and knows nothing about CI; the meaning lives here,
// where the concern does.
//
// The shape is `desktop-session-awareness-loop`'s, deliberately and almost line for line, because the
// two are the same kind of thing: a pure consumer on a cadence, holding nothing but the question of
// when to look again. The one difference is what happens at the end of a cycle. That loop publishes an
// occurrence to an Event bus nobody listens to — a broadcast, which is the right shape for a chain
// whose exit is a separate reader plugin. This one does not publish: it has a named consumer and a
// named transport, and it reaches both through Services, so "who receives this" is answered by the
// composition rather than by whoever happened to subscribe. An `emit` here would also put the
// EventBus's `AggregateError` between a transport failure and the perception loop, which is precisely
// the coupling the transport's own contract exists to keep out.
//
// `provides: []`, and there is nothing to provide. A decider that only ever speaks has no capability
// another module could ask it for; giving it one so that it "looks like it has an output" is the
// cosmetic `provides` the design spec's MUST forbids.

import { chronicleService } from '../chronicle/index.js';
import { humanDeliveryService } from '../human-delivery/index.js';
// By path, not through `language/index.js`, and the reason is structural rather than stylistic.
// `language`'s barrel reaches `express.ts`, which reaches this package's barrel for `renderOccurrence`,
// which reaches this file — so a bare `../language/index.js` here would close a runtime import cycle
// through the very contract it is importing. The other imports above take barrels happily, because
// none of those packages reaches back into this one. `contracts.ts` is a leaf that imports only the
// Runtime and this package's own types, which is what makes it safe to name directly.
import { languageDiagnosisSpeakingService, languageSpeakingService } from '../language/contracts.js';
import { repositoryCiAwarenessService } from '../repository-ci-awareness/index.js';
// The same leaf rule as `language/contracts.js` above, and it is load-bearing here for a second reason:
// this package's `types.ts` is imported by that package's `types.ts`, so a barrel import would put the
// cycle on the path rather than merely near it.
import {
  repositoryCiDiagnosisProposalService,
  repositoryCiDiagnosisSupplementService,
} from '../repository-ci-diagnosis-proposal/contracts.js';
import type { RepositoryCiDiagnosisProposal } from '../repository-ci-diagnosis-proposal/types.js';
import type { PluginDefinition } from '../runtime/plugin.js';

import { deliveryFactDraft, failureKey, readDeliveredFailures } from './facts.js';
import { detectNewFailure } from './judgement.js';

export interface RepositoryCiAttentionPluginConfig {
  readonly delayMs: number;
  /**
   * Where a failure worth an operator's attention goes. Handed in by the runner, which owns stderr;
   * absent is silence, which is the right default for a test.
   *
   * It exists because of the two boundaries this file now has that swallow: the one around the
   * supplement and the one around the whole cycle. Both are the correct shape — a cycle must not die —
   * and both used to be invisible, which is how a silent CI chain cost a day of diagnosis once already.
   */
  readonly log?: ((line: string) => void) | undefined;
}

// The largest delay a Node timer can express faithfully. `setTimeout` silently rewrites anything above
// 2^31 - 1 into 1 ms, so a cadence past this bound would be accepted here and then executed as the
// shortest cadence there is — a value the loop cannot deliver is a value the loop must not accept.
// Local to this file, like the awareness loop's copy: it is the edge of this plugin's own scheduling,
// not a contract of the Runtime and not a rule for plugins in general.
const MAX_TIMER_DELAY_MS = 2_147_483_647;

// Explicit by design, and for the reason the awareness loop gives: a default cadence would be this
// plugin deciding how often Hikari looks at a repository. One positive integer, and nothing that could
// grow into a scheduler.
function parseConfig(input: unknown): RepositoryCiAttentionPluginConfig {
  const candidate =
    typeof input === 'object' && input !== null
      ? (input as { readonly delayMs?: unknown }).delayMs
      : undefined;
  const log =
    typeof input === 'object' && input !== null
      ? (input as { readonly log?: unknown }).log
      : undefined;

  if (log !== undefined && typeof log !== 'function') {
    throw new Error('repository-ci-attention requires config.log to be a function when present.');
  }

  if (
    typeof candidate !== 'number' ||
    !Number.isInteger(candidate) ||
    candidate < 1 ||
    candidate > MAX_TIMER_DELAY_MS
  ) {
    throw new Error(
      `repository-ci-attention requires an integer delayMs between 1 and ${MAX_TIMER_DELAY_MS}, received ${String(candidate)}.`,
    );
  }

  return Object.freeze({ delayMs: candidate, log: log as ((line: string) => void) | undefined });
}

export const repositoryCiAttentionPlugin: PluginDefinition<RepositoryCiAttentionPluginConfig> = {
  id: 'repository-ci-attention',
  version: '1.0.0',
  // Seven requirements, and each one is a different question this plugin cannot answer itself: what
  // happened, whether a specific follow-up is worth suggesting, whether there is a sentence to add on
  // top of that suggestion, how to say it, how to say the suggestion, whether anyone is listening, and
  // what it has said before.
  //
  // The first two changed in the milestone-2 slice, and the change is the point of it. It used to
  // require `github-ci` and call `current()` for itself. Now it requires the *world* — one assessment,
  // acquired once per cycle — because the two things this cycle speaks about must come out of one
  // acquirement: the failing run, and the commit the human's working tree reports to compare it
  // against. Two reads would let those describe two different moments, and nothing downstream could
  // tell. The GitHub CI observation it used to fetch is inside that assessment, unchanged and still
  // `github-ci`'s.
  //
  // `repository-ci-diagnosis-proposal` is required rather than optional, and there is no optional
  // `requires` to reach for either. The composition that holds this plugin is one where a red CI run
  // should be told to a human, and asking whether there is something specific worth suggesting is part
  // of telling it now. A composition without that module is one where this plugin falls back to the
  // plain announcement — which is why `languageDiagnosisSpeakingService` is required beside it rather
  // than being reached for only when a suggestion appears: the two speaking contracts are two halves of
  // one decision, and a plugin that could only express one of them would have to decide before asking.
  //
  // `repository-ci-diagnosis-proposal.supplement` is required beside the judgement, and the reason is
  // not symmetry. The supplement is an addition to a message this plugin is about to send, so the only
  // module entitled to append it is the one that owns the send — and the only way to guarantee it
  // cannot stop that send is for it to arrive as a value this plugin appends, rather than as something
  // another activation could fail to produce. A composition without the supplement module is one where
  // this plugin would have to decide whether "no supplement" means "not configured" or "not needed",
  // which is a question it has no material to answer.
  //
  // The composition grants the first by having a repository scope, the middle five by loading the
  // providers, and the last by loading the store — which is the whole of what "authorization" means
  // here (`principles.md` §5: a capability existing is not a permission).
  //
  // Chronicle is required rather than optional, and there is no optional `requires` to reach for. A
  // composition that holds this plugin and no store is one where this plugin cannot do the thing it
  // now exists to do, and `waiting` is the honest state for that — the alternative is a plugin that
  // silently degrades on every activation and never says so. The resident that loads this one already
  // loads the store, and loads it first (`src/cli/resident.ts:226` before `:342`).
  requires: [
    repositoryCiAwarenessService,
    repositoryCiDiagnosisProposalService,
    repositoryCiDiagnosisSupplementService,
    languageSpeakingService,
    languageDiagnosisSpeakingService,
    humanDeliveryService,
    chronicleService,
  ],
  provides: [],
  config: { parse: parseConfig },
  setup(context, config) {
    const awareness = context.services.get(repositoryCiAwarenessService);
    const diagnosis = context.services.get(repositoryCiDiagnosisProposalService);
    const supplement = context.services.get(repositoryCiDiagnosisSupplementService);
    const speaking = context.services.get(languageSpeakingService);
    const suggestionSpeaking = context.services.get(languageDiagnosisSpeakingService);
    const delivery = context.services.get(humanDeliveryService);
    const chronicle = context.services.get(chronicleService);

    function note(line: string): void {
      if (config.log === undefined) return;

      try {
        config.log(line);
      } catch {
        // A logger that throws is a logger, not a decision. Swallowing keeps the guarantee both
        // boundaries in this file are written for: nothing here can stop a notification.
      }
    }

    // Two sets, and the difference between them is the whole of what this slice adds.
    //
    // `handledFailures` is activation-local, and deliberately nothing beyond this. A deactivation ends
    // the closure and a later reactivation begins from an empty set, so no token is needed to tell
    // activations apart. What it stores is what was *handled*, never what was merely *seen* — and, just
    // as deliberately, never a claim about what happened next. Membership records that this activation
    // took a failure on and will not take it on again; it does not record that anyone received
    // anything. See `judgement.ts` for why the see/handle distinction is what makes the
    // in-progress-to-failure transition fall out for free.
    //
    // `deliveredFailures` is the one thing here that crosses an activation, and it is read out of this
    // owner's own Chronicle history rather than held anywhere of its own — the plugin still acquires no
    // store, and `provides` is still empty. Membership is strictly stronger than the set above: an
    // entry means a delivery came back `delivered`, so the failure has already been said out loud and a
    // restart must not say it again. It is never written to at runtime: what this activation delivers
    // is already covered by `handledFailures`, and adding it here as well would be a second record of
    // a fact the next activation will read back from the file anyway.
    let stopped = false;
    let pendingTimer: ReturnType<typeof setTimeout> | undefined;
    let inFlight: Promise<void> | undefined;
    let historyRestored = false;
    const handledFailures = new Set<string>();
    const deliveredFailures = new Set<string>();

    // The only thing that ever arms a cycle, and it arms exactly one. Because a cycle is scheduled from
    // the previous cycle's completion, a poll slower than `delayMs` cannot overlap the next one —
    // non-overlap is the shape of the scheduling rather than a guard that enforces it.
    function scheduleCycle(delayMs: number): void {
      if (stopped) return;
      pendingTimer = setTimeout(() => {
        pendingTimer = undefined;
        inFlight = runCycle();
      }, delayMs);
    }

    async function runCycle(): Promise<void> {
      try {
        if (stopped) return;

        // History is restored once per activation, at the start of the first cycle rather than in
        // `setup`, so that activation still does not block on a disk read for the same reason it does
        // not block on a network call. It is also the seam that keeps the read's failure handling in
        // the cycle's own path, next to everything else that can fail here.
        //
        // Attempted exactly once: the flag is set before the read, so a failed read does not come back
        // next cycle. Retrying would be a retry loop nobody designed, and this slice deliberately has
        // none — see the ruling on delivery, which is stricter still.
        //
        // The degradation is one-sided on purpose. A read that fails leaves the set empty, which means
        // this activation behaves exactly as the plugin did before this slice: it speaks for whatever
        // is red and has not been handled here. **The failure direction is towards speaking, never
        // towards silence**, because a store that is unreadable must not be able to stop Hikari from
        // telling a human something — an outage would become a gag.
        //
        // What that costs is honesty about the past, and it is not papered over: an empty set here is
        // *not* evidence that nothing was ever announced, and nothing in this file treats it as one.
        // See the catch, which says so in the only place that can.
        if (!historyRestored) {
          historyRestored = true;
          try {
            for (const key of readDeliveredFailures(await chronicle.read())) deliveredFailures.add(key);
          } catch {
            // Deliberately silent, and read the block above before changing that. There is no public
            // surface in v1 to report it through, which is the same known limit the outer catch
            // records.
          }
        }

        // One assessment, and the failing run comes out of it. This replaced a call to `github-ci`'s own
        // `current()`, and the difference is the whole of why the cycle now reads the way it does: the
        // commit comparison the suggestion rests on is a fact about *this* snapshot, so the run being
        // announced and the commit it is compared against cannot describe two different moments. The
        // observation itself is unchanged and still `github-ci`'s — it is simply already inside what was
        // acquired.
        const assessment = await awareness.current();

        // Checked again on the far side of the await. An activation can end while a request is in
        // flight, and an occurrence that arrives afterwards is one this activation must not take on —
        // the work being already underway does not make the result its to speak.
        if (stopped) return;

        // A facet that is not there is silence, and it was silence before this slice too: the observation
        // this replaced carried an unavailable run in that case, and `detectNewFailure` answered
        // `undefined` for it. Nothing is announced about a CI nobody could read, and nothing is recorded
        // either — which is what lets the next cycle try again.
        const githubCi = assessment.snapshot.githubCi;
        if (githubCi.kind !== 'available') return;

        const occurrence = detectNewFailure(githubCi.observation, handledFailures, deliveredFailures);
        if (occurrence === undefined) return;

        // The suggestion is asked for before anything is recorded, and it is asked for as an addition
        // rather than as a gate. Two decisions are in these lines and both are deliberate.
        //
        // The order first. `handledFailures.add` sits immediately after the judgement because nothing
        // used to happen between them. There is an await in between now, and an activation that ended
        // during it would have marked a failure handled with nothing having been said — a silent drop, and
        // the one failure direction this file refuses everywhere else. Marking therefore happens after the
        // answer arrives: a cycle that ends here says nothing and remembers nothing, which is the honest
        // pair.
        //
        // The catch second, and it is the same one-sided degradation the history read above is written
        // for: a diagnosis module that is unreachable, misconfigured or broken must not be able to stop
        // Hikari from telling a human that CI is red. What it costs is stated rather than hidden — when
        // this swallows, the announcement below is the plain one, and nothing records that a suggestion
        // was skipped, because there is no surface in v1 to record it through.
        let proposal: RepositoryCiDiagnosisProposal | undefined;
        try {
          proposal = await diagnosis.propose({ occurrence, assessment });
        } catch {
          proposal = undefined;
        }

        if (stopped) return;

        // Recorded before the delivery below, and that order is the whole of the delivery-failure
        // policy. The judgement has been made; delivery is a separate plane with its own answer, and
        // none of its three outcomes may roll this back. Recording afterwards would mean a transport
        // that is down turns every cycle into a fresh attempt, which is a retry loop nobody wrote — and
        // the ruling is explicit that this slice has no retry.
        //
        // What that means for this set is worth stating plainly, because it is what the name has to
        // carry: a key lands here whether the transport said `delivered`, `unavailable` or `failed`, so
        // `handled ≠ delivered ≠ human observed`. The set answers "has this activation already done its
        // work on this failure", and it answers nothing about whether a human saw it. An earlier name
        // said "announced" and quietly claimed the second and third of those on the strength of the
        // first — a claim this plugin is in no position to make.
        handledFailures.add(failureKey(occurrence.repository, occurrence.runId));

        // The lines Language produces are the lines that go on the wire, unchanged. This is the one
        // discipline in the whole path that a type cannot enforce, which is why it is stated here and
        // asserted in the tests: a decider that re-wrote the answer on its way to the transport would
        // be a second expression surface, and the one nobody reviews.
        //
        // Which of the two speaking contracts is used is decided here and nowhere else, and the decision
        // is one comparison: a suggestion exists, or it does not. When it does not, the announcement is
        // the same call it has always been — same owner, same occurrence, same rendering — so "there was
        // nothing specific to suggest" reaches a human as the plain message rather than as a sentence
        // about having nothing to say. The absence is not something this plugin can express, and that is
        // the point of the type it tests rather than a gap in it.
        //
        // The outcome was awaited and discarded; it is now read, and the difference is the point of
        // this slice. Reading it does **not** make delivery govern anything here: no branch below
        // re-decides the judgement, reorders anything, or retries. The only question it answers is
        // whether this owner has a fact worth admitting — and the three outcomes still differ in
        // exactly one way, which is whether the next activation will remember this.
        // The lines Language produces are the lines that go on the wire, unchanged. The supplement is
        // the one thing appended to them, and it is appended here — in the module that owns the send,
        // after the deterministic sentence is already a string — rather than by a writer that could
        // re-order the two or forget which half it was holding.
        //
        // Two boundaries stand between the model and the transport, and they are at different places on
        // purpose. The first is inside the supplement module, which turns every failure it can name into
        // `undefined`. The second is this one, and it exists because the failures nobody named are the
        // ones that would otherwise reach the delivery call: a defect in that module, a rejection out of
        // a material read that was supposed to be caught, a logger that throws. What this boundary is
        // allowed to do is exactly one thing — log, and use the message it already had. It is not
        // allowed to change the count of messages, re-order anything, or turn a supplement failure into
        // a notification that does not happen.
        let lines: readonly string[] =
          proposal === undefined || proposal.kind === 'insufficient-evidence'
            ? speaking.speak(occurrence)
            : suggestionSpeaking.speak(proposal);

        if (proposal !== undefined) {
          try {
            const attached = await supplement.attach({ occurrence, proposal });
            if (attached !== undefined) {
              lines = [...lines, '', ...attached.split('\n')];
            }
          } catch {
            note('模型补充：未预期异常 → 未附加');
          }
        }

        const outcome = await delivery.deliver(lines);

        // Not checked before the append, and deliberately. An activation that ended while the bytes
        // were going out does not make the delivery un-happen, and refusing to record it would lose a
        // true fact about the past in order to keep a tidy boundary. `context.defer` awaits this cycle
        // either way, so the write is still made before the scope finishes disposing.
        if (outcome.outcome !== 'delivered') return;

        // Only the write that can be stood behind. `unavailable` and `failed` return above without
        // reaching this line, which is what makes the existence of a `repository-ci-attention.delivered`
        // fact the same statement as "the bytes were written" — see `facts.ts`.
        try {
          await chronicle.append(deliveryFactDraft(occurrence));
        } catch {
          // Nothing is rolled back, retried, rethrown or claimed. The announcement did go out; what
          // failed is the record of it, and this activation is the last place that knows the
          // difference. The honest consequence is recorded rather than fixed: the next activation
          // reads no fact here and will announce this failure again, because from its point of view
          // nothing was ever said. That is a truth about the store, not a defect to paper over —
          // fixing it would take a retry or a compensation, and this slice has neither.
        }
      } catch (error) {
        // One cycle failing is one cycle failing, and this boundary is where that stays true. The
        // Runtime does not turn a rejection from an active plugin's background work into a failed
        // state, so nothing else would catch an acquisition failure, a broken transport, or a defect
        // in this file — each would become an unhandled rejection, or a loop that stopped for good.
        //
        // It used to be invisible as well as survivable, and the cost of that was measured: a CI chain
        // that went quiet for a day looked exactly like a chain with nothing to say. The line below is
        // the smallest thing that makes the two distinguishable, and it goes to the runner's logger
        // rather than into a fact — a failed cycle is a property of this process, not of the world.
        note(
          `Repository CI attention：本轮失败（${error instanceof Error ? error.message : '未知错误'}）→ 下一轮继续`,
        );
      } finally {
        if (!stopped) scheduleCycle(config.delayMs);
      }
    }

    context.defer(async () => {
      // The order carries the meaning. The flag first, so that a cycle resuming from its await sees
      // it; then the timer, so that nothing further can be armed; then the cycle itself, so that this
      // activation is fully settled before its scope has finished disposing.
      stopped = true;

      if (pendingTimer !== undefined) {
        clearTimeout(pendingTimer);
        pendingTimer = undefined;
      }

      if (inFlight !== undefined) await inFlight;
    });

    // Scheduled rather than awaited, because activation must not block on a network call to GitHub.
    scheduleCycle(0);
  },
};
