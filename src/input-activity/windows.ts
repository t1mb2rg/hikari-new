import { execFile } from 'node:child_process';
import type { ChildProcess, ExecFileException } from 'node:child_process';

import type { InputActivityAcquirer, InputActivityAcquisition } from './acquisition.js';
import { InputActivityError, InputActivityObservationError } from './errors.js';

const WINDOWS_PLATFORM = 'win32';
const POWERSHELL_EXECUTABLE = 'powershell.exe';
const ACQUISITION_TIMEOUT_MS = 10_000;
const MAX_ACQUISITION_OUTPUT_BYTES = 256 * 1024;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UINT32_MAX = 0xffff_ffff;

const ACQUISITION_SCRIPT = `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Add-Type -Namespace Hikari -Name Input -MemberDefinition @'
[System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
public struct LASTINPUTINFO {
  public uint cbSize;
  public uint dwTime;
}
[System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true)]
public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
'@

$info = New-Object Hikari.Input+LASTINPUTINFO
$info.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($info)
if (-not [Hikari.Input]::GetLastInputInfo([ref]$info)) { throw 'GetLastInputInfo failed' }

$observedAt = [System.DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fff') + 'Z'
$lastInputTick = [uint32]$info.dwTime

$result = [ordered]@{ observedAt = $observedAt; lastInputTick = $lastInputTick }
$json = $result | ConvertTo-Json -Compress
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
$output = [System.Console]::OpenStandardOutput()
$output.Write($bytes, 0, $bytes.Length)
$output.Flush()
`;

const ENCODED_ACQUISITION_SCRIPT = Buffer.from(ACQUISITION_SCRIPT, 'utf16le').toString('base64');

export function createWindowsAcquirer(): InputActivityAcquirer {
  if (process.platform !== WINDOWS_PLATFORM) {
    throw new InputActivityError('Input activity observation requires a win32 host.');
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
              new InputActivityObservationError(
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
    async acquire(): Promise<InputActivityAcquisition> {
      if (disposed) {
        throw new InputActivityObservationError('the acquirer has already been disposed');
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

function readAcquisition(stdout: string): InputActivityAcquisition {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new InputActivityObservationError('the acquisition process produced no readable result');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new InputActivityObservationError('the acquisition process produced no readable result');
  }

  const { observedAt, lastInputTick } = parsed as { observedAt?: unknown; lastInputTick?: unknown };
  if (typeof observedAt !== 'string' || !UTC_TIMESTAMP.test(observedAt)) {
    throw new InputActivityObservationError('the acquisition process produced no usable timestamp');
  }
  if (!isUint32(lastInputTick)) {
    throw new InputActivityObservationError('the acquisition process produced no usable input tick');
  }

  return Object.freeze({ observedAt, lastInputTick });
}

function isUint32(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= UINT32_MAX;
}
