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
// The dependency is specifically `desktop-session-awareness.peek@1`, not `...current@1`, and that
// distinction is the whole of this plugin's relationship with the judgement timeline.
//
//   `current()` is the driver's question: the snapshot it reads becomes the baseline the next
//   assessment is measured from. `desktop-session-awareness-loop` holds it, on a cadence, and that is
//   the timeline — each judgement measured from the one before it.
//
//   `peek()` computes the same assessment from the same baseline and leaves the baseline alone.
//
// This plugin held `current()` first, and the defect that produced was measured rather than reasoned.
// Composing the real awareness plugin and the real loop against a world that goes notepad -> firefox
// -> firefox: the loop's first cycle returns `baseline`, a human query then returns `changed`, and the
// loop's second cycle returns `stable`. The change is real, the human saw it, and the timeline never
// did — worse, the loop's `stable` covers a window that opened at whatever moment the human happened
// to type a command. An inspection surface that consumes what it inspects is not an inspection
// surface; it is a second writer of the thing it was built to let a human check.
//
// Requiring the peek contract rather than the current one makes that structural instead of
// behavioural. This plugin is not given the ability to advance the baseline, so no test has to prove
// it declines to, and no future edit here can start. A composition that has no peek provider fails to
// activate rather than failing later, on the first question a human happens to ask — which is also
// why the requirement is the whole input surface rather than a World or a source.
//
// What a peek costs is still an acquisition, and two consequences of that are named rather than left
// to be discovered, because both are invisible from here and neither is a defect:
//
//   A query that is never delivered still acquires. The endpoint serves the question to completion
//   whatever the client does, so a human who asks and then closes the terminal — or whose CLI times
//   out — has still launched the subprocesses. What it no longer does is spend the timeline's
//   baseline on an answer nobody read.
//
//   Concurrent queries are not capped, and each one acquires two sources through subprocesses. The
//   loop deliberately does not overlap its own cycles; this endpoint, in the same process, has no such
//   discipline. Two humans asking at once is two live acquisitions. It is left uncapped because the
//   alternatives all cost more than the problem: serialising here would add a queue whose ordering
//   rules this plugin has no basis to choose, and sharing one in-flight assessment between callers
//   would make "what do you see now?" answer with somebody else's moment.
//
// Reading the World directly instead would have been the other way to leave the timeline alone, and
// it is worse: it would drop the verdict, which is half of what a human came to read, and would put a
// second acquisition of the same instant beside the first — inventing a difference between what the
// human sees and what the loop saw, in a surface whose entire purpose is to be checkable. What a
// query claims is what the assessment claims: this is what Hikari sees now, judged against the
// baseline the judgement timeline is currently standing on.
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
import { desktopSessionAwarenessPeekService } from '../desktop-session-awareness/index.js';
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
  // The Awareness peek contract is the whole input surface, and the *peek* one specifically: this
  // plugin is not given the ability to advance the baseline, so "inspection does not participate in
  // the judgement timeline" is a property of what it holds rather than a rule it follows.
  requires: [desktopSessionAwarenessPeekService],
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

    const awareness = context.services.get(desktopSessionAwarenessPeekService);

    const endpoint = await listenObserveEndpoint(
      {
        // No try/catch, and no second guess about what a dependency's failure means. If the
        // acquisition rejects, this rejects, and the endpoint answers `failed` — the observation did
        // not happen. Rendering that as an assessment whose facets read `unavailable` would be this
        // layer claiming the World reported no source, which is a claim about a World call that never
        // returned.
        async handle() {
          const assessment = await awareness.peek();
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
