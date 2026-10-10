# D0 single-walk probe — READ ONLY, no GUI operation.
#
# One ControlView walk over one window, with epoch start/end stamps so the runner can line this walk up
# against the pinger's response-time series. Text is never emitted: only counts and a hash.
#
# Config: base64 JSON in $env:HIKARI_WALK_CONFIG_B64.

$ErrorActionPreference = 'Stop'

$cfg = [System.Text.Encoding]::UTF8.GetString(
  [System.Convert]::FromBase64String($env:HIKARI_WALK_CONFIG_B64)) | ConvertFrom-Json

$TARGET    = [string]$cfg.target
$MAX_NODES = [int]$cfg.maxNodes
$MAX_DEPTH = [int]$cfg.maxDepth
$BUDGET    = [int]$cfg.timeBudgetMs

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

Add-Type -Namespace Hikari -Name Walk -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, System.IntPtr lParam);
public delegate bool EnumWindowsProc(System.IntPtr hWnd, System.IntPtr lParam);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(System.IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint lpdwProcessId);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr hWnd);
'@

$script:found = [System.IntPtr]::Zero
$cb = [Hikari.Walk+EnumWindowsProc]{
  param($hWnd, $lParam)
  if ($script:found -ne [System.IntPtr]::Zero) { return $false }
  if (-not [Hikari.Walk]::IsWindowVisible($hWnd)) { return $true }
  if ([Hikari.Walk]::IsIconic($hWnd)) { return $true }
  [uint32]$procId = 0
  [void][Hikari.Walk]::GetWindowThreadProcessId($hWnd, [ref]$procId)
  try { $pname = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { return $true }
  if ($pname -ne $TARGET) { return $true }
  $tb = New-Object System.Text.StringBuilder 512
  [void][Hikari.Walk]::GetWindowTextW($hWnd, $tb, $tb.Capacity)
  if ($tb.Length -lt 1) { return $true }
  $script:found = $hWnd
  return $false
}
[void][Hikari.Walk]::EnumWindows($cb, [System.IntPtr]::Zero)

$hwnd = $script:found
if ($hwnd -eq [System.IntPtr]::Zero) {
  [ordered]@{ error = "no visible titled window for process '$TARGET'" } | ConvertTo-Json -Compress
  exit 0
}

$root = $null
try { $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd) } catch { }
if ($root -eq $null) {
  [ordered]@{ error = 'FromHandle returned null'; hwnd = $hwnd.ToString() } | ConvertTo-Json -Compress
  exit 0
}

$st = @{ nodes = 0; textEls = 0; textChars = 0; errors = 0; truncatedBy = '' }
$sb = New-Object System.Text.StringBuilder
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$sw = [System.Diagnostics.Stopwatch]::StartNew()

function Step($el, $d) {
  if ($st.nodes -ge $MAX_NODES) { if (-not $st.truncatedBy) { $st.truncatedBy = 'nodes' }; return }
  if ($d -gt $MAX_DEPTH)        { if (-not $st.truncatedBy) { $st.truncatedBy = 'depth' }; return }
  if ($sw.ElapsedMilliseconds -gt $BUDGET) { $st.truncatedBy = 'time'; return }
  $st.nodes = $st.nodes + 1
  try {
    $tp = $null
    if ($el.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$tp)) {
      if ($tp -ne $null) {
        $st.textEls = $st.textEls + 1
        $t = $tp.DocumentRange.GetText(-1)
        if ($t -and $t.Length -gt 0) { $st.textChars += $t.Length; [void]$sb.Append($t) }
      }
    }
  } catch { }
  try {
    $c = $walker.GetFirstChild($el)
    while ($c -ne $null) {
      Step $c ($d + 1)
      if ($st.truncatedBy -eq 'time' -or $st.nodes -ge $MAX_NODES) { break }
      $c = $walker.GetNextSibling($c)
    }
  } catch { $st.errors = $st.errors + 1 }
}

# Stamped around the walk only, so the runner's baseline/walk/tail split is exact.
$startMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
try { Step $root 0 } catch { $st.errors = $st.errors + 1 }
$endMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$sw.Stop()

$sha = [System.Security.Cryptography.SHA256]::Create()
$b = [System.Text.Encoding]::UTF8.GetBytes($sb.ToString())
$hash = if ($sb.Length -gt 0) { ([System.BitConverter]::ToString($sha.ComputeHash($b)) -replace '-', '').Substring(0, 12) } else { '-' }

[ordered]@{
  target = $TARGET
  hwnd = $hwnd.ToString()
  startMs = $startMs
  endMs = $endMs
  wallMs = $endMs - $startMs
  nodes = $st.nodes
  textEls = $st.textEls
  textChars = $st.textChars
  textHash = $hash
  errors = $st.errors
  truncatedBy = $st.truncatedBy
  elapsedMs = $sw.ElapsedMilliseconds
} | ConvertTo-Json -Depth 4 -Compress
