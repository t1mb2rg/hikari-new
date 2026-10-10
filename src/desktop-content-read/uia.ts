// The bounded UIA walk, and the four things it is not allowed to do.
//
// The walk is `src/desktop-content-read/target.ts`'s window and nothing else: a handle is handed in,
// the walk is addressed to that handle, and no element is ever obtained from anywhere but that
// handle's tree.
//
//   It does not use `AutomationElement.FocusedElement`. The ground truth measured that call as
//   globally scoped — it answers with whatever the human has focused in any process on the desktop,
//   regardless of the handle a reader is asking about — and fidelity §3.4 measured it returning
//   another application's text. It is the obvious shortcut for "the thing the user is looking at",
//   and it is the one thing that would make the attribution in the result a lie. There is no
//   `FocusedElement` reference in this module, and `test/desktop-content-read.test.mjs` asserts that
//   by source as well as by behaviour.
//
//   It does not fall back between channels. An element whose `TextPattern` is available but empty
//   contributes no `text` node; its `Name` is read as a `name` node if it has one, on its own terms.
//   Substituting one for the other would make the channel field a description of where the reader
//   looked rather than of where the string came from, and the ground truth's counter-intuitive
//   finding — that on WPF the `Name` property *is* body text — is exactly why the two must stay
//   distinguishable rather than be merged.
//
//   It does not choose a walker per element or per application. One walker for the whole walk
//   (`ControlViewWalker`, recorded in `WALKER` below), because §3.5 records that the walker *is* the
//   string set: groundtruth measured the three views returning the same markers on a controlled WPF
//   window and fidelity measured them differing on real applications, so a walk that switched would
//   be a walk whose result is not comparable to itself.
//
//   It does not decide what is visible in pixels. `viewportRelation` is derived from UIA geometry,
//   and §3.7's capability-gap text — carried outward by `presentation.ts` — says so. An element that
//   only changed its rendering (`Opacity=0`, occlusion, GPU compositing) has no UIA property that
//   distinguishes it, is reported `inside`, and that is a gap rather than a bug.
//
// ---------------------------------------------------------------------------------------------
// The visibility derivation, and the one place it is weaker than the measurement
// ---------------------------------------------------------------------------------------------
//
// The rule is the ground truth's R2, which was the only candidate of three to survive scoring:
//
//     intersect(element rect, nearest ScrollPattern-ancestor rect) > 0  ∧  IsOffscreen = false
//
// with the window's client area standing in when no such ancestor exists. The three-valued relation
// this module reports is that rule's positive case split at its edges: fully inside the frame is
// `inside`, some of it inside is `partial`, none of it is `outside`, and a rect that could not be
// read is `unknown`.
//
// How the frame is found differs in two ways, and both were measured rather than reasoned about.
//
// 1. Which predicate. The ancestor lookup uses ScrollPattern availability, and there are three ways
//    to ask for it. They do not agree. `AutomationElementInformation.IsScrollPatternAvailable` — the
//    obvious convenience property — was measured returning false for all 2352 raw-view elements of a
//    live Chromium window, with no read failures, while the two other methods both found 58. Using it
//    silently disabled scroll framing altogether: every region fell back to the client area, which is
//    the R1 rule the ground truth scored at 7 wrong. This walk therefore reads through
//    `GetCurrentPropertyValue(IsScrollPatternAvailableProperty)` — the accessor the 135/136 scoring
//    itself used (ground-truth `probe.ps1:107`) — and an eager `TryGetCurrentPattern` agreed with it
//    on every one of the 58 hits. `Name` and `IsOffscreen` read fine off the same struct, so the
//    breakage is specific to the Is*PatternAvailable members.
//
// 2. Which view. The 135/136 scoring looked the ancestor up with the *raw* view, while this walk
//    descends with the control view and re-frames on the way down. Measured scrollable counts,
//    control vs raw: Code 52/83, msedge 20/58, ChatGPT 13/37 — the control view does expose the
//    principal scrollable `Document`, and it reports the *same bounding rect* as the raw view's
//    (msedge: `356,106,2200,1330` at both depths 10 and 11). The raw-only extras are nearer
//    duplicates, several of them slivers (`1649,6,18,23`). So the divergence is real but narrow: where
//    the control view does not expose a nearer container this walk keeps the outer frame, whereas the
//    scored rule would take the nearer, smaller one. A larger frame reports `inside` where the rule
//    would say `outside`, and vice versa — the direction is not fixed, and this walk's agreement with
//    the 135/136 score was not itself scored. The alternative — an ancestor walk per matched element
//    — is thousands of extra cross-process calls inside a walk that already takes hundreds of ms.
//
// Both are written down rather than closed. Neither is a reason to distrust `viewportRelation` as an
// answer to "what UIA's geometry says"; both are reasons not to read it as pixel visibility (§3.7).

