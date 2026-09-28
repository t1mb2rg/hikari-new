// The second plugin in this repository that speaks without being asked, and the first whose subject is
// the human's own machine rather than a service somewhere else.
//
// What it owns: when Hikari looks at input activity, whether what it saw is a return, and what the
// occurrence is. What it does not own: what input activity is (that is `input-activity`), what the
// human declared they were focused on (that is `work-focus`), how a return is worded (that is
// `language`), or whether a human is there to receive it (that is `human-delivery`). It requires all
// four and provides nothing.
//
// The shape is `repository-ci-attention`'s, deliberately and almost line for line, because the two are
// the same kind of thing: a pure consumer on a cadence with a named consumer and a named transport,
// reaching both through Services so that "who receives this" is answered by the composition rather
// than by whoever happened to subscribe. The differences are the state and the input, and both are
// smaller here. The state is two fields rather than a set, for the reason `judgement.ts` gives at
// length — the duplicate rule falls out of the temporal state instead of being enforced against a
// record. The input is one Service and one raw fact rather than a network observation.
//
// What it reads is `input-activity.current@1` directly and not `desktop-session-awareness`, and the
// reason is that the awareness facet is deliberately weaker than what this needs. Its own contract
// records that the facet is compared for inequality only and is "never as a rewind to correct and never
// as a duration", so
// `changed` is true of a human typing continuously and cannot mean a return; `current()` additionally
// consumes a baseline shared with the awareness loop, and `peek()` compares against a baseline this
// plugin does not own. Consuming the source directly is both the most direct dependency and the only
// one whose vocabulary can express the question.
//
// `provides: []`, and there is nothing to provide. A decider that only ever speaks has no capability
// another module could ask it for; giving it one so that it "looks like it has an output" is the
// cosmetic `provides` the design spec's MUST forbids.

import { inputActivityService } from '../input-activity/index.js';
import { humanDeliveryService } from '../human-delivery/index.js';
// By path, not through `language/index.js`, and for the reason `repository-ci-attention/plugin.ts`
// records: `language`'s barrel reaches `express.ts`, which reaches this package's barrel for
// `renderOccurrence`, which reaches this file — so a bare `../language/index.js` here would close a
// runtime import cycle through the very contract it is importing. `human-delivery` and
// `input-activity` take their barrels happily, because neither reaches back into this one.
import { languageDesktopReturnSpeakingService } from '../language/contracts.js';
import type { PluginDefinition } from '../runtime/plugin.js';
import { workFocusCurrentService } from '../work-focus/index.js';

import { INITIAL_DESKTOP_RETURN_WATCH, formOccurrence, stepReturn } from './judgement.js';

export interface DesktopReturnAttentionPluginConfig {
  readonly delayMs: number;
  readonly afterMs: number;
}

// The largest delay a Node timer can express faithfully. `setTimeout` silently rewrites anything above
// 2^31 - 1 into 1 ms, so a cadence past this bound would be accepted here and then executed as the
// shortest cadence there is — a value the loop cannot deliver is a value the loop must not accept.
// Local to this file, like the awareness loop's and the CI decider's copies: it is the edge of this
// plugin's own scheduling, not a contract of the Runtime and not a rule for plugins in general.
const MAX_TIMER_DELAY_MS = 2_147_483_647;

// The threshold's bound is a different number from the cadence's, and it comes from a different place:
// the silence is compared against a 32-bit counter's difference, so the largest threshold that can be
// at or below *any* silence is the counter's own range. A larger one would be a threshold no silence
// can ever reach, which is a configuration that silently never speaks.
const MAX_SILENCE_MS = 0xffff_ffff;

// Explicit by design, and for the reason both loops give: a default cadence would be this plugin
// deciding how often Hikari looks at the human's machine, and a default threshold would be this plugin
// deciding how long a silence is worth mentioning. Two positive integers, and nothing that could grow
// into a scheduler or a policy.
//
// There is deliberately no cross-field rule here — nothing refuses a cadence larger than the
// threshold, though a cadence that large is a poor configuration. It is poor in one direction only:
// the only quantity compared against the threshold is one `input-activity` certifies from a single
// snapshot, so a coarse cadence can *miss* a return and can never *fabricate* one. Missing is the
// direction this whole slice fails in, so it is a bad setting rather than an unsafe one, and refusing
// it here would be this file having an opinion about how someone should configure their own machine.
function parseConfig(input: unknown): DesktopReturnAttentionPluginConfig {
  const candidate = typeof input === 'object' && input !== null ? input : {};
  const { delayMs, afterMs } = candidate as { readonly delayMs?: unknown; readonly afterMs?: unknown };

  if (
    typeof delayMs !== 'number' ||
    !Number.isInteger(delayMs) ||
    delayMs < 1 ||
    delayMs > MAX_TIMER_DELAY_MS
  ) {
    throw new Error(
      `desktop-return-attention requires an integer delayMs between 1 and ${MAX_TIMER_DELAY_MS}, received ${String(delayMs)}.`,
    );
  }
  if (
    typeof afterMs !== 'number' ||
    !Number.isInteger(afterMs) ||
    afterMs < 1 ||
    afterMs > MAX_SILENCE_MS
  ) {
    throw new Error(
      `desktop-return-attention requires an integer afterMs between 1 and ${MAX_SILENCE_MS}, received ${String(afterMs)}.`,
    );
  }

  return Object.freeze({ delayMs, afterMs });
}

