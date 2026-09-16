import { execFile } from 'node:child_process';
import type { ChildProcess, ExecFileException } from 'node:child_process';

import type { ForegroundAcquirer, ForegroundAcquisition } from './acquisition.js';
import { ForegroundError, ForegroundObservationError } from './errors.js';
import type { ForegroundTargetPresent } from './types.js';

const WINDOWS_PLATFORM = 'win32';
const POWERSHELL_EXECUTABLE = 'powershell.exe';
const ACQUISITION_TIMEOUT_MS = 10_000;
const MAX_ACQUISITION_OUTPUT_BYTES = 256 * 1024;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const INVALID_WINDOW_HANDLE = 1400;

const ACQUISITION_SCRIPT = `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Add-Type -Namespace Hikari -Name Foreground -MemberDefinition @'
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern int GetWindowTextW(System.IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
[DllImport("user32.dll", SetLastError = true)] public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint lpdwProcessId);
'@

$handle = [Hikari.Foreground]::GetForegroundWindow()
$observedAt = [System.DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fff') + 'Z'

$result = [ordered]@{ observedAt = $observedAt; kind = 'absent' }

if ($handle -ne [System.IntPtr]::Zero) {
  $result['kind'] = 'present'

  $titleAvailable = $false
  $title = $null
  try {
    $buffer = New-Object System.Text.StringBuilder 32768
    $written = [Hikari.Foreground]::GetWindowTextW($handle, $buffer, $buffer.Capacity)
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

  $processAvailable = $false
  $processName = $null
  try {
    [uint32]$processId = 0
    [void][Hikari.Foreground]::GetWindowThreadProcessId($handle, [ref]$processId)
    if ($processId -gt 0) {
      $processName = (Get-Process -Id $processId -ErrorAction Stop).ProcessName
      $processAvailable = $true
    }
  } catch {
    $processAvailable = $false
  }
  if ($processAvailable) { $result['processName'] = $processName }
}

$json = $result | ConvertTo-Json -Compress
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
$output = [System.Console]::OpenStandardOutput()
$output.Write($bytes, 0, $bytes.Length)
$output.Flush()
`;

const ENCODED_ACQUISITION_SCRIPT = Buffer.from(ACQUISITION_SCRIPT, 'utf16le').toString('base64');

export function createWindowsAcquirer(): ForegroundAcquirer {
  if (process.platform !== WINDOWS_PLATFORM) {
    throw new ForegroundError('Foreground observation requires a win32 host.');
  }

  const inflight = new Set<ChildProcess>();
  let disposed = false;

  async function runAcquisition(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const child = execFile(
        POWERSHELL_EXECUTABLE,
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', ENCODED_ACQUISITION_SCRIPT],
        { windowsHide: true, timeout: ACQUISITION_TIMEOUT_MS, maxBuffer: MAX_ACQUISITION_OUTPUT_BYTES },
        (error: ExecFileException | null, stdout: string) => {
          inflight.delete(child);
          if (error) {
            reject(
              new ForegroundObservationError(
                disposed ? 'the acquirer was disposed mid-observation' : describeFailure(error),
              ),
            );
            return;
          }
          resolve(stdout);
        },
      );
      inflight.add(child);
    });
  }

  return {
    async acquire(): Promise<ForegroundAcquisition> {
      if (disposed) {
        throw new ForegroundObservationError('the acquirer has already been disposed');
      }
      return readAcquisition(await runAcquisition());
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

function describeFailure(error: ExecFileException): string {
  if (error.killed) return 'the acquisition process did not finish in time';
  if (typeof error.code === 'number') {
    return `the acquisition process exited with code ${error.code}`;
  }
  return 'the acquisition process could not be started';
}

function readAcquisition(stdout: string): ForegroundAcquisition {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new ForegroundObservationError('the acquisition process produced no readable result');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new ForegroundObservationError('the acquisition process produced no readable result');
  }

  const { observedAt, kind } = parsed as { observedAt?: unknown; kind?: unknown };
  if (typeof observedAt !== 'string' || !UTC_TIMESTAMP.test(observedAt)) {
    throw new ForegroundObservationError('the acquisition process produced no usable timestamp');
  }
  if (kind === 'absent') {
    return Object.freeze({ observedAt, target: Object.freeze({ kind: 'absent' as const }) });
  }
  if (kind === 'present') {
    return Object.freeze({ observedAt, target: Object.freeze(readPresentTarget(parsed)) });
  }
  throw new ForegroundObservationError('the acquisition process produced no usable result');
}

function readPresentTarget(parsed: object): ForegroundTargetPresent {
  const { title, processName } = parsed as { title?: unknown; processName?: unknown };
  const target: { kind: 'present'; title?: string | null; processName?: string } = {
    kind: 'present',
  };
  if (Object.hasOwn(parsed, 'title') && (typeof title === 'string' || title === null)) {
    target.title = title;
  }
  if (Object.hasOwn(parsed, 'processName') && typeof processName === 'string') {
    target.processName = processName;
  }
  return target;
}