import { execFile } from 'node:child_process';
import type { ChildProcess, ExecFileException } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { DesktopContentReadError } from './errors.js';
import type { ContentRead, ContentReadBounds, Region, WindowIdentity } from './types.js';
import {
  READ_MAX_CHARS,
  READ_MAX_DEPTH,
  READ_MAX_NODES,
} from './types.js';
import type { WindowSample } from './target.js';

const WINDOWS_PLATFORM = 'win32';
const POWERSHELL_EXECUTABLE = 'powershell.exe';
const MAX_READ_OUTPUT_BYTES = 4 * 1024 * 1024;

/**
 * The walk script, as a file beside this module.
 *
 * Resolved from this module's own URL rather than from the working directory, because a resident is
 * not started from the package root. `scripts/copy-build-assets.mjs` puts the file in `dist/`, so
 * this path exists wherever the compiled module does.
 */
const WALK_SCRIPT = fileURLToPath(new URL('./walk.ps1', import.meta.url));

// The bound on the whole walk, subprocess included. A window that does not answer is `refused`, and
// `refused` is a different answer from `empty` — see `types.ts`. It is deliberately longer than the
// fidelity report's slowest measurement (2670 ms for a raw-view walk of one window) because a slow
// window is not a refusing one, and shorter than the client's own bound on the far side of the pipe
// so that a read which is going to fail fails where the reason is known.
const READ_TIMEOUT_MS = 20_000;

/** §3.5's "walker fixed and recorded". Named here so the recording is a value and not a sentence. */
export const WALKER = 'ControlViewWalker' as const;

/** The client area's region id, used when no scrollable ancestor was present in the walk. */
const CLIENT_AREA_ID = 'window-client-area';

/** The id used when a scroll container's own identity could not be read from UIA. */
const UNIDENTIFIED_CONTAINER_ID = 'scroll-container';

// The one tolerance in the derivation, and it exists because "fully inside" is being asked of two
// rectangles that were never integers. UIA reports device-independent doubles, and an element laid
// out to its container's edge can come back a fraction of a pixel over it. Without this, ordinary
// layout would be reported as `partial`; with it, a genuine overhang of one pixel is. Stated as a
// number because the alternative — rounding both rects first — moves the same boundary to a
// different place and hides the decision.
const EDGE_TOLERANCE = 1.0;

/**
 * What one walk produced, before the five kinds are chosen.
 *
 * The kinds are chosen in TypeScript, not here, because that choice is a pure function of these
 * numbers and a pure function can be tested on every platform. This type is the boundary between the
 * two: everything above it is Windows, everything below it is not.
 */
export type ContentReadWalk =
  | {
      readonly kind: 'walked';
      readonly readAt: string;
      readonly regions: readonly Region[];
      readonly counted: WalkCounts;
    }
  /** The handle did not address a window this process could read. */
  | { readonly kind: 'unreadable'; readonly reason: string }
  /** The window exists but did not answer. */
  | { readonly kind: 'refused'; readonly reason: string };

/** The observed half of `ContentReadBounds`. The caps are the caller's and are added there. */
export interface WalkCounts {
  readonly truncatedBy: ContentReadBounds['truncatedBy'];
  readonly scanned: number;
  readonly matched: number;
  readonly textChars: number;
}

export interface ContentReadWalker {
  walk(sample: WindowSample): Promise<ContentReadWalk>;
  dispose(): Promise<void>;
}

