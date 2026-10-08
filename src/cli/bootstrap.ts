// `hikari` — the launch path. The outermost layer of this build, and the only one that answers a
// question nobody asked.
//
// What this file owns: which data directory the bare word `hikari` means, whether a resident is
// already answering there, and — when one is not — starting the resident whose configuration is
// already in that directory, before handing the screen to the TUI. What it does not own: the
// resident, its lifetime, what its configuration means, or anything the TUI draws. Every mechanism
// below is an existing one called in an existing order: `requestControl` is the discovery
// `hikari status` does, `readLaunchProfile` is the read the TUI's own `/start` does, and
// `spawnDetached` is the detached spawn `/start` does. There is no second process model, no
// supervisor, no launcher that stays running, and no state that outlives this call.
//
// Three orderings here are load-bearing, and none of them is an accident:
//
//   * The terminal comes first. A console with no TTY is refused before anything is resolved or
//     started, so `hikari > file` neither draws control codes nor leaves a resident behind that
//     nobody asked for. That is why the check is one function this file and `tuiCommand` both call
//     rather than one sentence copied into each.
//
//   * `--data-dir` comes before the default, because a human naming a directory is saying *which*
//     Hikari and the default is this build answering a question they did not answer. What that
//     answer is, and what it deliberately is not, is `defaultResidentDataDir`'s own comment.
//
//   * A resident that already answers is never started again. A fresh status read is the whole of
//     the concurrency protection at this layer, and it is the same one `/start` uses; behind it,
//     endpoint names are derived from the data directory, so two residents cannot hold one — the
//     worst a race here can produce is a second process that exits immediately.
//
// What a failure may not be is a silent one. `spawnDetached` gives up the child's pipes on purpose,
// so a resident that dies during bring-up says nothing to this process — which is why the launch
// path waits on the resident's own control channel before it hands over a screen. A window onto a
// resident that never arrived, presented as success, is the one outcome this layer cannot produce.

import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { oneLine } from '../terminal-text/index.js';
import { requestControl, type ControlOutcome, type ControlRequest } from './control.js';
import {
  launchArguments,
  launchProfilePath,
  readLaunchProfile,
  renderLaunchArguments,
  type LaunchProfile,
} from './launch-profile.js';
import type { CommandOutcome, TuiOptions } from './options.js';
import { spawnDetached, terminalRequired, tuiCommand } from './tui.js';

/**
 * The data directory the bare word `hikari` means, or `undefined` when this build has no answer.
 *
 * Windows hands every process the current user's application directory in `LOCALAPPDATA`, and
 * `Hikari\resident` under it is this build's own — chosen once, spelled the same way on every run,
 * and derived from nothing but the platform. It is not a search: no sibling is scanned, no "last
 * used" is remembered, and no file outside the data directory can point somewhere else. What it
 * replaces is a question rather than a decision — a human who names `--data-dir` has said which
 * Hikari they mean, and this never overrules them.
 *
 * Everywhere but Windows the answer is `undefined`, and that is the whole of this round's cross-
 * platform position: `hikari` there behaves exactly as it did before, which is the TUI asking. A
 * platform with no answer is not a failure — it is the absence the TUI has always handled.
 */
export function defaultResidentDataDir(
  platform: string,
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  if (platform !== 'win32') return undefined;

  const base = env.LOCALAPPDATA;
  if (base === undefined || base.trim() === '') return undefined;

  return join(base, 'Hikari', 'resident');
}

/**
 * What a launch is wired to. Each member is an existing function in the ordinary build.
 *
 * The interface exists for the reason `Composition` exists in `resident.ts`: the real build passes
 * the real functions and nothing here second-guesses them, while a test that needs to see a launch
 * fail can arrange exactly that instead of arranging for a real resident to fail.
 */
export interface BootstrapDependencies {
  readonly control: (dataDir: string, request: ControlRequest) => Promise<ControlOutcome>;
  readonly launch: (
    args: readonly string[],
    onExit: (code: number | null) => void,
  ) => string | undefined;
  readonly enterTui: (options: TuiOptions) => Promise<CommandOutcome>;
}

