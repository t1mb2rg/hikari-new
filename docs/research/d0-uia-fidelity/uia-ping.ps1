# D0 responsiveness pinger — READ ONLY, no GUI operation.
#
# Answers one question the strategy matrix cannot: while a UIA tree walk is running, does the TARGET
# application stop serving its own message queue?
#
# The instrument is SendMessageTimeoutW(WM_NULL) — a no-op message that DefWindowProc answers
# immediately. A window whose UI thread is pumping will answer it in well under a millisecond. A
# window whose UI thread is blocked (e.g. by a synchronous cross-process UIA call) will not answer
# until it unblocks, and the call reports a timeout. WM_NULL changes nothing.
#
# This process does not touch UIA at all; it only measures. Its output is a timestamped response-time
# series, so the runner can separate the baseline (before the walk) from the walk itself.
#
# Config: base64 JSON in $env:HIKARI_PING_CONFIG_B64.

$ErrorActionPreference = 'Stop'

$cfg = [System.Text.Encoding]::UTF8.GetString(
  [System.Convert]::FromBase64String($env:HIKARI_PING_CONFIG_B64)) | ConvertFrom-Json

$TARGET   = [string]$cfg.target
$DURATION = [int]$cfg.durationMs
$TIMEOUT  = [int]$cfg.timeoutMs
$INTERVAL = [int]$cfg.intervalMs

Add-Type -Namespace Hikari -Name Ping -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, System.IntPtr lParam);
public delegate bool EnumWindowsProc(System.IntPtr hWnd, System.IntPtr lParam);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(System.IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint lpdwProcessId);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr hWnd);
[DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern System.IntPtr SendMessageTimeoutW(System.IntPtr hWnd, uint Msg, System.IntPtr wParam, System.IntPtr lParam, uint fuFlags, uint uTimeout, out System.IntPtr lpdwResult);
'@

$WM_NULL = 0x0000
$SMTO_ABORTIFHUNG = 0x0002
$SMTO_BLOCK = 0x0001

# Resolve the target window the same way the other probes do: the process's visible, titled window.
$script:found = [System.IntPtr]::Zero
$cb = [Hikari.Ping+EnumWindowsProc]{
  param($hWnd, $lParam)
  if ($script:found -ne [System.IntPtr]::Zero) { return $false }
  if (-not [Hikari.Ping]::IsWindowVisible($hWnd)) { return $true }
  if ([Hikari.Ping]::IsIconic($hWnd)) { return $true }
  [uint32]$procId = 0
  [void][Hikari.Ping]::GetWindowThreadProcessId($hWnd, [ref]$procId)
  try { $pname = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { return $true }
  if ($pname -ne $TARGET) { return $true }
  $tb = New-Object System.Text.StringBuilder 512
  [void][Hikari.Ping]::GetWindowTextW($hWnd, $tb, $tb.Capacity)
  if ($tb.Length -lt 1) { return $true }
  $script:found = $hWnd
  return $false
}
[void][Hikari.Ping]::EnumWindows($cb, [System.IntPtr]::Zero)

$hwnd = $script:found
if ($hwnd -eq [System.IntPtr]::Zero) {
  [ordered]@{ error = "no visible titled window for process '$TARGET'"; samples = @() } | ConvertTo-Json -Depth 4 -Compress
  exit 0
}

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$samples = New-Object System.Collections.ArrayList

while ($sw.ElapsedMilliseconds -lt $DURATION) {
  $t0 = $sw.Elapsed.TotalMilliseconds
  $out = [System.IntPtr]::Zero
  # Timed out => the UI thread did not answer WM_NULL within $TIMEOUT ms.
  $ok = [Hikari.Ping]::SendMessageTimeoutW($hwnd, $WM_NULL, [System.IntPtr]::Zero, [System.IntPtr]::Zero,
        ($SMTO_ABORTIFHUNG -bor $SMTO_BLOCK), [uint32]$TIMEOUT, [ref]$out)
  $rtt = $sw.Elapsed.TotalMilliseconds - $t0
  [void]$samples.Add([pscustomobject]@{
    t   = [Math]::Round($t0, 1)
    abs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    rtt = [Math]::Round($rtt, 2)
    to  = ($ok -eq [System.IntPtr]::Zero)
  })
  if ($INTERVAL -gt 0) { Start-Sleep -Milliseconds $INTERVAL }
}
$sw.Stop()

[ordered]@{
  target = $TARGET
  hwnd = $hwnd.ToString()
  timeoutMs = $TIMEOUT
  intervalMs = $INTERVAL
  sampleCount = $samples.Count
  samples = $samples
} | ConvertTo-Json -Depth 4 -Compress
