// `hikari resident` — the composition root for a long-running Hikari.
//
// What this file owns:
//   which process is the Hikari      — it creates the Runtime and loads the plugins into it
//   what "ready" means               — every plugin in the composition reported `active`
//   when the process lifetime ends   — a lease it holds itself, released only after shutdown
//   what an operator is told         — readiness, capability, and the exit code
//   the control channel's meaning    — what `status` answers and what `stop` asks for
//
// What this file deliberately does not own:
//   plugin lifecycle, dependency reconciliation, unload and cleanup ordering — the Runtime owns all
//   of that, and this module never takes a plugin down itself, never reads a plugin's internals and
//   never reorders a teardown the Runtime is already sequencing.
//
// Resident is a composition role, not a subsystem: no plugin is added for it, no service or event is
// defined for it, and it holds no domain state. Everything it knows about Hikari it learns from the
// states the Runtime reports and from the errors the Runtime recorded.
//
// The control channel is the same claim made to a second audience. It listens on a local endpoint so
// that a human who cannot send this process a signal can still ask it to stop, and it answers with
// the states and errors the Runtime already holds — the identical material `renderNotReady` prints.
// It is not a second input surface: it cannot start anything, cannot load a plugin, and cannot say
// anything the Runtime has not already recorded.

import { MessageChannel } from 'node:worker_threads';

import { ChronicleNotInitializedError, chroniclePlugin } from '../chronicle/index.js';
import { NotInitializedError, continuityPlugin } from '../continuity/index.js';
import { desktopSessionAwarenessPlugin } from '../desktop-session-awareness/index.js';
import { desktopSessionAwarenessLoopPlugin } from '../desktop-session-awareness-loop/index.js';
import { desktopSessionObservePlugin } from '../desktop-session-observe/index.js';
import { desktopSessionWorldPlugin } from '../desktop-session-world/index.js';
import { foregroundPlugin } from '../foreground/index.js';
import { gitHubCiPlugin } from '../github-ci/index.js';
import { gitRepositoryPlugin } from '../git-repository/index.js';
import { inputActivityPlugin } from '../input-activity/index.js';
import { languagePlugin, repositoryLanguagePlugin } from '../language/index.js';
import type { LanguagePluginConfig } from '../language/index.js';
import { Runtime } from '../index.js';
import type { PluginDefinition, PluginState } from '../index.js';
import { repositoryCiAwarenessPlugin } from '../repository-ci-awareness/index.js';
import { repositoryCiRelevancePlugin } from '../repository-ci-relevance/index.js';
import { repositoryCiWorldPlugin } from '../repository-ci-world/index.js';
import { oneLine } from '../terminal-text/index.js';
import { workFocusPlugin } from '../work-focus/index.js';
import { controlEndpointPath } from './control.js';
import { listenControlEndpoint, type ControlEndpoint, type ControlHost } from './control-endpoint.js';
import {
  CHRONICLE_INIT_HINT,
  INIT_HINT,
  type CommandOutcome,
  type ModelOptions,
  type ResidentOptions,
} from './options.js';

const READY_LINE = 'Hikari 常驻已启动。\n';
const STOPPED_LINE = 'Hikari 常驻已停止。\n';
const SIGINT = 'SIGINT';
const SIGTERM = 'SIGTERM';

/** The resident's own claim on the process lifetime. */
export interface LifetimeLease {
  /** True while this lease is what keeps the process's event loop alive. */
  isHolding(): boolean;
  /** Give the process back its ability to exit. Idempotent. */
  release(): void;
}

