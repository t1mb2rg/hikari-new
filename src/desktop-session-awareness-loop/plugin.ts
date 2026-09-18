import type { PluginDefinition } from '../runtime/plugin.js';
import { desktopSessionAwarenessService } from '../desktop-session-awareness/index.js';
import { desktopSessionAwarenessAssessedEvent } from './contracts.js';

export interface DesktopSessionAwarenessLoopConfig {
  readonly delayMs: number;
}

// Explicit by design. A default cadence would be this plugin deciding how often Hikari looks at the
// desktop, and that is a mandate rather than an implementation detail. There is no cron, no RRULE,
// no jitter, no backoff: one positive integer, and nothing that could grow into a scheduler.
function parseConfig(input: unknown): DesktopSessionAwarenessLoopConfig {
  const candidate =
    typeof input === 'object' && input !== null
      ? (input as { readonly delayMs?: unknown }).delayMs
      : undefined;

  // `Number.isInteger` rejects NaN and both infinities on its own, so the checks below are the whole
  // accepted set: a number, whole, and greater than zero.
  if (typeof candidate !== 'number' || !Number.isInteger(candidate) || candidate <= 0) {
    throw new Error(
      `desktop-session-awareness-loop requires a positive integer delayMs, received ${String(candidate)}.`,
    );
  }

  return Object.freeze({ delayMs: candidate });
}

export const desktopSessionAwarenessLoopPlugin: PluginDefinition<DesktopSessionAwarenessLoopConfig> =
  {
    id: 'desktop-session-awareness-loop',
    version: '1.0.0',
    requires: [desktopSessionAwarenessService],
    // A pure consumer: it drives a capability and publishes an occurrence, and has no capability of
    // its own to offer. Nothing is provided to make the plugin "look like it has an output".
    provides: [],
    config: { parse: parseConfig },
    setup(context, config) {
      const awareness = context.services.get(desktopSessionAwarenessService);

      // Activation-local, and deliberately nothing beyond this. A deactivation ends the closure and a
      // later reactivation begins from a fresh set, so no token is needed to tell activations apart.
      // No baseline, no latest assessment, no failure count: the baseline belongs to awareness, and
      // this loop owns only the question of when to ask again.
      let stopped = false;
      let pendingTimer: ReturnType<typeof setTimeout> | undefined;
      let inFlight: Promise<void> | undefined;

      // The only thing that ever arms a cycle, and it arms exactly one. Because a cycle is scheduled
      // from the previous cycle's completion, an acquisition slower than `delayMs` cannot overlap the
      // next one — non-overlap is the shape of the scheduling rather than a guard that enforces it.
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

          const assessment = await awareness.current();

          // Checked again on the far side of the await. An activation can end while an acquisition
          // is in flight, and an assessment that arrives afterwards is one this activation must not
          // publish — the work being already underway does not make the result its to announce.
          if (stopped) return;

          await context.events.emit(desktopSessionAwarenessAssessedEvent, assessment);
        } catch {
          // One cycle failing is one cycle failing, and this boundary is where that stays true. The
          // Runtime does not turn a rejection from an active plugin's background work into a failed
          // state, so nothing else would catch an acquisition failure, a failing subscriber, or a
          // defect in this file — each would become an unhandled rejection or a loop that stopped for
          // good. What this cannot do is make the failure observable; v1 has no public surface for
          // it, and that is recorded as a known limit rather than papered over with one.
        } finally {
          if (!stopped) scheduleCycle(config.delayMs);
        }
      }

      context.defer(async () => {
        // The order carries the meaning. The flag first, so that a cycle resuming from its await
        // sees it; then the timer, so that nothing further can be armed; then the cycle itself, so
        // that this activation is fully settled before its scope has finished disposing.
        stopped = true;

        if (pendingTimer !== undefined) {
          clearTimeout(pendingTimer);
          pendingTimer = undefined;
        }

        // Safe to await: cleanups here run only for the plugins that depend on this one, and the
        // capability this loop consumes is released only after this scope has finished disposing.
        // `runCycle` resolves on every path, so this await cannot reject.
        if (inFlight !== undefined) await inFlight;
      });

      // Scheduled rather than awaited, because activation must not block on a real acquisition. The
      // boundary is a macrotask, so by the time the first cycle runs the plugin is already active and
      // a caller that subscribed after `loadPlugin` resolved is already listening.
      scheduleCycle(0);
    },
  };
