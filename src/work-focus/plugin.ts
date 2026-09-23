// The current explicit work focus, as a plugin.
//
// The human who declares a focus reaches this plugin over its own endpoint; that is a client, and it
// is not a reason to register anything. What *is* a reason arrived later and separately: the
// Repository CI relevance judgement compares this set against a perception, which makes it a real
// reader inside the composition. So this plugin now provides `work-focus.current`, and provides it
// for that one caller — see `contracts.ts` for why the contract is the set and nothing else.
//
// It still declares no Event. It requires Chronicle now, and writes it, and the reason is the
// admission rule it is the first to exercise: only the semantic owner of a concern may admit a durable
// fact about it, and only the proposition that owner is entitled to assert. Nothing else in Hikari is
// entitled to say that a work focus was declared, so no recorder was invented and no Event was added
// for one to subscribe to — the writer is the owner, in the file that owns the state.
//
// What it admits is a *semantic transition*, not a command that arrived. Two of the four words can
// leave the set exactly where it was (`declare` of something already declared, `clear` of an
// already-empty set), `status` never moves it at all, and order is not part of this contract — so a
// `replace` naming the same members in another order moved nothing either. None of those is an
// occurrence, and none of them reaches `chronicle.append`.
//
// The decision itself — move the set, decide whether that was an occurrence, record it, answer — is
// in `session.ts`, and it is there rather than here because none of it is about a pipe. This file
// wires that decision to an activation and an endpoint; it does not make it, and it holds no state.
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

import { chronicleService } from '../chronicle/index.js';
import type { PluginDefinition } from '../runtime/plugin.js';
import { workFocusCurrentService } from './contracts.js';
import { listenWorkFocusEndpoint } from './endpoint.js';
import { workFocusEndpointPath } from './endpoint-path.js';
import { WorkFocusError } from './errors.js';
import { createWorkFocusSession } from './session.js';

export interface WorkFocusPluginConfig {
  readonly rootDir: string;
}

export const workFocusPlugin: PluginDefinition<WorkFocusPluginConfig> = {
  id: 'work-focus',
  version: '1.0.0',
  // Chronicle, because this plugin is the writer of its own durable facts. The dependency is hard:
  // without a fact history there is nowhere to admit an occurrence, and a work focus that ran anyway
  // would be silently deciding that its own history did not matter. Loaded before its provider it
  // waits, exactly as any other dependent does.
  requires: [chronicleService],
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

    // Pulled once, at activation: the contract is what this plugin needs, and holding it for the
    // activation is the same lifetime the endpoint has. It is handed to the session, which is the
    // only thing that uses it, and this file never touches it again.
    const session = createWorkFocusSession(context.services.get(chronicleService));

    // Provided before the endpoint exists, so that the scope's LIFO teardown closes the ingress
    // first and withdraws the contract second: a request already being served keeps the state it is
    // reading until it is done, and nothing new can arrive to find the contract already gone.
    //
    // The closure reads the session's set at call time rather than capturing it, which is the whole of
    // how a consumer sees a `declare` that happened after it was handed this. A captured snapshot
    // would answer every later question with the set as it stood at activation.
    context.services.provide(
      workFocusCurrentService,
      Object.freeze({
        current: async (): Promise<readonly string[]> => session.current().designations,
      }),
    );

    const endpoint = await listenWorkFocusEndpoint(
      { handle: (request) => session.answer(request) },
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