export const desktopReturnAttentionPlugin: PluginDefinition<DesktopReturnAttentionPluginConfig> = {
  id: 'desktop-return-attention',
  version: '1.0.0',
  // Four requirements, and each one is a different question this plugin cannot answer itself: what the
  // machine's input has been doing, what the human said they were focused on, how to say it, and
  // whether anyone is listening. The composition grants the last two by loading `language` and
  // `human-delivery`, and the first two by having loaded `input-activity` and `work-focus` — which is
  // the whole of what "authorization" means here (`principles.md` §5: a capability existing is not a
  // permission). Note what is *not* among them: nothing about the desktop, the world, or the
  // awareness chain, none of which this plugin needs and any of which would make it a reader of
  // something it has no question about.
  requires: [
    inputActivityService,
    workFocusCurrentService,
    languageDesktopReturnSpeakingService,
    humanDeliveryService,
  ],
  provides: [],
  config: { parse: parseConfig },
  setup(context, config) {
    const inputActivity = context.services.get(inputActivityService);
    const focus = context.services.get(workFocusCurrentService);
    const speaking = context.services.get(languageDesktopReturnSpeakingService);
    const delivery = context.services.get(humanDeliveryService);

    // Activation-local, and deliberately nothing beyond this. A deactivation ends the closure and a
    // later reactivation begins from the initial watch, so a restart cannot see a silence that spans
    // it and cannot report a return that happened while Hikari was not running. That is the v0
    // semantics this slice settled on: continuing to compute a silence across a restart would need a
    // durable store, and this plugin must not acquire one. It also loses nothing a human would want —
    // a silence Hikari did not witness is not one it has any evidence about.
    let stopped = false;
    let pendingTimer: ReturnType<typeof setTimeout> | undefined;
    let inFlight: Promise<void> | undefined;
    let watch = INITIAL_DESKTOP_RETURN_WATCH;

    // The only thing that ever arms a cycle, and it arms exactly one. Because a cycle is scheduled from
    // the previous cycle's completion, a slow observation cannot overlap the next one — non-overlap is
    // the shape of the scheduling rather than a guard that enforces it.
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

        const observation = await inputActivity.current();

        // Checked again on the far side of the await. An activation can end while an observation is
        // in flight, and a return that arrives afterwards is one this activation must not take on —
        // the work being already underway does not make the result its to speak.
        if (stopped) return;

        // The state advances here, before anything can fail, and that placement is the whole of the
        // no-retry policy. The judgement has been made; the two calls below are a separate plane with
        // their own answers, and none of their outcomes may roll this back. Recording afterwards would
        // mean a transport that is down turns every cycle into a fresh attempt at the same return —
        // a retry loop nobody wrote — and the ruling is explicit that this slice has no retry.
        const step = stepReturn(observation, watch, config.afterMs);
        watch = step.watch;

        if (step.endedSilenceMs === undefined) return;

        // Read after the return was observed and not before, which is what makes these the
        // designations as of the return. Read *once*, not cached across cycles: a set the human
        // replaced an hour ago is not what they declared they were focused on when they came back.
        const designations = await focus.current();

        if (stopped) return;

        const occurrence = formOccurrence(observation.observedAt, step.endedSilenceMs, designations);
        if (occurrence === undefined) return;

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
        //
        // Note what a failure here costs, because it is not the same as losing a turn: the watch has
        // already advanced, so a return that reached this block is gone rather than retried on the
        // next cycle. That is the intended direction — a return reported late is a return reported
        // about a moment that has passed.
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

    // Scheduled rather than awaited, because activation must not block on a child process. A cadence
    // of zero for the first cycle, so that a resident which starts beside a human who is already away
    // begins observing immediately rather than one cadence from now.
    scheduleCycle(0);
  },
};
