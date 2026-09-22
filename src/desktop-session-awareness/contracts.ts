import { defineService } from '../runtime/contracts.js';
import type { DesktopSessionAwarenessAssessment } from './types.js';

// Two contracts, one owner, one baseline, and one difference between them.
//
// This layer holds a baseline — the last snapshot an assessment was computed against — and an
// assessment is only a judgement because there is something to judge it against. So the question a
// caller has to answer is not "do I want an assessment?" but "does my asking become the next
// comparison partner?". Those are different questions and they have different answers, which is why
// they are different contracts rather than one contract with a flag.
//
//   current()  the driver's question. The snapshot it reads becomes the baseline, so the next
//              assessment — whoever makes it — is measured from this moment. `desktop-session-
//              awareness-loop` is the caller this exists for.
//
//   peek()     the reader's question. The assessment is computed against the baseline exactly as
//              `current()` would compute it, and the baseline does not move. Nothing about the
//              judgement timeline changes because somebody looked.
//
// They cannot be merged into one method with the policy passed in, and the reason is not taste: a
// caller holding `current()` can consume, and a caller holding `peek()` cannot, and that is a
// property of the capability rather than a rule the caller is asked to keep. A surface whose whole
// job is to be checkable should not also be holding the pen that writes what it checks.
//
// The alternative — one method with a `consume: boolean` — was refused for the same reason: it makes
// every caller a potential writer, and asks a test to prove a negative about a call site rather than
// proving it about what the call site was even given.

export interface DesktopSessionAwarenessService {
  /**
   * Assesses the world now, against the last snapshot this instance consumed, and makes the snapshot
   * it read the comparison partner for the next assessment.
   *
   * **The consumption is this contract's semantics, not a side effect of it.** A successful call
   * advances the baseline: the next `current()`, whoever makes it, compares against the snapshot this
   * one returned. That is what a sequence of judgements is — each one measured from the previous one —
   * and a caller that wants to reason about change over time is asking for exactly that.
   *
   * A caller that wants the assessment without extending that sequence wants {@link
   * DesktopSessionAwarenessPeekService}, which is a separate capability for that reason. Holding this
   * one means holding the ability to move the baseline.
   *
   * A rejection does not advance it — `src/desktop-session-awareness/plugin.ts` assigns only after
   * the world read settles — so a failed acquisition leaves the next comparison intact.
   */
  current(): Promise<DesktopSessionAwarenessAssessment>;
}

export const desktopSessionAwarenessService = defineService<DesktopSessionAwarenessService>(
  'desktop-session-awareness.current',
  1,
);

export interface DesktopSessionAwarenessPeekService {
  /**
   * Assesses the world now, against the baseline this instance holds, **without advancing it**.
   *
   * The assessment is the one `current()` would have produced from the same reading: same world call,
   * same comparison, same baseline. What is missing is the assignment. So a peek is not a cached or
   * remembered answer — it reads the world again and reports what it found — and it is not a step in
   * the judgement timeline either.
   *
   * Two consequences follow, and both are the point rather than a caveat:
   *
   * A peek cannot hide a change from the timeline. A change between the baseline and this reading is
   * reported to the caller *and* remains visible to whoever calls `current()` next, because the
   * snapshot this reading took never became the comparison partner. Under a consumptive read the
   * second half of that sentence is false — the reader takes the change with them and the next
   * judgement reports `stable` about a window it never saw the start of.
   *
   * Repeated peeks are not idempotent in what they return, and are not meant to be: each one acquires
   * a fresh snapshot, so two peeks a second apart are two readings of two different moments, both
   * measured from the same baseline. What stays put is the baseline, which is what makes the two
   * answers comparable to each other and to the timeline.
   *
   * The baseline belongs to the plugin instance and is activation-local, so a peek after a reload
   * compares against nothing and comes back as `baseline` — the same answer `current()` gives on a
   * fresh activation, because it is the same state.
   */
  peek(): Promise<DesktopSessionAwarenessAssessment>;
}

export const desktopSessionAwarenessPeekService =
  defineService<DesktopSessionAwarenessPeekService>('desktop-session-awareness.peek', 1);