// A Node process exits when nothing keeps its event loop alive, and a pending promise is not a
// handle: neither an awaited acquisition nor an unresolved signal promise holds one. Without a lease
// of its own the resident would be kept alive only by whatever a domain plugin happens to have open
// — a cadence timer, a PowerShell child, a store handle — which would make the process lifetime a
// consequence of plugin behaviour instead of a decision this file makes.
//
// A `MessagePort` is chosen because it is a handle with no behaviour: it cannot fire, cannot drift,
// cannot be mistaken for a cadence, and says nothing about Hikari's domain. `ref()` is what makes it
// hold — a freshly created port is unref'd — and `close()` is what releases the process. The peer
// port is closed with it so that a released lease leaves no port behind.
export function createLifetimeLease(): LifetimeLease {
  const channel = new MessageChannel();
  const lease = channel.port1;
  const peer = channel.port2;
  lease.ref();

  let released = false;

  return {
    isHolding() {
      return !released && lease.hasRef();
    },
    release() {
      if (released) return;
      released = true;
      lease.close();
      peer.close();
    },
  };
}

/** One plugin the resident loads, and the way it asks the Runtime to load it. */
export interface CompositionMember {
  readonly id: string;
  load(runtime: Runtime): Promise<PluginState>;
}

export type Composition = readonly CompositionMember[];

interface LoadedMember {
  readonly id: string;
  readonly state: PluginState;
}

