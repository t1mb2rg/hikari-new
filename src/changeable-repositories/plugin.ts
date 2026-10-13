// The authorization, as a plugin.
//
// The human who names a directory reaches this plugin over its own endpoint; that is a client, and it is
// not a reason to register anything. Nothing inside the composition reads this set yet, so **this plugin
// provides nothing** — and the emptiness is a decision rather than an omission. The check this
// authorization exists to support is the one that has not been built; publishing
// `changeable-repositories.current@1` today would be publishing a contract for a consumer that does not
// exist, which is what `plugin-design-spec.md` §16 refuses.
//
// What that costs is a coupling worth stating: when the first real reader arrives, the contract is
// published and this plugin will be in the composition only where that reader is — the same path
// `work-focus` took when a relevance judgement became its first consumer. The trigger to watch for is
// exactly that: a caller that needs the set and is not this plugin's own CLI.
//
// **The trigger fired, and the paragraph above is kept as the record of what it was waiting for.** The
// reader is Language: it offers a model `authorized_repositories_list` and `authorized_repository_read`,
// and reads them through `changeable-repositories.read@1` — the Service `provides` below now publishes,
// built over the same session the pipe answers through. Both of its variants require that Service, so, as
// the paragraph predicted, this plugin is in the composition exactly where the reader is; and since both
// variants carry both capabilities, that is still every resident. The contract was not created for the
// mandate. It was created for the two branches in `src/language/read.ts` that call it, and those branches
// are the call site §16 asks for.
//
// Nothing else about this plugin moved. It still declares no Event, still writes the one durable family
// it owns, and still refuses to activate where it cannot read its own history. What is new is that it has
// something to hand out, and it hands it out as a *Service* rather than as a second endpoint: the pipe a
// human's command arrives on stays a client surface, and a model reaches the set through the same
// contract a reader inside the composition does.
//
// It declares no Event. It requires Chronicle and writes it, and the reason is the admission rule it
// exercises: only the semantic owner of a concern may admit a durable fact about it, and only the
// proposition that owner is entitled to assert. Nothing else in Hikari is entitled to say that an
// authorization was declared, so no recorder was invented and no Event was added for one to subscribe
// to — the writer is the owner, in the file that owns the state.
//
// What it admits is a *semantic transition*, not a command that arrived. `status` never moves the set,
// a `declare` of something already declared moves nothing, and order is not part of this contract — so a
// `replace` naming the same members in another order moved nothing either. None of those is an
// occurrence, and none of them reaches `chronicle.append`. A write that fails happens in the other
// order: it is an occurrence the record refused, and the set stays where it was.
//
// The decision itself — compute the transition, decide whether it was an occurrence, record it, move the
// set, answer — is in `session.ts`, and it is there rather than here because none of it is about a pipe.
// This file wires that decision to an activation and an endpoint; it does not make it.
//
// The endpoint exists for exactly as long as this plugin is activated — no longer — and that is what
// makes the resource story simple: the Runtime already knows when a plugin starts and stops, so an
// endpoint created in `setup` and closed by a `context.defer` cleanup is owned by the mechanism that
// exists for owning it, rather than by a second lifetime invented here.
//
// One consequence is worth stating because it differs from the Resident's control endpoint, which
// deliberately outlives its Runtime: this endpoint cannot outlive its plugin, so "nothing is listening"
// no longer means only "no process" — it can also mean "a process whose authorization is not running",
// and on this surface it can additionally mean "a process that could not read its own history and
// refused to activate". The client's wording accounts for all of them; this file does not get to pick
// which one a human is told.

import { chronicleService } from '../chronicle/index.js';
import type { PluginDefinition } from '../runtime/plugin.js';
import { listenChangeableRepositoriesEndpoint } from './endpoint.js';
import { changeableRepositoriesEndpointPath } from './endpoint-path.js';
import { ChangeableRepositoriesError } from './errors.js';
import { readChangeableRepositories } from './history.js';
import { changeableRepositoriesReadService, createChangeableRepositoriesRead } from './read.js';
import { createChangeableRepositoriesSession } from './session.js';

