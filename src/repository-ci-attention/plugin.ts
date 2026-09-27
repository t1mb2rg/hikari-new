// The one plugin in this repository that speaks without being asked.
//
// What it owns: when Hikari looks at the CI of the repository an operator named, and whether what it
// found is something it has not already said. What it does not own: what CI is (that is `github-ci`),
// how a failure is worded (that is `language`), or whether a human is there to receive it (that is
// `human-delivery`). It requires all three and provides nothing.
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

import { gitHubCiService } from '../github-ci/index.js';
import { humanDeliveryService } from '../human-delivery/index.js';
// By path, not through `language/index.js`, and the reason is structural rather than stylistic.
// `language`'s barrel reaches `express.ts`, which reaches this package's barrel for `renderOccurrence`,
// which reaches this file — so a bare `../language/index.js` here would close a runtime import cycle
// through the very contract it is importing. The other two imports above take barrels happily, because
// neither package reaches back into this one. `contracts.ts` is a leaf that imports only the Runtime and
// this package's own types, which is what makes it safe to name directly.
import { languageSpeakingService } from '../language/contracts.js';
import type { PluginDefinition } from '../runtime/plugin.js';

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
  // Three requirements, and each one is a different question this plugin cannot answer itself: what
  // happened, how to say it, and whether anyone is listening. The composition grants the first by
  // having a repository scope, and the other two by loading the two providers — which is the whole of
  // what "authorization" means here (`principles.md` §5: a capability existing is not a permission).
  requires: [gitHubCiService, languageSpeakingService, humanDeliveryService],
  provides: [],
  config: { parse: parseConfig },
  setup(context, config) {
    const ci = context.services.get(gitHubCiService);
    const speaking = context.services.get(languageSpeakingService);
    const delivery = context.services.get(humanDeliveryService);

    // Activation-local, and deliberately nothing beyond this. A deactivation ends the closure and a
    // later reactivation begins from an empty set, so no token is needed to tell activations apart and
    // a restart re-announces whatever is currently red. That is the v0 semantics the Repository CI
    // Attention review settled on; cross-runtime memory would need a durable store and this plugin
    // must not acquire one.
    //
    // What is stored is what was *said*, never what was *seen*. See `judgement.ts` for why that
    // distinction is what makes the in-progress-to-failure transition fall out for free.
    let stopped = false;
    let pendingTimer: ReturnType<typeof setTimeout> | undefined;
    let inFlight: Promise<void> | undefined;
    const announced = new Set<number>();

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

        const observation = await ci.current();

        // Checked again on the far side of the await. An activation can end while a request is in
        // flight, and an occurrence that arrives afterwards is one this activation must not announce —
        // the work being already underway does not make the result its to speak.
        if (stopped) return;

        const occurrence = detectNewFailure(observation, announced);
        if (occurrence === undefined) return;

        // Recorded before the two calls below, and that order is the whole of the delivery-failure
        // policy. The judgement has been made; delivery is a separate plane with its own answer, and
        // none of its three outcomes may roll this back. Recording afterwards would mean a transport
        // that is down turns every cycle into a fresh announcement, which is a retry loop nobody
        // wrote — and the ruling is explicit that this slice has no retry.
        //
        // It is also why the outcome is awaited and then discarded rather than branched on. There is
        // nothing this plugin could do differently for `unavailable` than for `failed`, and inventing
        // a difference here would be this file deciding a transport question it does not own.
        announced.add(occurrence.runId);

        // The lines Language produces are the lines that go on the wire, unchanged. This is the one
        // discipline in the whole path that a type cannot enforce, which is why it is stated here and
        // asserted in the tests: a decider that re-wrote the answer on its way to the transport would
        // be a second expression surface, and the one nobody reviews.
        await delivery.deliver(speaking.speak(occurrence));
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
