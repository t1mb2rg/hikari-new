// What is in the window a human was reading, as a plugin, and the answer they ask for.
//
// ---------------------------------------------------------------------------------------------
// What this plugin holds, and why holding it is the whole design
// ---------------------------------------------------------------------------------------------
//
// `requires: []` and `provides: []` — the boundary review's decision, and the implementation mandate
// restates it as a constraint to report against rather than to bend. What makes both empty honest is
// that the input this plugin needs is not a Service and must not become one:
//
//   The window identity arrives as an *occurrence*. `desktop-session-awareness-loop` already publishes
//   `desktop-session-awareness-loop.assessed` on its own cadence — it did so before this plugin
//   existed, with zero subscribers, and `src/cli/resident.ts` says so in as many words. Subscribing to
//   it is the frozen principle's own shape: the producer exposes an occurrence, the consumer declares
//   interest, and neither owns a routing graph. A Service here would mean `desktop-session-awareness`
//   acquiring a pull method whose only caller is this plugin, which is a Service created for a
//   hypothetical rather than for a call that happens.
//
//   `context.events.on` needs no `requires`. `src/runtime/plugin-context.ts:35` subscribes without
//   consulting the declaration at all — the gate is on `services.get` and `services.provide`, and this
//   plugin calls neither. So the empty `requires` is not a loophole being exploited: it is the
//   mechanism the Runtime already provides for exactly this relationship, which is why the boundary
//   review's "requires: []" survives contact with the implementation unchanged.
//
// ---------------------------------------------------------------------------------------------
// Why the target is sampled on the occurrence and not on the request
// ---------------------------------------------------------------------------------------------
//
// Check A of the implementation mandate, and the answer is measured rather than argued. Hikari has no
// top-level window on this machine: the CLI and the TUI draw inside the terminal that hosts them, so
// the foreground window at the moment `hikari content status` runs is the console the human typed the
// command into. A read-time `GetForegroundWindow` would read back the terminal — the window the human
// used to *ask*, at the moment they asked, which is never the window they were reading. That is not a
// stale answer; it is the wrong window, chosen with confidence.
//
// So the sample is taken on the awareness cadence instead, and a read uses the most recent sample
// Hikari can attribute to a human. `target.ts` owns the attribution rule; `probe.ts` owns the
// acquisition.
//
// ---------------------------------------------------------------------------------------------
// Three properties of the occurrence handler, each of which is load-bearing
// ---------------------------------------------------------------------------------------------
//
//   It does not await. `EventBus.emit` awaits every handler before the publisher's `emit` call
//   resolves (`src/runtime/event-bus.ts:38`), so an awaited probe would put a PowerShell launch inside
//   the awareness loop's cycle and lengthen the cadence of a chain this plugin is a guest of. The
//   handler returns `undefined`, not a promise, and the probe runs detached.
//
//   It never rejects. `emit` throws an `AggregateError` if any subscriber rejected, and that error
//   surfaces in the loop's own cycle — a sampling failure would be reported as an awareness failure.
//   The detached promise therefore carries its own catch, and a probe that failed is a cadence that
//   produced no sample rather than an event that failed.
//
//   At most one probe is in flight. Occurrences arrive whether or not the last probe has finished, and
//   without this a cadence shorter than a PowerShell launch would queue launches without bound. An
//   occurrence that arrives while a probe is out is simply not sampled; the next one will be.
//
// ---------------------------------------------------------------------------------------------
// The read, and the one thing it refuses to do
// ---------------------------------------------------------------------------------------------
//
// A read is addressed to the handle in an *admissible* sample, is re-checked against that sample's
// process id before and after the walk, and touches no element that is not in that handle's tree. It
// never asks UIA for the focused element, and never will: `uia.ts` carries the measurement behind that
// refusal.
//
// There is no Service, and by the Contract Creation Gate there should not be: nothing in the
// composition asks this plugin for anything, and the one thing that does is a client arriving through
// a pipe. Publishing a Service for that would be publishing one for nobody.
//
// Nothing is written down. No Memory, no Experience, no store, no file: a sample lives in this
// process's memory only for as long as it takes the next one to replace it, and it is gone when the
// plugin unloads. The mandate's "不落盘保存真实正文，不建立 Memory、Experience 或持续采集" is
// structural here rather than a rule this file follows — there is no code that could write to disk,
// and the sample window is cleared on teardown.

import type { PluginDefinition } from '../runtime/plugin.js';
import { desktopSessionAwarenessAssessedEvent } from '../desktop-session-awareness-loop/index.js';
import { listenContentReadEndpoint } from './endpoint.js';
import { contentReadEndpointPath } from './endpoint-path.js';
import { DesktopContentReadError } from './errors.js';
import { renderContentRead } from './presentation.js';
import { createWindowsProbe, type ContentReadProbe } from './probe.js';
import {
  isAdmissibleSample,
  latestAdmissibleSample,
  toWindowIdentity,
  type WindowSample,
} from './target.js';
import { createWindowsWalker, decideContentRead, type ContentReadWalker } from './uia.js';

export interface DesktopContentReadPluginConfig {
  readonly rootDir: string;
}

// How many samples the holder keeps. Two, and the number is not arbitrary: one is the sample a read
// would use, and the second is the one an out-of-order completion could still land on top of it. With
// the in-flight guard below there is at most one probe out at a time, so in practice this is always
// one — the second slot exists so that the selection rule is exercised by the code that runs rather
// than only by tests, and two is the smallest number that can express that.
const SAMPLES_KEPT = 2;

