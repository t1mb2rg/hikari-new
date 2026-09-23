// The Repository CI relevance judgement, as a plugin, and the answer a human asks for.
//
// This is the layer's consumer, and it was the first reader `work-focus.current@1` had. That reader is
// the human — they query over this plugin's own endpoint, exactly as they declare a focus over the
// work focus's — and the reason a contract exists for them at all rather than a second pipe read is
// that this judgement needs the focus *inside* the composition, where the Awareness layer also is.
//
// It has a Service now, and the paragraph this one replaces named the right reason for not having one.
// "Nothing in the composition asks it for a verdict, and the one thing that does is a client arriving
// through a pipe" is `plugin-design-spec.md` §16.2 — a real callable need — and §16.2 is still what
// decides. What §16.1 adds is only that the need does not have to be met by a consumer that already
// exists, so "no consumer has been written yet" was never the obstacle. The repository-aware Language
// variant is the first thing that calls this judgement: a model may ask for it as a third read beside
// the work focus and the desktop, which is a callable need inside the composition rather than a
// client-shaped reason to publish. Service and exposure landed together for that reason; see
// `contracts.ts`.
//
// One implementation, two ways in. The endpoint and the Service call the same `judge` below rather than
// two copies that agree today, and nothing here decides anything per caller: a human asking over the pipe
// and a model asking through Language get the same comparison of the same two values. The two ways in are
// pinned against each other in `test/repository-ci-relevance.test.mjs`, over a real pipe, rather than
// against a description of them.
//
// Both dependencies are pulled on every call and nothing is held between them. There is no watcher, no
// loop, no cache, no Event and nothing written down: two calls a second apart are two independent
// judgements of two independent snapshots, which is the only shape in which "relevance" is a question
// about now rather than a memory of a previous answer.

import type { PluginDefinition } from '../runtime/plugin.js';
import { repositoryCiAwarenessService } from '../repository-ci-awareness/index.js';
import { workFocusCurrentService } from '../work-focus/index.js';
import { repositoryCiRelevanceService } from './contracts.js';
import { listenRelevanceEndpoint } from './endpoint.js';
import { relevanceEndpointPath } from './endpoint-path.js';
import { RepositoryCiRelevanceError } from './errors.js';
import { judgeRelevance, renderJudgement } from './judgement.js';
import type { RepositoryCiRelevanceJudgement, RepositoryCiRelevanceVerdict } from './types.js';

export interface RepositoryCiRelevancePluginConfig {
  readonly rootDir: string;
}

export const repositoryCiRelevancePlugin: PluginDefinition<RepositoryCiRelevancePluginConfig> = {
  id: 'repository-ci-relevance',
  version: '1.0.0',
  // The work focus is a dependency rather than a peer to be reached around. It is required by
  // contract, so a composition that loaded this plugin without one fails to activate instead of
  // failing later, on the first question a human happens to ask.
  requires: [workFocusCurrentService, repositoryCiAwarenessService],
  // The one thing this plugin gives the rest of the composition, and it grants nobody anything: a
  // consumer still has to name this contract in its own `requires`, and the Runtime is what hands it
  // over. Providing it is also what lets this plugin be `active` with no consumer at all — the Runtime
  // reconciles requirements, not demand, so a resident whose Language is the base variant runs this
  // plugin exactly as it always did. That is a property of the Runtime and not a case this file handles.
  provides: [repositoryCiRelevanceService],
  config: {
    parse(input: unknown): RepositoryCiRelevancePluginConfig {
      return Object.freeze({ rootDir: readRootDir(input) });
    },
  },
  async setup(context, config) {
    const path = relevanceEndpointPath(config.rootDir);
    if (path === undefined) {
      // The same platform question the work focus asks, asked by the plugin that owns this capability
      // rather than by every caller of it.
      throw new RepositoryCiRelevanceError('Repository CI relevance 入口依赖 Windows 命名管道，本机没有。');
    }

    const focus = context.services.get(workFocusCurrentService);
    const awareness = context.services.get(repositoryCiAwarenessService);

    // The judgement, made once and reached two ways. Everything that is true of the comparison lives
    // here and is written once, so "the Service and the endpoint agree" is not a property two code
    // paths have to maintain — it is the same code path, and there is no second place for a change to
    // land in only one of them.
    async function judge(): Promise<RepositoryCiRelevanceJudgement> {
      const [designations, assessment] = await Promise.all([
        focus.current(),
        awareness.current(),
      ]);

      // Only the snapshot goes into the judgement. The assessment also carries a verdict about
      // commits, and it is dropped on this line rather than merely ignored inside `judgeRelevance`
      // — whether two commit strings match has no bearing on whether a human's declaration names
      // the repository a CI observation is about.
      return judgeRelevance(designations, assessment.snapshot);
    }

    // Published before the endpoint is opened, so that a composition which loads this plugin is never
    // briefly a composition where the contract exists and nothing answers for it. A failure below
    // disposes this activation's scope, and the registration goes with it.
    context.services.provide(repositoryCiRelevanceService, Object.freeze({ current: judge }));

    const endpoint = await listenRelevanceEndpoint(
      {
        // No try/catch, and no second guess about what a dependency's failure means. If either
        // acquisition rejects, `judge` rejects, and the endpoint answers `failed` — the judgement did
        // not run. Resolving it into `unknown` here would be this layer claiming a comparison it did
        // not get to make. The Service rejects for the same reason and in the same way, because it is
        // the same call.
        async handle() {
          const judgement = await judge();
          const verdict: RepositoryCiRelevanceVerdict = judgement.verdict;

          return { outcome: 'ok', verdict, lines: renderJudgement(judgement) };
        },
      },
      path,
    );

    context.defer(() => endpoint.close());
  },
};

function readRootDir(input: unknown): string {
  if (typeof input !== 'object' || input === null) {
    throw new RepositoryCiRelevanceError('Repository CI relevance 插件需要一个配置对象。');
  }
  const { rootDir } = input as { rootDir?: unknown };
  if (typeof rootDir !== 'string' || !rootDir.trim()) {
    throw new RepositoryCiRelevanceError('Repository CI relevance 插件需要一个非空的 rootDir。');
  }
  return rootDir;
}
