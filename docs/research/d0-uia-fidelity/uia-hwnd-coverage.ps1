# D0 probe — READ ONLY.
#
# Question: pywinauto's UIA backend derives an element's `control_id` from its NativeWindowHandle
# (pywinauto-0.6.9/pywinauto/uia_element_info.py:206-211), and its `descendants(depth=N)` filters on
# `control_id` identity (element_info.py:126-146). If most of a UIA tree carries no HWND of its own,
# that identity test cannot mean "tree depth". This measures the actual HWND coverage per tree so the
# claim is anchored in data instead of a static read.
#
# Emits counts only. No window text.

$ErrorActionPreference = 'Stop'
$cfg = [System.Text.Encoding]::UTF8.GetString(
  [System.Convert]::FromBase64String($env:HIKARI_HWNDCFG_B64)) | ConvertFrom-Json
$TARGET = [string]$cfg.target
$MAXN = [int]$cfg.maxNodes
$MAXD = [int]$cfg.maxDepth

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -Namespace Hikari -Name H -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr h);
[DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr h);
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
'@

$p = Get-Process -Name $TARGET -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { [ordered]@{ error = "no main window for $TARGET" } | ConvertTo-Json -Compress; exit 0 }
$hwnd = $p.MainWindowHandle
$root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
if (-not $root) { [ordered]@{ error = 'FromHandle null' } | ConvertTo-Json -Compress; exit 0 }

$w = [System.Windows.Automation.TreeWalker]::RawViewWalker
$st = @{ nodes = 0; withHwnd = 0; rootHwnd = 0; textEls = 0; textElsNoHwnd = 0; maxD = 0 }
$dist = @{}

function Step($el, $d) {
  if ($st.nodes -ge $MAXN -or $d -gt $MAXD) { return }
  $st.nodes++
  if ($d -gt $st.maxD) { $st.maxD = $d }
  $h = 0
  try { $h = $el.Current.NativeWindowHandle } catch { }
  $hasOwn = ($h -ne 0)
  if ($hasOwn) { $st.withHwnd++ }
  $k = "$d"
  if (-not $dist.ContainsKey($k)) { $dist[$k] = @{ n = 0; hw = 0 } }
  $dist[$k].n++
  if ($hasOwn) { $dist[$k].hw++ }
  try {
    $tp = $null
    if ($el.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$tp)) {
      if ($tp -ne $null) { $st.textEls++; if (-not $hasOwn) { $st.textElsNoHwnd++ } }
    }
  } catch { }
  try {
    $c = $w.GetFirstChild($el)
    while ($c -ne $null) { Step $c ($d + 1); $c = $w.GetNextSibling($c) }
  } catch { }
}

Step $root 0

$byDepth = @()
foreach ($k in ($dist.Keys | Sort-Object { [int]$_ })) {
  $byDepth += [ordered]@{ depth = [int]$k; nodes = $dist[$k].n; withHwnd = $dist[$k].hw }
}

[ordered]@{
  target = $TARGET
  hwnd = $hwnd.ToString()
  nodes = $st.nodes
  withHwnd = $st.withHwnd
  hwndCoveragePct = if ($st.nodes) { [math]::Round(100.0 * $st.withHwnd / $st.nodes, 1) } else { 0 }
  textEls = $st.textEls
  textElsWithoutOwnHwnd = $st.textElsNoHwnd
  textElsWithoutOwnHwndPct = if ($st.textEls) { [math]::Round(100.0 * $st.textElsNoHwnd / $st.textEls, 1) } else { 0 }
  maxDepthReached = $st.maxD
  byDepth = $byDepth
} | ConvertTo-Json -Depth 5 -Compress