export const productionBootstrap: BootstrapDependencies = {
  control: requestControl,
  launch: spawnDetached,
  enterTui: tuiCommand,
};

export function bootstrapCommand(options: TuiOptions): Promise<CommandOutcome> {
  return bootstrap(options, productionBootstrap);
}

/**
 * `hikari` with nothing after it.
 *
 * The sequence is the whole product claim, in order: refuse without a terminal, resolve the
 * directory, ask whether a resident is there, and — only when nothing answers and a configuration
 * exists — start one and wait for it. Every branch that does not reach the TUI says why in the
 * operator's own terms and exits non-zero; none of them starts something and then reports success.
 */
export async function bootstrap(
  options: TuiOptions,
  dependencies: BootstrapDependencies,
): Promise<CommandOutcome> {
  const refusal = terminalRequired();
  if (refusal !== undefined) return refusal;

  const dataDir = options.dataDir ?? defaultResidentDataDir(process.platform, process.env);
  // Nobody expressed a directory and this build has none to offer, so the question the TUI asks is
  // the only honest next step — and it is exactly what this surface did before a default existed.
  if (dataDir === undefined) return dependencies.enterTui({ dataDir: undefined });

  // Anything but `absent` means something is holding this data directory's control channel: a
  // resident that is running, or a name this process may not use. Neither is a licence to start a
  // second one, and `enterTui` is where those states are shown for what they are.
  const answer = await dependencies.control(dataDir, 'status');
  if (answer.kind !== 'absent') return dependencies.enterTui({ dataDir });

  const read = readLaunchProfile(dataDir);
  if (read.kind === 'none') return unconfigured(dataDir);
  if (read.kind === 'unreadable') return unreadableProfile(dataDir, read.reason);

  const commandLine = renderLaunchArguments(launchArguments(dataDir, read.profile));
  const arrival = await launchAndAwait(dataDir, read.profile, dependencies);
  if (arrival.kind !== 'started') return launchFailure(dataDir, arrival, commandLine);

  return dependencies.enterTui({ dataDir });
}

export interface LaunchBudget {
  readonly waitMs: number;
  readonly pollMs: number;
}

// How long the wait below may last, and how often it asks. This is a bound on a wait rather than a
// guess at how long bring-up takes — the same shape as the TUI's own restart wait, and for the same
// reason: the loop leaves on evidence, so a resident that answers in 700ms costs 700ms.
const START_BUDGET: LaunchBudget = { waitMs: 15_000, pollMs: 250 };

/** How the wait ended. Only `started` is a resident this layer may hand a screen to. */
export type LaunchOutcome =
  | { readonly kind: 'started' }
  | { readonly kind: 'spawn-failed'; readonly detail: string }
  | { readonly kind: 'exited'; readonly code: number | null }
  | { readonly kind: 'timed-out'; readonly waitedMs: number };

/**
 * Start the configured resident, then wait for it to answer its own control channel.
 *
 * The wait is the substance of this function, not decoration around the spawn. `spawnDetached` has
 * no pipe to the child by design, so a resident that dies during bring-up cannot say so here; the
 * only thing this process can observe is whether the resident's own endpoint started answering, and
 * whether the process it started is still there — which is what `onExit` is for, and it is the
 * difference between "slow" and "gone".
 *
 * Four outcomes, three of them failures, and none of them inferred: an answer is the resident's own
 * word for being up, a missing process is the platform's word for it being over, and the bound is
 * this layer's own admission that it stopped looking. Nothing here guesses why a resident died — a
 * process that never spoke to this one has no reason to give it.
 *
 * Exported for the reason `spawnDetached` is: two of these outcomes are states only a real resident
 * reaches, and reaching one for real takes seconds, so the bound is a parameter rather than a
 * constant buried in the loop.
 */
