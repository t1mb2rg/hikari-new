// Which window a read is about, and the whole of the rule that decides it.
//
// This module is pure. Nothing here launches a process, reads a property, or knows what a window is
// beyond the fields it was handed — which is deliberate, because the rule below is the part of this
// slice that a reviewer has to be able to check on any platform, and the part that the acquisition
// cannot be trusted to enforce on its own behalf.
//
// ---------------------------------------------------------------------------------------------
// Why the target is not chosen at read time
// ---------------------------------------------------------------------------------------------
//
// The reviewed design (§3.4) had this plugin perform one `GetForegroundWindow` when a read was asked
// for. Check A of the implementation mandate asked that the *time* semantics of that be settled
// first, and the answer is that a read-time foreground read cannot answer the question a human is
// asking.
//
// Measured on this machine, before any of this was written: Hikari has no top-level window. The TUI
// is drawn inside the terminal that hosts it, so the window in front when `hikari content status`
// runs is the console the human typed the command into — never the window they were reading a moment
// earlier. A read-time `GetForegroundWindow` would therefore have reported the terminal's own
// contents, at the moment Hikari was being addressed through it. That is not a stale answer; it is
// the wrong window, chosen with confidence.
//
// So the target is recorded instead: this plugin subscribes to the assessment occurrence the
// awareness loop already publishes, and takes its own window-identity sample on each one. What a read
// then uses is the most recent sample Hikari can honestly attribute to the human. The CLI's arrival
// cannot be sampled at all, because nothing samples it.
//
// ---------------------------------------------------------------------------------------------
// What "can honestly attribute" means, and what it is not
// ---------------------------------------------------------------------------------------------
//
// A sample is admissible when Hikari can say the window is *not one of its own surfaces*:
//
//   * the handle is non-zero — there is a window at all;
//   * the owning process is known — a name that could not be read is not evidence of anything, and
//     this rule fails closed rather than admitting a window it cannot classify;
//   * the owning process is not a terminal host and not Hikari's own desktop application.
//
// The terminal exclusion is the load-bearing one and it is the one to be honest about. It is a
// *name-based approximation*, not an identity: an unknown terminal emulator is not in the list and
// would be sampled. It is written this way because the alternative — resolving "is this process the
// console Hikari is being run in" — has no reliable answer from inside a resident, and inventing a
// process-identity mechanism to answer it is a larger thing than this slice is allowed to build.
// What makes the approximation safe rather than merely convenient is §3.4's third guard: the result
// carries the window it read, so a consumer can check the attribution rather than trust it.
//
// Nothing here ranks windows, searches for one, or prefers the largest. §3.5's window-selection
// problem — many windows, pick one — is not this slice's, and a rule that scored candidates would be
// the first half of it.

import type { WindowIdentity } from './types.js';

/**
 * One window-identity sample, as the probe reports it.
 *
 * It never crosses the wire: what a client receives is a `WindowIdentity` derived from it. The
 * numeric handle is kept here and formatted once, on the way out, so the digits a human reads are
 * produced in exactly one place.
 */
export interface WindowSample {
  readonly handle: number;
  readonly title: string | null;
  readonly processName: string | null;
  /**
   * The process the handle pointed at when the sample was taken.
   *
   * Carried for one reason and it is not classification: a read re-reads this before and after the
   * walk, so that a handle which closed and was recycled onto a different window is reported rather
   * than read. §3.4's first attribution guard, and it needs the value the *sample* saw, not the one
   * the read would find.
   */
  readonly processId: number | null;
  /** The timestamp of the observation, not of any read that later uses it. */
  readonly observedAt: string;
}

export const CONTENT_READ_WINDOW_SOURCE = 'desktop-content-read.windows-probe' as const;

/**
 * The processes whose windows Hikari is drawn in.
 *
 * Two kinds, and they are different kinds. The first group is the console hosts: Hikari's CLI and TUI
 * are drawn by whichever terminal the human ran them in, so the window in front while a human is
 * addressing Hikari belongs to one of these. The second is Hikari's own desktop application, which
 * owns a window of its own.
 *
 * A list, and therefore incomplete — see the header. Compared lower-cased, because Windows process
 * names are not case-sensitive and a comparison that was would be a comparison that sometimes
 * admitted `WindowsTerminal`.
 */
const HIKARI_SURFACE_PROCESS_NAMES: ReadonlySet<string> = new Set([
  'windowsterminal',
  'windowsterminalpreview',
  'openconsole',
  'conhost',
  'cmd',
  'powershell',
  'pwsh',
  'mintty',
  'alacritty',
  'wezterm',
  'humansurface',
]);

/**
 * Whether this sample may be used as the target of a read.
 *
 * The three conditions are in the header. None of them is a preference, and each fails closed: an
 * unreadable process name is rejected rather than treated as "probably not Hikari".
 */
export function isAdmissibleSample(sample: WindowSample): boolean {
  if (!Number.isSafeInteger(sample.handle) || sample.handle <= 0) return false;
  // A name that is null *or blank* is not a known name. `null` is the probe saying it could not read
  // one and `''` is the probe saying it read one that is empty; neither is evidence about what the
  // window is, and a blank string is not a name any real process has. Both are rejected, because the
  // rule fails closed: the alternative is a comparison against the exclusion list that a blank name
  // passes by not matching rather than by being known not to be Hikari's.
  if (sample.processName === null || sample.processName.trim().length === 0) return false;
  return !HIKARI_SURFACE_PROCESS_NAMES.has(sample.processName.toLowerCase());
}

/**
 * The sample a read would use: the most recent admissible one Hikari recorded.
 *
 * Ordering is by the sample's own observation time rather than by arrival, because the probe runs
 * detached from the occurrence that triggered it (see `plugin.ts`) and two probes can therefore be in
 * flight across the lifetime of one cadence. Arrival order would then be an ordering of *this
 * plugin's* scheduling rather than of what Hikari saw, and the timestamp is the only thing in the
 * sample that is a fact about the desktop.
 */
export function latestAdmissibleSample(
  samples: readonly WindowSample[],
): WindowSample | undefined {
  let latest: WindowSample | undefined;
  for (const sample of samples) {
    if (!isAdmissibleSample(sample)) continue;
    if (latest === undefined || sample.observedAt > latest.observedAt) latest = sample;
  }
  return latest;
}

/** The window identity a result carries. Formatted here, so the hex spelling exists once. */
export function toWindowIdentity(sample: WindowSample): WindowIdentity {
  return Object.freeze({
    handle: `0x${sample.handle.toString(16).toUpperCase().padStart(16, '0')}`,
    title: sample.title,
    processName: sample.processName,
    observedAt: sample.observedAt,
    source: CONTENT_READ_WINDOW_SOURCE,
  });
}