export function createWindowsWalker(): ContentReadWalker {
  if (process.platform !== WINDOWS_PLATFORM) {
    throw new DesktopContentReadError('桌面正文读取依赖 Windows UI Automation，本机没有。');
  }

  const inflight = new Set<ChildProcess>();
  let disposed = false;

  async function runWalk(sample: WindowSample): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const child = execFile(
        POWERSHELL_EXECUTABLE,
        ['-NoProfile', '-NonInteractive', '-File', WALK_SCRIPT, ...walkArguments(sample)],
        { windowsHide: true, timeout: READ_TIMEOUT_MS, maxBuffer: MAX_READ_OUTPUT_BYTES },
        (error: ExecFileException | null, stdout: string) => {
          inflight.delete(child);
          if (error) {
            reject(new WalkFailure(describeFailure(error, disposed), isWalkTimeout(error, disposed)));
            return;
          }
          resolve(stdout);
        },
      );
      inflight.add(child);
    });
  }

  return {
    async walk(sample: WindowSample): Promise<ContentReadWalk> {
      if (disposed) throw new DesktopContentReadError('the walker has already been disposed');
      try {
        return readWalk(await runWalk(sample));
      } catch (error) {
        // The walk's own bound firing is a value, not an exception — see `isWalkTimeout`. Everything
        // else stays a rejection, because everything else is about this process rather than the window.
        if (error instanceof WalkFailure && error.timedOut) {
          return Object.freeze({ kind: 'refused', reason: error.message });
        }
        throw error;
      }
    },

    async dispose(): Promise<void> {
      disposed = true;
      const pending = [...inflight];
      inflight.clear();
      await Promise.all(pending.map(terminate));
    },
  };
}

function terminate(child: ChildProcess): Promise<void> {
  return new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once('close', () => resolve());
    child.kill();
  });
}

function describeFailure(error: ExecFileException, disposed: boolean): string {
  if (disposed) return '读取进程在读取途中被释放。';
  if (error.killed) return `目标窗口在 ${READ_TIMEOUT_MS}ms 内没有应答。`;
  if (typeof error.code === 'number') return `读取进程以退出码 ${error.code} 结束。`;
  return '读取进程无法启动。';
}

/**
 * Whether a failed run is the walk's own bound firing rather than a failure of this process.
 *
 * This is the whole of the `refused`/`failed` distinction, and it is a predicate here rather than a
 * condition inline at the `catch` below for the reason the rest of this module is split the way it is:
 * the rule can then be exercised on any platform, and the Windows half only has to produce the input.
 *
 * Two things are being told apart, and both of them reach this function as a killed child:
 *
 *   `disposed` means *this process* stopped the child, because the plugin was unloading. That is not
 *   the window's answer to anything, and reporting it as `refused` would blame a window for Hikari's
 *   own teardown.
 *
 *   Otherwise a kill is the `timeout` the `execFile` call above was given, and that is the boundary
 *   review's `refused`: 「单次读取有超时；目标无响应即 refused，不挂起」(§2), and the acceptance table's
 *   `refused`(超时). It is a fact *about the window*, which is why it is one of the five kinds rather
 *   than a rejection — `endpoint.ts` says the same thing from the other side, and `types.ts` separates
 *   `refused` from `unreadable` on exactly this line.
 *
 * Verified before this predicate existed: without it a window that never answered produced a *thrown*
 * error, the endpoint turned it into `failed`, and `refused` was unreachable in production — every
 * test of it built the walk value by hand, and nothing in the script's `Fail` path could produce one.
 */
export function isWalkTimeout(failure: { readonly killed?: boolean }, disposed: boolean): boolean {
  return !disposed && failure.killed === true;
}

/**
 * A failed run, carrying the one bit that decides whether it is a kind or a rejection.
 *
 * The bit is not derivable at the `catch` — by then the `ExecFileException` is gone — so it is decided
 * once, where the child's exit is still in hand, and carried. The class is a `DesktopContentReadError`
 * so that anything which already treats this module's failures as that type keeps working.
 */
class WalkFailure extends DesktopContentReadError {
  readonly timedOut: boolean;

  constructor(message: string, timedOut: boolean) {
    super(message);
    this.timedOut = timedOut;
  }
}

// -------------------------------------------------------------------------------------------
// The script.
// -------------------------------------------------------------------------------------------