// The production composition, in load order. The order is not decoration: a plugin's requirements
// are already satisfied by the time it is loaded, so what cannot run is left `waiting` rather than
// shuffled around, and the states read back here are the states an operator is shown.
//
// There are four legal compositions, and they are two independent branches:
//
//   base                       the nine members below
//   base + language            when --model-endpoint and --model were both given
//   base + Repository CI chain when --repository-root and --repository were both given
//   base + chain + language    when all four were given — Language last, and repository-aware
//
// Each is loaded if and only if its own pair was given, and neither given is the ordinary case: a
// resident with neither has no repository scope, needs no Git, no GitHub and no model, and starts
// normally. A half-given pair never reaches here at all, because `options.ts` refuses it as a
// configuration error rather than letting this function guess the other half.
//
// The fourth is where the two branches meet, and the only one whose shape could not be guessed from the
// other three: when a repository scope exists, the Language this file loads is not the same plugin the
// second composition loads. It is the same id, the same version and the same code with one more
// requirement and one more exposure, and selecting it is the whole of what this file decides about the
// variant.
//
// Language is added *after* the chain when both are configured, and that is a change from the order this
// function used to have. The old order put Language directly after the base and the chain last, which
// made the rosters *nested*: each was a literal prefix of the next larger one, on the argument that
// nothing depended on it yet and the day something did nobody would have to work out which order was the
// real one. Something depends on it now.
//
// The repository-aware Language variant requires `repository-ci-relevance.current@1`, which the last
// chain member provides, and a plugin whose requirements are not yet satisfied is recorded `waiting` —
// so placing Language first would not merely be untidy, it would make the resident refuse to start. The
// nesting is therefore given up deliberately, and for the reason it was worth keeping at all: a real
// dependency now decides the order. What is *not* given up, and is the part that was doing the work, is
// the property the nesting was a strong form of — the base nine are still the common prefix of all four
// compositions and keep their relative order in every one of them, which is to say the default roster is
// still a literal prefix of every larger one. What changes is only where the optional repository-aware
// reader sits: no longer directly after the base, but after the thing it reads.
//
// The Runtime was not touched to make this work, and must not be. It is the same `#requirementsSatisfied`
// and the same reconcile loop; ordering is this file's job, because this file is the only place that
// knows what was configured. Teaching the Runtime to keep an invariant of the *composition* would be
// moving a policy into the mechanism.
//
// Crucially, language still does not *replace* anything and does not gate anything: a resident with a
// model and no repository scope answers questions about the work focus and the desktop, and a resident
// with a repository scope and no model answers `relevance` and `observe` and refuses `ask` by saying
// there is no language entry point. Neither capability is a condition of the other, and neither is a
// condition of readiness for the rest.
//
// This is deliberately not a Profile system, a capability registry, an optional-plugin mechanism or
// a conditional-composition framework, and it should not become one. It is the local implementation
// of one product need — a human who has explicitly named a repository scope can ask whether a CI
// observation concerns the work focus they declared — and a general facility built ahead of a second
// such need would be an architecture layer invented for a need that has not arrived.
//
// The enabled composition is the base, then the chain, then Language — never an interleaved list. That
// satisfies both inbound dependencies in the only order that can: `repository-ci-relevance` requires
// `work-focus.current`, and `work-focus` is the last member of the base; the repository-aware Language
// requires `repository-ci-relevance.current`, and the relevance plugin is the last member of the chain.
// Nothing in the base requires anything from the chain, so the default composition loses nothing by
// omitting it.
//
// In particular the resident adds no subscriber of its own: `desktop-session-awareness-loop.assessed`
// has zero subscribers in production, and that is a property of the design rather than a gap for this
// file to fill.
//
// Chronicle is loaded because a resident without a durable fact history is not a Hikari that can
// remember anything, and its `active` state is a precondition for readiness. That is the whole of
// the relationship: this file never appends to it, never reads its store, and never turns an
// observed assessment into a fact. An Event is not a durable fact, and this is not the place where
// that equivalence gets invented.
//
// What this file may know about the Repository CI capability is exactly one thing: whether the
// configuration it asks for was provided. It does not know what a repository is, what CI is, whether
// two commit strings match, or what relevance means. Each chain member declares its own requires and
// provides and the Runtime reconciles them; hand-writing a call sequence here, or reading a value out
// of one member to decide what to load next, would be this file acquiring an opinion about the domain
// it composes — which is the one thing a composition role is not allowed to have.
//
// Exported for one reason: the rosters above are a claim about what a running Hikari is, and nothing
// else checked it. Every test of a roster used to run against a composition the test supplied itself,
// so dropping a member from this list left the suite green — on CI, entirely so, because every test
// that would have noticed needs a named pipe. Tests now read this function directly, one per legal
// composition.
export function productionComposition(options: ResidentOptions): Composition {
  const base: Composition = [
    {
      id: continuityPlugin.id,
      load: (runtime) => runtime.loadPlugin(continuityPlugin, { rootDir: options.dataDir }),
    },
    {
      id: chroniclePlugin.id,
      load: (runtime) => runtime.loadPlugin(chroniclePlugin, { rootDir: options.dataDir }),
    },
    { id: foregroundPlugin.id, load: (runtime) => runtime.loadPlugin(foregroundPlugin) },
    { id: inputActivityPlugin.id, load: (runtime) => runtime.loadPlugin(inputActivityPlugin) },
    {
      id: desktopSessionWorldPlugin.id,
      load: (runtime) => runtime.loadPlugin(desktopSessionWorldPlugin),
    },
    {
      id: desktopSessionAwarenessPlugin.id,
      load: (runtime) => runtime.loadPlugin(desktopSessionAwarenessPlugin),
    },
    {
      id: desktopSessionAwarenessLoopPlugin.id,
      load: (runtime) =>
        runtime.loadPlugin(desktopSessionAwarenessLoopPlugin, {
          delayMs: options.desktopAwarenessDelayMs,
        }),
    },
    // The exit of the perception chain, and the only place where anything above it can be read from
    // outside. Everything before it in this list perceives, composes or compares, and none of that
    // was ever visible; this member is what makes the chain answerable to a person, over an endpoint
    // it owns, without adding a fact or holding a state of its own.
    //
    // It sits here rather than after `work-focus` so that the order in this list is the order the
    // data moves: perceive, compose, compare, and then be readable. It requires the Awareness
    // read-without-consuming contract and nothing else — in particular not a World or a source,
    // because the assessment it reads already carries the whole snapshot, and a second acquisition
    // of the same instant would let its facts and its verdict describe two different moments. Not
    // `...current` either, and that half is what keeps a person's question from becoming the loop's
    // next comparison partner: a human looking must not move the timeline they are looking at.
    {
      id: desktopSessionObservePlugin.id,
      load: (runtime) => runtime.loadPlugin(desktopSessionObservePlugin, { rootDir: options.dataDir }),
    },
    // The last member of the base, and the one a person writes through rather than reads from: it is
    // where a person declares what they are working on, and the member above is where a person reads
    // what Hikari sees. It requires nothing, so its position costs nothing — but it is placed
    // deliberately rather than appended, because the day it grows a dependency the order will already
    // be the right one, and because the Repository CI chain, when it is loaded at all, is loaded
    // after it and requires exactly the contract it provides. Being in this composition is what gives
    // it the lifetime its endpoint needs: activated by the Runtime, torn down by the Runtime, gone
    // when the process is.
    {
      id: workFocusPlugin.id,
      load: (runtime) => runtime.loadPlugin(workFocusPlugin, { rootDir: options.dataDir }),
    },
  ];

  const model = options.model;
  const repositoryCi = options.repositoryCi;

  // The member shape is the same for both variants — same id, same four config values — and only the
  // *definition* differs. Building it once from a definition is what keeps the id and the configuration
  // from being able to differ between the two compositions that use it.
  const languageMember = (
    definition: PluginDefinition<LanguagePluginConfig>,
    model: ModelOptions,
  ): CompositionMember => ({
    id: definition.id,
    load: (runtime) =>
      runtime.loadPlugin(definition, {
        rootDir: options.dataDir,
        endpoint: model.endpoint,
        model: model.model,
        credentialEnv: model.credentialEnv,
        reasoningEffort: model.reasoningEffort,
      }),
  });

  if (repositoryCi === undefined) {
    // No repository scope, so no chain and no repository-aware Language. This is the composition every
    // build before this slice produced, unchanged.
    return model === undefined ? base : [...base, languageMember(languagePlugin, model)];
  }

  // The other branch. The two source plugins are configured with the two values that were given
  // together — a path and an `owner/name` — and nothing here checks that they describe the same
  // repository, because nothing here is entitled to: that correspondence is a judgement about two
  // sources, and the value that would establish it is a value no one has.
  //
  // The relevance plugin is configured with the *data directory* rather than the repository root,
  // because what it needs a path for is its own endpoint — which belongs to this resident, not to the
  // repository — and a client asking a question has the data directory and nothing else.
  const chain: Composition = [
    {
      id: gitRepositoryPlugin.id,
      load: (runtime) =>
        runtime.loadPlugin(gitRepositoryPlugin, { repositoryRoot: repositoryCi.rootDir }),
    },
    {
      id: gitHubCiPlugin.id,
      load: (runtime) => runtime.loadPlugin(gitHubCiPlugin, { repository: repositoryCi.repository }),
    },
    {
      id: repositoryCiWorldPlugin.id,
      load: (runtime) => runtime.loadPlugin(repositoryCiWorldPlugin),
    },
    {
      id: repositoryCiAwarenessPlugin.id,
      load: (runtime) => runtime.loadPlugin(repositoryCiAwarenessPlugin),
    },
    {
      id: repositoryCiRelevancePlugin.id,
      load: (runtime) =>
        runtime.loadPlugin(repositoryCiRelevancePlugin, { rootDir: options.dataDir }),
    },
  ];

  // Language last, and only here, because the variant chosen depends on whether the chain above is
  // present: a resident with a repository scope gets the repository-aware Language, which requires the
  // relevance contract the chain's last member provides. A resident with a repository scope and no
  // model gets the chain and no Language at all, for the same reason the branch above does: the plugin
  // cannot be configured without an endpoint and a model. Loading one anyway would not be the wrong
  // variant — in this composition both variants' requirements are satisfied, so either would come up
  // `active` — it would be a plugin with nothing to ask.
  return model === undefined
    ? [...base, ...chain]
    : [...base, ...chain, languageMember(repositoryLanguagePlugin, model)];
}

