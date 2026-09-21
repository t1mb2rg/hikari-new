// The current explicit work focus, as a plugin.
//
// The human who declares a focus reaches this plugin over its own endpoint; that is a client, and it
// is not a reason to register anything. What *is* a reason arrived later and separately: the
// Repository CI relevance judgement compares this set against a perception, which makes it a real
// reader inside the composition. So this plugin now provides `work-focus.current`, and provides it
// for that one caller — see `contracts.ts` for why the contract is the set and nothing else.
//
// It still declares no Event. It requires nothing.
//
// The endpoint still exists for exactly as long as this plugin is activated — no longer — and that is
// what makes the resource story simple: the Runtime already knows when a plugin starts and stops, so
// an endpoint created in `setup` and closed by a `context.defer` cleanup is owned by the mechanism
// that exists for owning it, rather than by a second lifetime invented here.
//
// One consequence is worth stating because it differs from the Resident's control endpoint, which
// deliberately outlives its Runtime: this endpoint cannot outlive its plugin, so "nothing is
// listening" no longer means only "no process" — it can also mean "a process whose work focus is not
// running". The client's wording accounts for both (`src/cli/focus.ts`); this file does not get to
// pick which one a human is told.

import type { PluginDefinition } from '../runtime/plugin.js';
import { workFocusCurrentService } from './contracts.js';
import { listenWorkFocusEndpoint } from './endpoint.js';
import { workFocusEndpointPath } from './endpoint-path.js';
import { WorkFocusError } from './errors.js';
import { applyWorkFocusRequest, emptyWorkFocus, renderWorkFocus, type WorkFocusState } from './state.js';
import type { WorkFocusReply } from './types.js';

export interface WorkFocusPluginConfig {
  readonly rootDir: string;
}

export const workFocusPlugin: PluginDefinition<WorkFocusPluginConfig> = {
  id: 'work-focus',
  version: '1.0.0',
  // Nothing is required: this plugin reads no other module and is a leaf. What it provides it
  // provides for exactly one caller, and `contracts.ts` says what that caller is.
  requires: [],
  provides: [workFocusCurrentService],
  config: {
    parse(input: unknown): WorkFocusPluginConfig {
      return Object.freeze({ rootDir: readRootDir(input) });
    },
  },
  async setup(context, config) {
    const path = workFocusEndpointPath(config.rootDir);
    if (path === undefined) {
      // The ingress is a named pipe and a host without a pipe namespace has nowhere to put it. This
      // is the plugin's own platform question, asked once, in the plugin that owns the capability —
      // the same shape `foreground.windows` uses, and for the same reason: whether an implementation
      // can work on this host is ownership's business, not every consumer's.
      throw new WorkFocusError('工作焦点入口依赖 Windows 命名管道，本机没有。');
    }

    // The state lives in this closure and nowhere else. It is created by this activation, held by
    // this activation and gone when this activation ends — which is what makes "empty after a
    // restart" a structural property rather than a rule someone has to remember to enforce. There is
    // no file, no store and no Chronicle entry behind it, so there is nothing that could survive.
    let state: WorkFocusState = emptyWorkFocus();

    // Provided before the endpoint exists, so that the scope's LIFO teardown closes the ingress
    // first and withdraws the contract second: a request already being served keeps the state it is
    // reading until it is done, and nothing new can arrive to find the contract already gone.
    //
    // The closure reads `state` at call time rather than capturing it, which is the whole of how a
    // consumer sees a `declare` that happened after it was handed this. A captured snapshot would
    // answer every later question with the set as it stood at activation.
    context.services.provide(
      workFocusCurrentService,
      Object.freeze({
        current: async (): Promise<readonly string[]> => state.designations,
      }),
    );

    const endpoint = await listenWorkFocusEndpoint(
      {
        handle(request): WorkFocusReply {
          const transition = applyWorkFocusRequest(state, request);
          if (transition.kind === 'refused') {
            return { outcome: 'failed', lines: [transition.reason] };
          }

          state = transition.state;
          // A write answers with the set it left behind, not with a claim about what it did. The
          // human's question after any of the three writes is the same question `status` asks.
          return { outcome: 'ok', lines: renderWorkFocus(state) };
        },
      },
      path,
    );

    // Registered, not returned: the Runtime's cleanup ordering is scope-wide and awaits each entry,
    // and a `setup` return value would be the same mechanism reached by a second route. One route
    // means one ordering, and this plugin has no reason to prefer the other one.
    context.defer(() => endpoint.close());
  },
};

function readRootDir(input: unknown): string {
  if (typeof input !== 'object' || input === null) {
    throw new WorkFocusError('工作焦点插件需要一个配置对象。');
  }
  const { rootDir } = input as { rootDir?: unknown };
  if (typeof rootDir !== 'string' || !rootDir.trim()) {
    throw new WorkFocusError('工作焦点插件需要一个非空的 rootDir。');
  }
  return rootDir;
}
