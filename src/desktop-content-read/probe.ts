// The window-identity sample: which window is in front, taken on the awareness loop's occurrence.
//
// The same road as `src/foreground/windows.ts` — `execFile('powershell.exe', …)` with an inline
// `Add-Type` C# block and `user32.dll` P/Invoke — and for the reason §3.8 gives: it is the path this
// repository has already walked, with the error classification and the timeout constant already in
// it, and it adds no native binding and no build surface.
//
// What it does *not* share with `src/foreground/windows.ts` is the handle. That module's whole output
// is title and process name, and the handle never leaves its child process; here the handle is the
// point, because a content read is addressed to one. This is a second, narrow observation rather
// than a widening of that one — §3.3 refused widening it, and the refusal holds: nothing downstream
// of the foreground observation changed to make this possible.
//
// ---------------------------------------------------------------------------------------------
// The cost, stated here because it is invisible from the outside
// ---------------------------------------------------------------------------------------------
//
// This is one more PowerShell process per awareness cycle, on a machine whose perception chain
// already launches two per cycle. It buys the time semantics `target.ts` argues for, and it is not
// free. Measured on this machine: a PowerShell 5.1 launch with an inline `Add-Type` is the dominant
// term, and a probe is a launch plus three P/Invokes and one `Get-Process` lookup — the same order as
// the foreground acquisition the World already performs.
//
// The occurrence handler in `plugin.ts` does not await this. That is what keeps the cost off the
// awareness loop's cadence, and it is also why at most one probe is in flight at a time.

import { execFile } from 'node:child_process';
import type { ChildProcess, ExecFileException } from 'node:child_process';

import { DesktopContentReadError } from './errors.js';
import type { WindowSample } from './target.js';

const WINDOWS_PLATFORM = 'win32';
const POWERSHELL_EXECUTABLE = 'powershell.exe';
const PROBE_TIMEOUT_MS = 10_000;
const MAX_PROBE_OUTPUT_BYTES = 64 * 1024;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const INVALID_WINDOW_HANDLE = 1400;

// The format string carries one non-obvious hazard, and the `InvariantCulture` argument below is the
// fix for it rather than a flourish. In a .NET custom date format, `:` is not a colon — it is the
// *time separator placeholder*, substituted with the running culture's `DateTimeFormat.TimeSeparator`.
// 24 of this machine's 915 cultures set that to `.`, so under (among others) `fi-FI`, `da-GL`,
// `en-FI` and `id-ID` the same expression produces `2026-10-09T17.35.36.458Z`, which `UTC_TIMESTAMP`
// above rejects. The failure is not cosmetic and not intermittent: `readSample` throws, the plugin's
// catch swallows it, no sample is ever held, and *every* read on such a machine answers "Hikari 还没
// 有观测到可以归给人类的窗口" — the capability is gone with no error anywhere to explain it. Measured
// under an explicit `fi-FI` provider: as written `matches=False`, with the invariant provider
// `matches=True`. The fraction separator is unaffected; only the two colons are.
//
// Kept out here rather than as a comment inside the script because that script travels on the command
// line, which has a hard length limit, and every line of comment spent inside it is a line of comment
// spent against that limit. This is the same measurement the walk made, in the place where it costs
// nothing.
//
// How much room is left, measured rather than assumed, because `uia.ts` was moved off the command line
// for measuring *its* script and it would be easy to read that move as a verdict on this one: this
// script is 1,925 characters, 5,136 of base64, and a 5,194-character command line against the 32,767
// CreateProcess limit — 15.9% of it, with a factor of five still in hand. That is the whole reason
// this one stayed where it was: `-EncodedCommand` is one process launch with no file to ship and no
// path to resolve, and the walk did not leave it because the transport was wrong but because its
// script measured 31,870 characters — four lines of comment away from a `spawn ENAMETOOLONG` whose
// message names neither the script nor its size. If this script ever finds itself at that proportion,
// it moves the same way the walk did, and `walk.ps1` next door is the shape to move it to.
const PROBE_SCRIPT = `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Add-Type -Namespace Hikari -Name ContentReadProbe -MemberDefinition @'
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern int GetWindowTextW(System.IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
[DllImport("user32.dll", SetLastError = true)] public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint lpdwProcessId);
'@

$handle = [Hikari.ContentReadProbe]::GetForegroundWindow()
$observedAt = [System.DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fff', [System.Globalization.CultureInfo]::InvariantCulture) + 'Z'

$result = [ordered]@{ observedAt = $observedAt; handle = $handle.ToString() }

if ($handle -ne [System.IntPtr]::Zero) {
  $titleAvailable = $false
  $title = $null
  try {
    $buffer = New-Object System.Text.StringBuilder 32768
    $written = [Hikari.ContentReadProbe]::GetWindowTextW($handle, $buffer, $buffer.Capacity)
    if ($written -gt 0) {
      $titleAvailable = $true
      $title = $buffer.ToString()
    } elseif ([System.Runtime.InteropServices.Marshal]::GetLastWin32Error() -ne ${INVALID_WINDOW_HANDLE}) {
      $titleAvailable = $true
    }
  } catch {
    $titleAvailable = $false
  }
  if ($titleAvailable) { $result['title'] = $title }

  try {
    [uint32]$processId = 0
    [void][Hikari.ContentReadProbe]::GetWindowThreadProcessId($handle, [ref]$processId)
    if ($processId -gt 0) {
      $result['processName'] = (Get-Process -Id $processId -ErrorAction Stop).ProcessName
      $result['processId'] = [int]$processId
    }
  } catch {
  }
}

$json = $result | ConvertTo-Json -Compress
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
$output = [System.Console]::OpenStandardOutput()
$output.Write($bytes, 0, $bytes.Length)
$output.Flush()
`;