// The script is a file, and what follows is why it is one.
//
// It used to be a template literal in this file, handed to `powershell.exe` as `-EncodedCommand`,
// which makes the whole script a single CreateProcess command line: a hard limit of 32,767 characters
// that base64 of UTF-16 doubles the script's length inside. Measured with that transport, the walk was
// 12,064 characters of script, 31,812 of base64 and 31,870 of command line, leaving 897 base64
// characters, which is about 336 characters of script, which is four lines of comment. The failure
// mode was also illegible: overrunning the limit made `execFile` throw `spawn ENAMETOOLONG`
// *synchronously*, out of the Promise executor, so `walk()` rejected with a raw `Error` rather than a
// `DesktopContentReadError` and the endpoint reported a failed read whose message named neither the
// script nor its size. And the margin was not a property the type system or the tests could see, so
// the only place to record it was a comment -- inside the script, spending the very thing it
// described.
//
// As a file the command line is the interpreter, this path and eight small arguments: measured at 169
// characters, and it does not grow when the script does. The second thing the old transport cost is
// gone too -- nothing is interpolated into code any more, which is what `walkArguments` below is
// about.
//
// The script is pure ASCII and a test holds it there. PowerShell reads a .ps1 with no byte-order mark
// through the system ANSI code page, and a UTF-8 character in a string literal there is a parse
// error rather than a cosmetic blemish; `walk.ps1`'s own header records the measurement.
//
// ---------------------------------------------------------------------------------------------
// One thing about the script that is about its content rather than its transport
// ---------------------------------------------------------------------------------------------
//
// Every region has at least one node, and that is now structural rather than checked. The budget
// check used to run *after* the region was created, because `Region-For` was evaluated as an
// argument to `Add-Node`: PowerShell evaluates arguments first, so a call that the budget then
// refused had already registered an empty region. When the character budget was filled *exactly* by
// one node and the next node belonged to a region not yet seen, the walk stopped with
// `truncatedBy = 'chars'` and emitted that empty region -- and `readRegion` rejects a region with no
// nodes, so a read that owed `truncated` came back `failed` instead, with the whole answer lost. It
// was intermittent (it needs the budget to land exactly and the next element to open a new region),
// and no test could have caught it: the suite injects its walker, and `readWalk`/`readRegion` are
// module-private, so the only code that has ever seen a real script's output is a real read.
// `Add-Node` now takes the frame coordinates and calls `Region-For` itself, after the budget check
// has passed, which makes "a region exists only once it holds a node" an invariant of the script
// rather than an assertion on the far side of the pipe.

/**
 * The arguments the walk script is invoked with, validated before they are spelled.
 *
 * What the validation is proof against has changed, and it is worth being exact about which. The
 * handle and the expected process id used to be *interpolated into the script text*, and the guard
 * was that a decimal spelling of a safe integer cannot contain a quote, a semicolon, a `$` or a
 * newline -- a deliberately small surface with a deliberately narrow proof. They are arguments now:
 * `powershell.exe -File walk.ps1 -Handle 1234`, where PowerShell does not read a `-File` argument as
 * code at all, so there is no surface left to break out of.
 *
 * The checks stay anyway, because the failures they prevent are still real. A handle that is not a
 * safe integer is a sample this module cannot address, and saying so here is worth more than letting
 * the script die on a binding error and reporting a process exit code. The bounds travel the same way
 * for a different reason: they are this module's constants, and passing them keeps one source of
 * truth for them rather than a copy in the script that can drift.
 *
 * `EdgeTolerance` is the one fractional value here, and the binder was measured before it was trusted:
 * a `[double]` parameter reads "0.5" as 0.5 under en-US, de-DE and zh-CN alike, so the current culture
 * is not a hazard for it. That is not true of everything -- `walk.ps1` builds its timestamp through
 * `InvariantCulture` for exactly the opposite reason -- so it is recorded rather than assumed.
 */
function walkArguments(sample: WindowSample): readonly string[] {
  if (!Number.isSafeInteger(sample.handle) || sample.handle <= 0) {
    throw new DesktopContentReadError('桌面正文读取需要一个可表示的窗口句柄。');
  }
  const expectedPid =
    typeof sample.processId === 'number' && Number.isSafeInteger(sample.processId)
      ? sample.processId
      : 0;

  return [
    '-Handle',
    String(sample.handle),
    '-ExpectedPid',
    String(expectedPid),
    '-MaxDepth',
    String(READ_MAX_DEPTH),
    '-MaxNodes',
    String(READ_MAX_NODES),
    '-MaxChars',
    String(READ_MAX_CHARS),
    '-EdgeTolerance',
    String(EDGE_TOLERANCE),
    '-ClientAreaId',
    CLIENT_AREA_ID,
    '-UnidentifiedId',
    UNIDENTIFIED_CONTAINER_ID,
  ];
}

// -------------------------------------------------------------------------------------------
// Reading the child's answer.
// -------------------------------------------------------------------------------------------