export async function launchAndAwait(
  dataDir: string,
  profile: LaunchProfile,
  dependencies: BootstrapDependencies,
  budget: LaunchBudget = START_BUDGET,
): Promise<LaunchOutcome> {
  // `exited` is written by the child's own exit callback and read by the loop below. It stays
  // `undefined` exactly as long as the process is alive, and that is the only state meaning "keep
  // waiting": an exit code of zero is a resident that stopped, not one that arrived.
  let exited: number | null | undefined;
  const spawned = dependencies.launch(launchArguments(dataDir, profile), (code) => {
    exited = code;
  });
  if (spawned !== undefined) return { kind: 'spawn-failed', detail: spawned };

  const deadline = Date.now() + budget.waitMs;
  for (;;) {
    // The channel is asked before the bound is checked, so an answer that arrives on the last poll
    // is a resident that arrived. The bound is on how long this waits, not on how quickly the
    // resident is allowed to speak.
    const answer = await dependencies.control(dataDir, 'status');
    if (answer.kind === 'answered') return { kind: 'started' };
    // Checked after the answer for the same reason and one more: a process that exited while still
    // holding an endpoint could otherwise be read as one that came up.
    if (exited !== undefined) return { kind: 'exited', code: exited };
    if (Date.now() >= deadline) return { kind: 'timed-out', waitedMs: budget.waitMs };

    await delay(budget.pollMs);
  }
}

// Every message below names the data directory, because the operator typed `hikari` and did not type
// this path: without it, "there is no launch profile" would be a statement about a directory they
// cannot see. The commands are spelled with the directory given, so that they can be pasted back.

// The unconfigured state, and it is a state rather than an error: nothing is broken, and the two
// things that are missing are the operator's to give. What it deliberately does not do is offer to
// fill them in — §1's "no guessing" covers the endpoint and the model, and a resident started on a
// half-guessed configuration would be this layer inventing a Hikari rather than the operator's.
function unconfigured(dataDir: string): CommandOutcome {
  return {
    exitCode: 1,
    stdout: '',
    stderr: [
      `数据目录：${dataDir}`,
      `这个数据目录还没有启动配置：${launchProfilePath(dataDir)}`,
      '',
      'Hikari 不会替你猜模型端点、模型名或凭据，也不会用一份不完整的配置启动常驻。',
      '请先用现有的命令准备好它，再运行 hikari：',
      `  hikari init --data-dir "${dataDir}"`,
      `  hikari chronicle init --data-dir "${dataDir}"`,
      `  hikari profile set --data-dir "${dataDir}" [与 hikari resident 相同的选项]`,
      '',
    ].join('\n'),
  };
}

// A profile that exists and cannot be read is a different state from no profile at all, and the file
// is named so that the operator can open it: the reason comes from the reader and is not restated
// here, because a second explanation of the same malformed file would be a second thing to keep true.
function unreadableProfile(dataDir: string, reason: string): CommandOutcome {
  return {
    exitCode: 1,
    stdout: '',
    stderr: [
      `数据目录：${dataDir}`,
      `启动配置无法读取：${oneLine(reason)}`,
      `文件：${launchProfilePath(dataDir)}`,
      `请修正它，或者重写一次：hikari profile set --data-dir "${dataDir}" [与 hikari resident 相同的选项]`,
      '',
    ].join('\n'),
  };
}

// The three failures, each said for what it is and nothing more. The distinction between them is
// what the operator does next: a spawn that failed is a broken command line or a missing runtime, a
// process that exited is a resident that refused to come up and can be run in the foreground to be
// watched, and a bound that expired is a resident that may still be arriving.
function launchFailure(
  dataDir: string,
  arrival: Exclude<LaunchOutcome, { kind: 'started' }>,
  commandLine: string,
): CommandOutcome {
  const lines: string[] =
    arrival.kind === 'spawn-failed'
      ? [arrival.detail]
      : arrival.kind === 'exited'
        ? [
            `常驻进程退出了（退出码 ${arrival.code === null ? '未知' : String(arrival.code)}），没有应答控制通道。`,
            '它启动在另一个进程里，输出不会回到这里。要看它的输出，就在前台运行同一条命令：',
            `  ${commandLine}`,
          ]
        : [
            `常驻进程在 ${Math.round(arrival.waitedMs / 1000)} 秒内没有应答控制通道，所以这次没有进入 TUI。`,
            `它可能还在启动；稍后再看它是否应答：hikari status --data-dir "${dataDir}"`,
          ];

  return { exitCode: 1, stdout: '', stderr: [`数据目录：${dataDir}`, ...lines, ''].join('\n') };
}