const ENCODED_PROBE_SCRIPT = Buffer.from(PROBE_SCRIPT, 'utf16le').toString('base64');

/**
 * The half of the probe that a test supplies for itself.
 *
 * A module-internal seam, mirroring `createForegroundPlugin(createAcquirer)`: the production plugin
 * is built from the production factory, and a test builds the *same* plugin with a probe it controls
 * so that the endpoint's behaviour can be exercised without a desktop. There is no seam inside the
 * production plugin.
 */
export interface ContentReadProbe {
  /** The window in front right now, or `undefined` when there is none. */
  sample(): Promise<WindowSample | undefined>;
  dispose(): Promise<void>;
}

export function createWindowsProbe(): ContentReadProbe {
  if (process.platform !== WINDOWS_PLATFORM) {
    throw new DesktopContentReadError('桌面正文读取依赖 Windows 前台窗口接口，本机没有。');
  }

  const inflight = new Set<ChildProcess>();
  let disposed = false;

  async function runProbe(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const child = execFile(
        POWERSHELL_EXECUTABLE,
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', ENCODED_PROBE_SCRIPT],
        { windowsHide: true, timeout: PROBE_TIMEOUT_MS, maxBuffer: MAX_PROBE_OUTPUT_BYTES },
        (error: ExecFileException | null, stdout: string) => {
          inflight.delete(child);
          if (error) {
            reject(new DesktopContentReadError(describeFailure(error, disposed)));
            return;
          }
          resolve(stdout);
        },
      );
      inflight.add(child);
    });
  }

  return {
    async sample(): Promise<WindowSample | undefined> {
      if (disposed) throw new DesktopContentReadError('the probe has already been disposed');
      return readSample(await runProbe());
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
  if (disposed) return 'the probe was disposed mid-observation';
  if (error.killed) return 'the probe process did not finish in time';
  if (typeof error.code === 'number') return `the probe process exited with code ${error.code}`;
  return 'the probe process could not be started';
}

// The same reading as `src/foreground/windows.ts` gives its own child's output, with one difference
// that matters: a handle this process cannot represent exactly is a handle it must not use. The
// numeric form is checked here rather than trusted, because everything downstream indexes a window
// with it.
function readSample(stdout: string): WindowSample | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new DesktopContentReadError('the probe produced no readable result');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new DesktopContentReadError('the probe produced no readable result');
  }

  const { observedAt, handle, title, processName, processId } = parsed as {
    observedAt?: unknown;
    handle?: unknown;
    title?: unknown;
    processName?: unknown;
    processId?: unknown;
  };

  if (typeof observedAt !== 'string' || !UTC_TIMESTAMP.test(observedAt)) {
    throw new DesktopContentReadError('the probe produced no usable timestamp');
  }
  if (typeof handle !== 'string') {
    throw new DesktopContentReadError('the probe produced no usable window handle');
  }

  const value = Number(handle);
  // An absent window is an ordinary answer, and it is the one place a zero is meaningful. Anything
  // else that is not a positive safe integer is a value this process will not carry.
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DesktopContentReadError('the probe produced a window handle it cannot represent');
  }
  if (value === 0) return undefined;

  return Object.freeze({
    handle: value,
    title: typeof title === 'string' ? title : null,
    processName: typeof processName === 'string' ? processName : null,
    processId:
      typeof processId === 'number' && Number.isSafeInteger(processId) && processId > 0
        ? processId
        : null,
    observedAt,
  });
}
