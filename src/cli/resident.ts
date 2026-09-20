// `hikari resident` — the composition root for a long-running Hikari.
//
// What this file owns:
//   which process is the Hikari      — it creates the Runtime and loads the plugins into it
//   what "ready" means               — every plugin in the composition reported `active`
//   when the process lifetime ends   — a lease it holds itself, released only after shutdown
//   what an operator is told         — readiness, capability, and the exit code
//
// What this file deliberately does not own:
//   plugin lifecycle, dependency reconciliation, unload and cleanup ordering — the Runtime owns all
//   of that, and this module never takes a plugin down itself, never reads a plugin's internals and
//   never reorders a teardown the Runtime is already sequencing.
//
// Resident is a composition role, not a subsystem: no plugin is added for it, no service or event is
// defined for it, and it holds no domain state. Everything it knows about Hikari it learns from the
// states the Runtime reports and from the errors the Runtime recorded.

import { MessageChannel } from 'node:worker_threads';

import { ChronicleNotInitializedError, chroniclePlugin } from '../chronicle/index.js';
import { NotInitializedError, continuityPlugin } from '../continuity/index.js';
import { desktopSessionAwarenessPlugin } from '../desktop-session-awareness/index.js';
import { desktopSessionAwarenessLoopPlugin } from '../desktop-session-awareness-loop/index.js';
import { desktopSessionWorldPlugin } from '../desktop-session-world/index.js';
import { foregroundPlugin } from '../foreground/index.js';
import { inputActivityPlugin } from '../input-activity/index.js';
import { Runtime } from '../index.js';
import type { PluginState } from '../index.js';
import {
  CHRONICLE_INIT_HINT,
  INIT_HINT,
  type CommandOutcome,
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
// Exactly seven plugins, and nothing else. In particular the resident adds no subscriber of its own:
// `desktop-session-awareness-loop.assessed` has zero subscribers in production, and that is a
// property of the design rather than a gap for this file to fill.
//
// Chronicle is loaded because a resident without a durable fact history is not a Hikari that can
// remember anything, and its `active` state is a precondition for readiness. That is the whole of
// the relationship: this file never appends to it, never reads its store, and never turns an
// observed assessment into a fact. An Event is not a durable fact, and this is not the place where
// that equivalence gets invented.
function productionComposition(options: ResidentOptions): Composition {
  return [
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
  ];
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

  let exitCode = 0;
  let failure = '';

  try {
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
    // One ordering, on every path. The Runtime is taken down first, then the signal listeners go,
    // then the lease. Releasing the lease last is the point of the whole arrangement: the resident
    // owns the process lifetime for the whole of its own shutdown, so disposal is never cut short by
    // the process vanishing out from under it.
    try {
      await runtime.shutdown();
    } catch (error) {
      exitCode = 1;
      failure += `${describeError(error)}\n`;
    } finally {
      signals.disarm();
      lease.release();
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

function renderNotReady(runtime: Runtime, loaded: readonly LoadedMember[]): string {
  const lines = ['Hikari 常驻未启动：感知组合未全部就绪。'];
  for (const member of loaded) lines.push(`${member.id} 状态：${member.state}`);

  // The states say what happened; only the Runtime's recorded error says why. Both are reported,
  // because `failed` and `waiting` call for different actions from whoever is reading this, and a
  // host without the platform capability is not the same situation as a Hikari that was never
  // initialized.
  for (const member of loaded) {
    const error = runtime.getPluginError(member.id);
    if (error === undefined) continue;

    lines.push(`${member.id}：${describeError(error)}`);
    if (error instanceof NotInitializedError) lines.push(INIT_HINT);
    if (error instanceof ChronicleNotInitializedError) lines.push(CHRONICLE_INIT_HINT);
  }

  return `${lines.join('\n')}\n`;
}

interface TerminationSignals {
  readonly requested: Promise<void>;
  isRequested(): boolean;
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
function armTerminationSignals(): TerminationSignals {
  let requested = false;
  let settle: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    settle = resolve;
  });

  function disarm(): void {
    process.off(SIGINT, onSignal);
    process.off(SIGTERM, onSignal);
  }

  function onSignal(): void {
    disarm();
    requested = true;
    settle();
  }

  process.on(SIGINT, onSignal);
  process.on(SIGTERM, onSignal);

  return { requested: promise, isRequested: () => requested, disarm };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