export interface ResidentIo {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

const PROCESS_IO: ResidentIo = {
  out: (text) => {
    process.stdout.write(text);
  },
  err: (text) => {
    process.stderr.write(text);
  },
};

export interface ResidentOverrides {
  readonly composition?: Composition;
  readonly io?: ResidentIo;
  readonly runtime?: Runtime;
  readonly createLease?: () => LifetimeLease;
  /** Replaced in tests; production always uses the real named-pipe listener. */
  readonly listenControl?: (host: ControlHost, path: string) => Promise<ControlEndpoint>;
}

export async function residentCommand(
  options: ResidentOptions,
  overrides: ResidentOverrides = {},
): Promise<CommandOutcome> {
  const io = overrides.io ?? PROCESS_IO;
  const runtime = overrides.runtime ?? new Runtime();
  const composition = overrides.composition ?? productionComposition(options);

  // Taken before anything can fail and released after everything else has, so that the process is
  // alive because this file says so for the entire span in which it is doing anything at all.
  const lease = (overrides.createLease ?? createLifetimeLease)();
  const signals = armTerminationSignals();
  const controlPath = controlEndpointPath(options.dataDir);

  let control: ControlEndpoint | undefined;
  let exitCode = 0;
  let failure = '';

  try {
    // Armed before the composition is loaded, not after it. Coming up is the window in which an
    // operator most needs to be able to ask what is happening, and on Windows it is the only window
    // in which the alternative is nothing at all: the host cannot deliver a graceful termination to
    // another process, so until this listener exists the only way to end a resident that will not
    // become ready is to kill it.
    if (controlPath !== undefined) {
      try {
        control = await (overrides.listenControl ?? listenControlEndpoint)(
          residentControlHost(runtime, composition, signals, options.model),
          controlPath,
        );
      } catch (error) {
        // A data directory owns exactly one endpoint and the operating system enforces that itself:
        // a second listener on the same pipe name fails with EADDRINUSE. So this is not a port
        // collision to work around, it is the answer to "is a resident already running here?" — and
        // the answer is yes.
        //
        // Refusing to start is the only honest response. A resident that carried on without an
        // endpoint would leave two processes loading the same composition and writing the same
        // store, while the control channel went on addressing whichever of them arrived first: a
        // `status` would describe one process and a `stop` would end the other.
        if (isAddressInUse(error)) {
          throw new Error(
            `数据目录已被另一个 Hikari 常驻占用：${options.dataDir}。` +
              '请先运行 hikari stop --data-dir <path> 停止它。',
          );
        }
        throw error;
      }
    }

    const loaded = await loadComposition(runtime, composition);

    if (!isReady(loaded)) {
      exitCode = 1;
      failure = renderNotReady(runtime, loaded);
    } else if (signals.isRequested()) {
      // A termination arrived while the composition was still coming up. This activation was asked
      // to stop before it ever reported ready, so it is not announced as started first.
      exitCode = 0;
    } else {
      io.out(READY_LINE);
      await signals.requested;
      io.out(STOPPED_LINE);
    }
  } catch (error) {
    exitCode = 1;
    failure = `${describeError(error)}\n`;
  } finally {
    // One ordering, on every path. The Runtime is taken down first, then the endpoint, then the
    // signal listeners, then the lease. Releasing the lease last is the point of the whole
    // arrangement: the resident owns the process lifetime for the whole of its own shutdown, so
    // disposal is never cut short by the process vanishing out from under it.
    try {
      await runtime.shutdown();
    } catch (error) {
      exitCode = 1;
      failure += `${describeError(error)}\n`;
    } finally {
      // The endpoint outlives the Runtime on purpose, and it stays reachable for exactly as long as
      // this process is a resident. That is what keeps ENOENT meaning "there is no resident" rather
      // than "not right now": a client that finds nothing is told something true about the world
      // instead of something true about timing. Shutdown has no fixed duration, so an endpoint
      // closed first would report absence for the whole of a teardown that is still happening.
      //
      // What is promised instead is that the endpoint is gone before the process is, and the await
      // here is that promise — the listener and every accepted connection are closed before the
      // lease is released and the event loop is allowed to run out.
      try {
        if (control !== undefined) await control.close();
      } catch (error) {
        exitCode = 1;
        failure += `${describeError(error)}\n`;
      } finally {
        signals.disarm();
        lease.release();
      }
    }
  }

  if (failure) io.err(failure);

  // This command streams. Readiness and stopping happen at points in time, so they are written when
  // they happen rather than returned as text a caller would print once the resident had already
  // stopped. The outcome carries the exit code alone.
  return { exitCode, stdout: '', stderr: '' };
}

async function loadComposition(
  runtime: Runtime,
  composition: Composition,
): Promise<readonly LoadedMember[]> {
  const loaded: LoadedMember[] = [];
  for (const member of composition) {
    loaded.push({ id: member.id, state: await member.load(runtime) });
  }
  return loaded;
}

// Ready means the composition holds and the loop is armed — nothing more. It is not a claim that the
// first assessment succeeded, that the background chain is healthy, or that any later acquisition
// will work. v1 has no public surface for those, and this predicate is not going to imply one.
//
// The empty case is called not-ready on purpose: a composition with nothing in it has nothing to be
// ready, and `every` on an empty list would otherwise say the opposite.
function isReady(loaded: readonly LoadedMember[]): boolean {
  return loaded.length > 0 && loaded.every((member) => member.state === 'active');
}

// The control channel, as this file understands it: two questions, both already answerable from what
// the Runtime holds. `status` reads it, `stop` asks for the same thing a signal asks for. Neither
// one reaches a plugin, and there is nothing here for a plugin to register with.
function residentControlHost(
  runtime: Runtime,
  composition: Composition,
  signals: TerminationSignals,
  model: ModelOptions | undefined,
): ControlHost {
  return {
    status: () => renderStatus(runtime, composition, signals.isRequested(), model),
    stop: () => signals.request(),
  };
}

// What `status` may say, and the whole of it: the states the Runtime reports and the errors it
// recorded, for the plugins this resident loaded. Nothing is probed, nothing is asked of the desktop
// and nothing is derived — a status line is a report of what is already known, not a health check,
// and this function has no way to learn anything the Runtime does not already have.
//
// The two line shapes differ on purpose. "This plugin is not loaded" and "the Runtime has no record
// of this plugin" are different answers, and only one of them is ever true; printing `undefined`, or
// borrowing the not-ready wording, would fold the second into the first.
function renderStatus(
  runtime: Runtime,
  composition: Composition,
  stopping: boolean,
  model: ModelOptions | undefined,
): readonly string[] {
  const lines: string[] = ['Hikari 常驻状态：'];

  // Why the language plugin is or is not in the roster, said in this resident's own configuration
  // terms. Without this, "there is no `language` line below" is the only thing an operator sees, and
  // the two very different reasons for it — the plugin was never configured, or it was configured and
  // did not load — would read the same. The member line still says the second one when it happens;
  // this says the first, which nothing else could.
  //
  // The credential is reported as a variable *name* and never as a value, and that is not a display
  // choice: the secret is read by the plugin at activation and this file has never held it, so there
  // is nothing here that could print it even by mistake. What is said is which variable the operator
  // pointed at, which is what an operator checking their own configuration actually needs.
  // These three lines are the only place in this file that prints a string the operator typed, and
  // they are escaped for the reason every other user-visible line in this slice is: a value is one
  // line, and a value carrying a line break or an escape sequence must not be able to add a line of
  // its own to a report an operator reads to find out what their resident is doing. It is their own
  // argument, so the cost of not escaping is theirs — but a status line that can be made to say
  // something this resident did not say is the one thing a status line may not be.
  if (model === undefined) {
    lines.push('语言插件未加载：本常驻启动时没有同时给出 --model-endpoint 与 --model。');
  } else {
    lines.push(`语言插件模型端点：${oneLine(model.endpoint)}`);
    lines.push(`语言插件模型：${oneLine(model.model)}`);
    lines.push(
      model.credentialEnv === undefined
        ? '语言插件凭据：无（请求不带凭据）'
        : `语言插件凭据：来自环境变量 ${oneLine(model.credentialEnv)}`,
    );
    // Reported for the reason the two lines above are: this is what the resident will actually put on
    // the wire, and the absence of the field is as much a fact about the request as the endpoint is —
    // an operator who configured an effort and reads "不带" here has found their mistake without
    // having to watch a request go out.
    lines.push(
      model.reasoningEffort === undefined
        ? '语言插件 reasoning effort：不带（请求里没有这个字段）'
        : `语言插件 reasoning effort：${oneLine(model.reasoningEffort)}`,
    );
  }

  // Termination is a state a resident is really in, and one an operator most needs to see: during
  // shutdown this endpoint is still reachable by design and the plugins still read `active`, so
  // without this line a status taken mid-teardown would describe a healthy resident that is already
  // on its way out.
  if (stopping) lines.push('Hikari 常驻正在停止。');

  for (const member of composition) {
    const state = runtime.getPluginState(member.id);
    if (state === undefined) {
      lines.push(`${member.id}：Runtime 中没有这个插件的记录`);
      continue;
    }

    lines.push(`${member.id} 状态：${state}`);
    appendFailure(lines, member.id, runtime.getPluginError(member.id));
  }

  return lines;
}

// The states say what happened; only the Runtime's recorded error says why. Both are reported,
// because `failed` and `waiting` call for different actions from whoever is reading this, and a host
// without the platform capability is not the same situation as a Hikari that was never initialized.
//
// One helper for both renderers so that the same error is described the same way whether it is read
// off a resident that never started or off one that is running. A second copy of this would be a
// second answer to the same question, and the two would drift.
function appendFailure(lines: string[], id: string, error: unknown): void {
  if (error === undefined) return;

  lines.push(`${id}：${describeError(error)}`);
  if (error instanceof NotInitializedError) lines.push(INIT_HINT);
  if (error instanceof ChronicleNotInitializedError) lines.push(CHRONICLE_INIT_HINT);
}

function renderNotReady(runtime: Runtime, loaded: readonly LoadedMember[]): string {
  const lines = ['Hikari 常驻未启动：感知组合未全部就绪。'];
  for (const member of loaded) lines.push(`${member.id} 状态：${member.state}`);
  for (const member of loaded) appendFailure(lines, member.id, runtime.getPluginError(member.id));

  return `${lines.join('\n')}\n`;
}

interface TerminationSignals {
  readonly requested: Promise<void>;
  isRequested(): boolean;
  /**
   * Asks for the same thing a signal asks for. Idempotent: a request that was already made is not
   * made again, which is what lets it be reachable from more than one place without counting.
   */
  request(): void;
  /** Removes the listeners. Idempotent, and synchronous by contract. */
  disarm(): void;
}

// Termination is a request, not an exit. The first signal does the smallest possible thing: it makes
// the request observable, and it takes the listeners back off. Everything after that is ordinary
// shutdown work, which is why the second Ctrl+C no longer belongs to Hikari — with no listener left
// the host's default handling applies, and an operator who wants to be gone immediately gets that.
//
// Nothing here calls `process.exit`, and nothing here races the shutdown it just asked for: a hard
// kill is a policy this file does not have, and inventing one would be inventing a way for the
// Runtime's cleanup ordering to be abandoned half-done.
//
// The control channel asks through `request()` rather than getting a path of its own. There is one
// termination in this file — one promise to settle, one set of listeners to take off, one place
// where "someone asked this process to stop" becomes observable — so a request that arrived over a
// pipe and a request that arrived as a signal are not two behaviours that have to be kept in step,
// they are the same one.
function armTerminationSignals(): TerminationSignals {
  let requested = false;
  let settle: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    settle = resolve;
  });

  function disarm(): void {
    process.off(SIGINT, request);
    process.off(SIGTERM, request);
  }

  function request(): void {
    if (requested) return;
    disarm();
    requested = true;
    settle();
  }

  process.on(SIGINT, request);
  process.on(SIGTERM, request);

  return { requested: promise, isRequested: () => requested, request, disarm };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAddressInUse(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'EADDRINUSE';
}