export interface ChangeableRepositoriesPluginConfig {
  readonly rootDir: string;
}

export const changeableRepositoriesPlugin: PluginDefinition<ChangeableRepositoriesPluginConfig> = {
  id: 'changeable-repositories',
  version: '1.0.0',
  // Chronicle, because this plugin is the writer *and the reader* of its own durable facts. The
  // dependency is hard in a stronger sense than the sibling's: without a fact history there is nowhere
  // to admit an occurrence, and there is also nothing to rebuild the authorization from — so a plugin
  // that ran anyway would be silently deciding that a human's declaration had lapsed. Loaded before its
  // provider it waits, exactly as any other dependent does.
  requires: [chronicleService],
  // Empty until the read half arrived, and empty for the reason the header gives: a contract published
  // for a consumer that does not exist is what `plugin-design-spec.md` §16 refuses, and for a while that
  // was the whole truth about this plugin. The consumer exists now — `src/language/read.ts` calls this
  // Service on behalf of a model — so the same reasoning points the other way today: an empty list would
  // now say a capability is not expressible while a branch inside the composition is expressing it.
  provides: [changeableRepositoriesReadService],
  config: {
    parse(input: unknown): ChangeableRepositoriesPluginConfig {
      return Object.freeze({ rootDir: readRootDir(input) });
    },
  },
  async setup(context, config) {
    const path = changeableRepositoriesEndpointPath(config.rootDir);
    if (path === undefined) {
      // The ingress is a named pipe and a host without a pipe namespace has nowhere to put it. This is
      // the plugin's own platform question, asked once, in the plugin that owns the capability — the
      // same shape `work-focus` uses, and for the same reason: whether an implementation can work on
      // this host is ownership's business, not every consumer's.
      throw new ChangeableRepositoriesError('可改仓库入口依赖 Windows 命名管道，本机没有。');
    }

    // Pulled once, at activation, and held for the activation — the same lifetime the endpoint has.
    const chronicle = context.services.get(chronicleService);

    // Read before the endpoint exists, and that ordering is the point: a session is only ever
    // constructed around a set somebody managed to read, so no request can arrive at a plugin whose
    // history it could not make sense of. A history this build cannot read throws here rather than
    // answering `status` with a set that is not what the human declared.
    const initial = await readChangeableRepositories(chronicle);
    const session = createChangeableRepositoriesSession(chronicle, initial);

    // Published over that same session, so a model and the human who declared the set can never be
    // looking at two different sets: `current()` is read at call time, and both surfaces reach the one
    // object this activation built. Published before the endpoint listens, because the Service is the
    // reason this plugin has anything to give away and the pipe is a surface onto the same state rather
    // than a second source of it.
    context.services.provide(
      changeableRepositoriesReadService,
      createChangeableRepositoriesRead(session),
    );

    const endpoint = await listenChangeableRepositoriesEndpoint(
      { handle: (request) => session.answer(request) },
      path,
    );

    // Registered, not returned: the Runtime's cleanup ordering is scope-wide and awaits each entry, and
    // a `setup` return value would be the same mechanism reached by a second route. One route means one
    // ordering, and this plugin has no reason to prefer the other one.
    context.defer(() => endpoint.close());
  },
};

function readRootDir(input: unknown): string {
  if (typeof input !== 'object' || input === null) {
    throw new ChangeableRepositoriesError('可改仓库插件需要一个配置对象。');
  }
  const { rootDir } = input as { rootDir?: unknown };
  if (typeof rootDir !== 'string' || !rootDir.trim()) {
    throw new ChangeableRepositoriesError('可改仓库插件需要一个非空的 rootDir。');
  }
  return rootDir;
}