const RELATIONS: ReadonlySet<string> = new Set(['inside', 'outside', 'partial', 'unknown']);
const REASONS: ReadonlySet<string> = new Set(['offscreen', 'clipped-by-ancestor']);
const CHANNELS: ReadonlySet<string> = new Set(['name', 'text', 'value']);
const TRUNCATIONS: ReadonlySet<string> = new Set(['depth', 'nodes', 'chars']);
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// The child is a subprocess this module starts, but its output is still parsed rather than believed.
// Every field below is checked against its own vocabulary, because the value that comes back becomes
// a region a human reads and a channel a consumer branches on: a `viewportRelation` the child
// misspelled would otherwise reach the renderer as an unhandled string, and `unknown` silently
// becoming `outside` is the one merge §3.6 forbids by name.
function readWalk(stdout: string): ContentReadWalk {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new DesktopContentReadError('读取进程没有给出可解析的结果。');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new DesktopContentReadError('读取进程没有给出可解析的结果。');
  }

  const { ok } = parsed as { ok?: unknown };
  if (ok === false) {
    const { reason } = parsed as { reason?: unknown };
    const named = typeof reason === 'string' && reason.length > 0 ? reason : 'unknown-failure';
    // Every reason the script can report is an *addressing* failure, and all three collapse to
    // `unreadable`: the script's own `Fail` sites are `window-gone`, `window-replaced` and
    // `element-unreadable`, and it has no way to observe its own slowness, so it cannot report the
    // no-answer case at all.
    //
    // `refused` is therefore produced in exactly one place — `walk()` above, from the walk's own bound
    // — and there used to be a branch here that read a `target-not-responding` reason into it. That
    // reason was never emitted by any `Fail` site, which made the branch dead *and* made `refused` look
    // like it had a producer it did not have. Removed rather than kept as a convenience: a second,
    // unreachable way to produce a kind is how the first one went missing.
    return Object.freeze({ kind: 'unreadable', reason: describeUnreadable(named) });
  }
  if (ok !== true) {
    throw new DesktopContentReadError('读取进程没有给出可解析的结果。');
  }

  const { readAt, regions, bounds } = parsed as {
    readAt?: unknown;
    regions?: unknown;
    bounds?: unknown;
  };
  if (typeof readAt !== 'string' || !UTC_TIMESTAMP.test(readAt)) {
    throw new DesktopContentReadError('读取进程没有给出可用的读取时间。');
  }
  if (!Array.isArray(regions)) {
    throw new DesktopContentReadError('读取进程没有给出可用的内容区域。');
  }
  if (typeof bounds !== 'object' || bounds === null) {
    throw new DesktopContentReadError('读取进程没有给出可用的边界记录。');
  }

  return Object.freeze({
    kind: 'walked',
    readAt,
    regions: Object.freeze(regions.map((region) => readRegion(region))),
    counted: readCounts(bounds),
  });
}

function readRegion(input: unknown): Region {
  if (typeof input !== 'object' || input === null) {
    throw new DesktopContentReadError('读取进程给出的内容区域不可读。');
  }
  const { id, viewportRelation, notVisibleBecause, nodes } = input as {
    id?: unknown;
    viewportRelation?: unknown;
    notVisibleBecause?: unknown;
    nodes?: unknown;
  };

  if (typeof id !== 'string' || id.length === 0) {
    throw new DesktopContentReadError('读取进程给出的内容区域没有身份。');
  }
  if (typeof viewportRelation !== 'string' || !RELATIONS.has(viewportRelation)) {
    throw new DesktopContentReadError('读取进程给出了不认识的可视关系。');
  }
  // `null` and a member of the vocabulary, and nothing else. An absent field is *not* accepted as
  // "no reason": the two are different statements, and only one of them is about the element.
  if (notVisibleBecause !== null && (typeof notVisibleBecause !== 'string' || !REASONS.has(notVisibleBecause))) {
    throw new DesktopContentReadError('读取进程给出了不认识的不可见原因。');
  }
  if (!Array.isArray(nodes) || nodes.length === 0) {
    throw new DesktopContentReadError('读取进程给出了没有内容的内容区域。');
  }

  return Object.freeze({
    id,
    viewportRelation: viewportRelation as Region['viewportRelation'],
    notVisibleBecause: notVisibleBecause as Region['notVisibleBecause'],
    nodes: Object.freeze(nodes.map((node) => readNode(node))),
  });
}