/**
 * The window-identity samples Hikari has observed, and the rule for choosing among them.
 *
 * The holder is this small on purpose. It is the only state this plugin owns, it is bounded, it holds
 * nothing but a handle, a title, a process name and two numbers, and `clear()` — called from teardown —
 * is what makes "nothing is kept" a fact about a process rather than a promise in a document.
 */
class SampleWindow {
  #samples: readonly WindowSample[] = [];
  #inFlight = false;
  #disposed = false;

  /** The most recent admissible sample, or `undefined` when there is none. */
  get current(): WindowSample | undefined {
    return latestAdmissibleSample(this.#samples);
  }

  /**
   * Starts one probe, unless one is already out or this holder is gone.
   *
   * Returns `void` and never rejects: see the header. The caller is a synchronous event handler inside
   * the awareness loop's cycle, and everything this method can go wrong with has to stay inside it.
   */
  capture(probe: ContentReadProbe): void {
    if (this.#inFlight || this.#disposed) return;
    this.#inFlight = true;

    void probe
      .sample()
      .then((sample) => {
        if (sample === undefined || this.#disposed) return;
        // The rule is applied here rather than at read time, so that what is held is only ever what a
        // read is allowed to use. A sample that is inadmissible is discarded rather than remembered
        // and filtered later, which is the difference between a holder that cannot answer with a
        // terminal and a holder that is trusted not to.
        if (!isAdmissibleSample(sample)) return;
        this.#samples = [...this.#samples, sample].slice(-SAMPLES_KEPT);
      })
      .catch(() => {
        // A probe that failed is a cadence that produced no sample. It is not an error to report and it
        // is not the previous sample's problem: the last admissible sample stands until a later
        // cadence replaces it. Reporting it would require somewhere to report it to, and this plugin
        // deliberately has no such place.
      })
      .finally(() => {
        this.#inFlight = false;
      });
  }

  clear(): void {
    this.#disposed = true;
    this.#samples = [];
  }
}

export function createDesktopContentReadPlugin(
  createProbe: () => ContentReadProbe,
  createWalker: () => ContentReadWalker,
): PluginDefinition<DesktopContentReadPluginConfig> {
  return {
    id: 'desktop-content-read',
    version: '1.0.0',
    // Both empty, and both for a reason rather than for symmetry — the header above. The occurrence
    // this plugin listens for needs no declaration, and there is nothing in the composition that asks
    // this plugin a question.
    requires: [],
    provides: [],
    config: {
      parse(input: unknown): DesktopContentReadPluginConfig {
        return Object.freeze({ rootDir: readRootDir(input) });
      },
    },
    async setup(context, config) {
      const path = contentReadEndpointPath(config.rootDir);
      if (path === undefined) {
        // The same platform question the other endpoint plugins ask, asked by the plugin that owns this
        // capability rather than by every caller of it. The base composition is Windows-only already;
        // this is what keeps that visible at the plugin that would fail rather than at a distance.
        throw new DesktopContentReadError('桌面正文读取入口依赖 Windows 命名管道，本机没有。');
      }

      const probe = createProbe();
      context.defer(() => probe.dispose());

      const walker = createWalker();
      context.defer(() => walker.dispose());

      const samples = new SampleWindow();
      context.events.on(desktopSessionAwarenessAssessedEvent, () => {
        samples.capture(probe);
      });
      context.defer(() => samples.clear());

      const endpoint = await listenContentReadEndpoint(
        {
          // The request is ignored, and that is the correct reading rather than an oversight: there is
          // one word, it carries no operand, and a request that could name a window would let a caller
          // ask about a window Hikari never observed. See `protocol.ts`.
          async handle() {
            const sample = samples.current;
            if (sample === undefined) {
              // Not one of the five kinds, and deliberately: the five are all *about a window*, and
              // this case has no window to be about. It is a rejection, so the endpoint answers
              // `failed`, which is the vocabulary this repository already has for "the answer could not
              // be produced" — see `types.ts`.
              throw new DesktopContentReadError(
                'Hikari 还没有观测到可以归给人类的窗口，这次读取没有目标。',
              );
            }

            const window = toWindowIdentity(sample);
            // No try/catch around the walk. A walk that threw has failed in a way that is about this
            // process rather than about the window — the three window-shaped failures
            // (`refused` / `unreadable` / `empty`) are values the walker returns — so it belongs at the
            // endpoint, which is where a `failed` reply is produced.
            const walk = await walker.walk(sample);
            return { outcome: 'ok', lines: renderContentRead(decideContentRead(walk, window)) };
          },
        },
        path,
      );
      context.defer(() => endpoint.close());
    },
  };
}

/**
 * The plugin as the composition loads it.
 *
 * The factory above takes the two acquisitions so that a test can build *this same plugin* against a
 * probe and a walker it controls — the same seam `createForegroundPlugin(createAcquirer)` uses, and for
 * the same reason: driving a real window is the Human's smoke test, and what a test can pin without one
 * is the endpoint, the attribution rule and the shape of an answer. There is no seam inside the
 * production plugin.
 */
export const desktopContentReadPlugin = createDesktopContentReadPlugin(
  createWindowsProbe,
  createWindowsWalker,
);

function readRootDir(input: unknown): string {
  if (typeof input !== 'object' || input === null) {
    throw new DesktopContentReadError('桌面正文读取插件需要一个配置对象。');
  }
  const { rootDir } = input as { rootDir?: unknown };
  if (typeof rootDir !== 'string' || !rootDir.trim()) {
    throw new DesktopContentReadError('桌面正文读取插件需要一个非空的 rootDir。');
  }
  return rootDir;
}
