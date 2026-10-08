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
import { gitHubCiService } from '../github-ci/index.js';
import { humanDeliveryService } from '../human-delivery/index.js';
// By path, not through `language/index.js`, and the reason is structural rather than stylistic.
// `language`'s barrel reaches `express.ts`, which reaches this package's barrel for `renderOccurrence`,
// which reaches this file — so a bare `../language/index.js` here would close a runtime import cycle
// through the very contract it is importing. The other three imports above take barrels happily, because
// none of those packages reaches back into this one. `contracts.ts` is a leaf that imports only the
// Runtime and this package's own types, which is what makes it safe to name directly.
import { languageSpeakingService } from '../language/contracts.js';
import type { PluginDefinition } from '../runtime/plugin.js';

import { deliveryFactDraft, failureKey, readDeliveredFailures } from './facts.js';
import { detectNewFailure } from './judgement.js';

export interface RepositoryCiAttentionPluginConfig {
  readonly delayMs: number;
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

  return Object.freeze({ delayMs: candidate });
}

export const repositoryCiAttentionPlugin: PluginDefinition<RepositoryCiAttentionPluginConfig> = {
  id: 'repository-ci-attention',
  version: '1.0.0',
  // Four requirements, and each one is a different question this plugin cannot answer itself: what
  // happened, how to say it, whether anyone is listening, and what it has said before. The composition
  // grants the first by having a repository scope, the next two by loading the two providers, and the
  // last by loading the store — which is the whole of what "authorization" means here
  // (`principles.md` §5: a capability existing is not a permission).
  //
  // Chronicle is required rather than optional, and there is no optional `requires` to reach for. A
  // composition that holds this plugin and no store is one where this plugin cannot do the thing it
  // now exists to do, and `waiting` is the honest state for that — the alternative is a plugin that
  // silently degrades on every activation and never says so. The resident that loads this one already
  // loads the store, and loads it first (`src/cli/resident.ts:226` before `:342`).
  requires: [gitHubCiService, languageSpeakingService, humanDeliveryService, chronicleService],
  provides: [],
  config: { parse: parseConfig },
  setup(context, config) {
    const ci = context.services.get(gitHubCiService);
    const speaking = context.services.get(languageSpeakingService);
    const delivery = context.services.get(humanDeliveryService);
    const chronicle = context.services.get(chronicleService);

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

        const observation = await ci.current();

        // Checked again on the far side of the await. An activation can end while a request is in
        // flight, and an occurrence that arrives afterwards is one this activation must not take on —
        // the work being already underway does not make the result its to speak.
        if (stopped) return;

        const occurrence = detectNewFailure(observation, handledFailures, deliveredFailures);
        if (occurrence === undefined) return;

        // Recorded before the two calls below, and that order is the whole of the delivery-failure
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
        // The outcome was awaited and discarded; it is now read, and the difference is the point of
        // this slice. Reading it does **not** make delivery govern anything here: no branch below
        // re-decides the judgement, reorders anything, or retries. The only question it answers is
        // whether this owner has a fact worth admitting — and the three outcomes still differ in
        // exactly one way, which is whether the next activation will remember this.
        const outcome = await delivery.deliver(speaking.speak(occurrence));

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
      } catch {
        // One cycle failing is one cycle failing, and this boundary is where that stays true. The
        // Runtime does not turn a rejection from an active plugin's background work into a failed
        // state, so nothing else would catch an acquisition failure, a broken transport, or a defect
        // in this file — each would become an unhandled rejection, or a loop that stopped for good.
        // What this cannot do is make the failure observable; v1 has no public surface for it, and
        // that is recorded as a known limit rather than papered over with one.
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
