// What Hikari sees right now, as a plugin, and the answer a human asks for.
//
// This is the desktop perception chain's exit. Five plugins below it perceive, compose and compare;
// none of them was ever readable from outside, and this one is the whole of what makes them so. It
// adds no fact, holds no state and reaches no source.
//
// One dependency, and it is the only one there is to have. The Awareness layer's assessment carries
// the complete World snapshot in *both* of its shapes, so the snapshot travels with the verdict and a
// second read of `desktopSessionWorldService` would be a duplicate acquisition of the same instant —
// a second PowerShell launch whose result could differ from the one the verdict was computed against,
// and a rendering whose facts and whose judgement were of two different moments. There is nothing
// this plugin could learn from the World that the assessment does not already carry.
//
// The consequence worth stating plainly, because it is the one real cost of this slice and it is
// invisible from outside:
//
//   `desktopSessionAwarenessService.current()` is a *consuming* read. It advances the baseline it
//   compares against — `previous = current` in `desktop-session-awareness/plugin.ts` — because a
//   comparison needs the previous snapshot to be the last one taken. In the default composition that
//   method has one caller, `desktop-session-awareness-loop`, on a cadence. This plugin is a second
//   caller, and it is called by a human at a moment of their choosing.
//
// So an observation query interleaves with the loop's cycles: the loop's next comparison is measured
// against the snapshot this query took, not against the loop's own previous cycle, and a change the
// query already consumed will not be reported again by the loop. Nothing downstream notices today —
// `desktop-session-awareness-loop.assessed` has no subscribers — but it is a real coupling and it is
// not something this file can fix without changing the Awareness contract.
//
// Two consequences of that coupling are worth naming rather than leaving to be discovered, because
// both are invisible from here and neither is guarded against:
//
//   A query that is never delivered still consumes the baseline. The endpoint serves the question to
//   completion whatever the client does, so a human who asks and then closes the terminal — or whose
//   CLI times out — has still advanced the comparison partner for everyone else. The loop's next
//   verdict covers the shorter window.
//
//   Concurrent queries are not capped, and each one acquires two sources through subprocesses. The
//   loop deliberately does not overlap its own cycles; this endpoint, in the same process, has no such
//   discipline. Two humans asking at once is two live acquisitions. It is left uncapped because the
//   alternatives all cost more than the problem: serialising here would add a queue whose ordering
//   rules this plugin has no basis to choose, and sharing one in-flight assessment between callers
//   would make "what do you see now?" answer with somebody else's moment.
//
// Both are recorded rather than fixed because the cure lives in the Awareness contract — in who
// advances the baseline, and whether a peek that does not advance it should exist — and inventing one
// here would be this plugin editing a judgement it was only asked to carry.
//
// It is accepted rather than worked around, and the alternative was worse. Reading the World directly
// to avoid it would drop the verdict, which is half of what a human came to read, and would put a
// second acquisition of the same instant beside the first — inventing a difference between what the
// human sees and what the loop saw, in a surface whose entire purpose is to be checkable. What a
// query claims is what the assessment claims: this is what Hikari sees now, and the comparison is
// against the last time anything — human or loop — asked for an assessment.
//
// There is no Service, and by the Contract Creation Gate there should not be: nothing in the
// composition asks this plugin for anything, and the one thing that does is a client arriving through
// a pipe. Publishing a Service for that would be publishing one for nobody.
//
// Nothing is held between requests. No watcher, no loop, no cache, no Event, nothing written down:
// two queries a second apart are two independent readings of two independently acquired snapshots,
// which is the only shape in which "what does Hikari see?" is a question about now rather than a
// memory of an answer.

import type { PluginDefinition } from '../runtime/plugin.js';
import { desktopSessionAwarenessService } from '../desktop-session-awareness/index.js';
import { listenObserveEndpoint } from './endpoint.js';
import { observeEndpointPath } from './endpoint-path.js';
import { DesktopSessionObserveError } from './errors.js';
import { renderAssessment } from './presentation.js';

export interface DesktopSessionObservePluginConfig {
  readonly rootDir: string;
}

export const desktopSessionObservePlugin: PluginDefinition<DesktopSessionObservePluginConfig> = {
  id: 'desktop-session-observe',
  version: '1.0.0',
  // The Awareness contract is the whole input surface. Requiring it here rather than reaching for a
  // World or a source means a composition that lacks the chain fails to activate instead of failing
  // later, on the first question a human happens to ask.
  requires: [desktopSessionAwarenessService],
  provides: [],
  config: {
    parse(input: unknown): DesktopSessionObservePluginConfig {
      return Object.freeze({ rootDir: readRootDir(input) });
    },
  },
  async setup(context, config) {
    const path = observeEndpointPath(config.rootDir);
    if (path === undefined) {
      // The same platform question the other endpoint plugins ask, asked by the plugin that owns this
      // capability rather than by every caller of it.
      throw new DesktopSessionObserveError('桌面会话观察入口依赖 Windows 命名管道，本机没有。');
    }

    const awareness = context.services.get(desktopSessionAwarenessService);

    const endpoint = await listenObserveEndpoint(
      {
        // No try/catch, and no second guess about what a dependency's failure means. If the
        // acquisition rejects, this rejects, and the endpoint answers `failed` — the observation did
        // not happen. Rendering that as an assessment whose facets read `unavailable` would be this
        // layer claiming the World reported no source, which is a claim about a World call that never
        // returned.
        async handle() {
          const assessment = await awareness.current();
          return { outcome: 'ok', lines: renderAssessment(assessment) };
        },
      },
      path,
    );

    context.defer(() => endpoint.close());
  },
};

function readRootDir(input: unknown): string {
  if (typeof input !== 'object' || input === null) {
    throw new DesktopSessionObserveError('桌面会话观察插件需要一个配置对象。');
  }
  const { rootDir } = input as { rootDir?: unknown };
  if (typeof rootDir !== 'string' || !rootDir.trim()) {
    throw new DesktopSessionObserveError('桌面会话观察插件需要一个非空的 rootDir。');
  }
  return rootDir;
}