function readNode(input: unknown): Region['nodes'][number] {
  if (typeof input !== 'object' || input === null) {
    throw new DesktopContentReadError('读取进程给出的内容节点不可读。');
  }
  const { channel, text, depth } = input as { channel?: unknown; text?: unknown; depth?: unknown };

  if (typeof channel !== 'string' || !CHANNELS.has(channel)) {
    throw new DesktopContentReadError('读取进程给出了不认识的文本通道。');
  }
  if (typeof text !== 'string') {
    throw new DesktopContentReadError('读取进程给出的内容节点没有文本。');
  }
  if (typeof depth !== 'number' || !Number.isInteger(depth) || depth < 0) {
    throw new DesktopContentReadError('读取进程给出的内容节点没有可用的深度。');
  }

  return Object.freeze({ channel: channel as Region['nodes'][number]['channel'], text, depth });
}

function readCounts(input: object): WalkCounts {
  const { truncatedBy, scanned, matched, textChars } = input as {
    truncatedBy?: unknown;
    scanned?: unknown;
    matched?: unknown;
    textChars?: unknown;
  };

  if (truncatedBy !== null && (typeof truncatedBy !== 'string' || !TRUNCATIONS.has(truncatedBy))) {
    throw new DesktopContentReadError('读取进程给出了不认识的截断原因。');
  }

  return Object.freeze({
    truncatedBy: truncatedBy as WalkCounts['truncatedBy'],
    scanned: readCount(scanned, 'scanned'),
    matched: readCount(matched, 'matched'),
    textChars: readCount(textChars, 'textChars'),
  });
}

function readCount(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new DesktopContentReadError(`读取进程给出的 ${field} 不是一个计数。`);
  }
  return value;
}

function describeUnreadable(reason: string): string {
  if (reason === 'window-gone') return '目标窗口在读取期间已经不存在了。';
  if (reason === 'window-replaced') return '那个句柄指向的已经不是同一次观测到的窗口。';
  if (reason === 'element-unreadable') return '目标窗口无法被 UI Automation 读出元素。';
  return `目标窗口无法读取：${reason}`;
}

/** The counts plus the caps that applied, which is the record §3.6 asks a result to carry. */
export function withCaps(counted: WalkCounts): ContentReadBounds {
  return Object.freeze({
    maxDepth: READ_MAX_DEPTH,
    maxNodes: READ_MAX_NODES,
    maxChars: READ_MAX_CHARS,
    truncatedBy: counted.truncatedBy,
    scanned: counted.scanned,
    matched: counted.matched,
    textChars: counted.textChars,
  });
}

const EMPTY_NOTE = '遍历读完了目标窗口，没有在其中找到任何文本。';

/**
 * Which of the five kinds a finished walk is.
 *
 * Pure, and it lives here rather than beside the endpoint so that it can be exercised on every
 * platform: the Windows half of this module produces a `ContentReadWalk` and this turns it into an
 * answer, and the split is what lets the answer's shape be tested where there is no window at all.
 *
 * The switch order is the design, and one of its two orderings is not obvious:
 *
 *   `unreadable` and `refused` are checked first because they are the walker's own verdicts — it
 *   looked, and could not. There are no counts to interpret.
 *
 *   `truncated` is checked *before* `empty`, and that is the load-bearing one. A walk that hit the
 *   node or character bound having matched nothing has found nothing *so far* — the window may be full
 *   of text past the point it stopped. Reporting `empty` there would say "this window has no text",
 *   which is a claim the walk did not establish, and it is the same class of error as the ground
 *   truth's silently-dropped 32%: a partial read reported as a complete one. `truncated` says what is
 *   true instead — the walk was stopped, and here is everything it reached before it was.
 */
export function decideContentRead(walk: ContentReadWalk, window: WindowIdentity): ContentRead {
  if (walk.kind === 'unreadable') {
    return Object.freeze({ kind: 'unreadable', window, note: walk.reason });
  }
  if (walk.kind === 'refused') {
    return Object.freeze({ kind: 'refused', window, note: walk.reason });
  }

  const bounds = withCaps(walk.counted);
  if (walk.counted.truncatedBy !== null) {
    return Object.freeze({ kind: 'truncated', window, regions: walk.regions, bounds });
  }
  if (walk.counted.matched === 0) {
    return Object.freeze({ kind: 'empty', window, bounds, note: EMPTY_NOTE });
  }
  return Object.freeze({ kind: 'read', window, regions: walk.regions, bounds, readAt: walk.readAt });
}
