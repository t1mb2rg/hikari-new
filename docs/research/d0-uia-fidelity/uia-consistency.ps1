# D0 UIA consistency probe — READ ONLY, no GUI operation.
#
# The matrix probe (uia-matrix.ps1) measures how MUCH each strategy returns. This one measures whether
# what it returns is internally coherent — the fidelity questions that can be answered WITHOUT ground
# truth, and therefore without creating a window to hold synthetic markers.
#
# It never prints text. Every text comparison is reduced to a boolean, a count, or a length. In
# particular the containment tests below (does RawView contain ControlView? does the window Name appear
# inside the body?) are computed on strings that stay in this process and are never emitted.
#
# Config: base64 JSON in $env:HIKARI_PROBE_CONFIG_B64.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$cfg = [System.Text.Encoding]::UTF8.GetString(
  [System.Convert]::FromBase64String($env:HIKARI_PROBE_CONFIG_B64)) | ConvertFrom-Json

$MAX_NODES   = [int]$cfg.maxNodes
$MAX_DEPTH   = [int]$cfg.maxDepth
$TIME_BUDGET = [int]$cfg.timeBudgetMs
$CHAR_CAP    = [int]$cfg.charCap
$TARGETS     = @($cfg.targets)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

Add-Type -Namespace Hikari -Name D0C -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, System.IntPtr lParam);
public delegate bool EnumWindowsProc(System.IntPtr hWnd, System.IntPtr lParam);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(System.IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint lpdwProcessId);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr hWnd);
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
'@

$SHA = [System.Security.Cryptography.SHA256]::Create()
function Get-TextHash([string]$s) {
  if ([string]::IsNullOrEmpty($s)) { return '-' }
  $b = [System.Text.Encoding]::UTF8.GetBytes($s)
  return ([System.BitConverter]::ToString($SHA.ComputeHash($b)) -replace '-', '').Substring(0, 12)
}

# Count non-overlapping occurrences of $needle in $hay.
function Count-Occurrences([string]$hay, [string]$needle) {
  if ([string]::IsNullOrEmpty($hay) -or [string]::IsNullOrEmpty($needle)) { return 0 }
  $n = 0; $i = 0
  while ($true) {
    $j = $hay.IndexOf($needle, $i)
    if ($j -lt 0) { break }
    $n++; $i = $j + $needle.Length
    if ($n -gt 100000) { break }
  }
  return $n
}

# One pass that collects the text AND censuses which patterns each element supports.
function Invoke-Pass {
  param($rootEl, $walker, [int]$budgetMs)

  $st = @{
    nodes = 0; textEls = 0; valueEls = 0; bothEls = 0; legacyEls = 0
    textChars = 0; valueChars = 0; legacyChars = 0
    offscreenTextChars = 0; onscreenTextChars = 0
    offscreenNodes = 0; truncatedBy = ''; errors = 0
  }
  $tp = New-Object System.Text.StringBuilder   # TextPattern text
  $vp = New-Object System.Text.StringBuilder   # ValuePattern text
  $lp = New-Object System.Text.StringBuilder   # LegacyIAccessible text
  $sw = [System.Diagnostics.Stopwatch]::StartNew()

  function Step($el, $d) {
    if ($st.nodes -ge $MAX_NODES) { if (-not $st.truncatedBy) { $st.truncatedBy = 'nodes' }; return }
    if ($d -gt $MAX_DEPTH)        { if (-not $st.truncatedBy) { $st.truncatedBy = 'depth' }; return }
    if ($sw.ElapsedMilliseconds -gt $budgetMs) { $st.truncatedBy = 'time'; return }
    $st.nodes = $st.nodes + 1
    $offscreen = $false
    try { $offscreen = $el.Current.IsOffscreen } catch { }
    if ($offscreen) { $st.offscreenNodes = $st.offscreenNodes + 1 }

    $hasT = $false; $hasV = $false
    try {
      $t = $null
      if ($el.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$t)) {
        if ($t -ne $null) {
          $hasT = $true; $st.textEls = $st.textEls + 1
          $s = $t.DocumentRange.GetText(-1)
          if ($s -and $s.Length -gt 0) {
            if ($s.Length -gt $CHAR_CAP) { $s = $s.Substring(0, $CHAR_CAP) }
            $st.textChars = $st.textChars + $s.Length
            if ($offscreen) { $st.offscreenTextChars += $s.Length } else { $st.onscreenTextChars += $s.Length }
            [void]$tp.Append($s)
          }
        }
      }
    } catch { $st.errors = $st.errors + 1 }

    try {
      $v = $null
      if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$v)) {
        if ($v -ne $null) {
          $hasV = $true; $st.valueEls = $st.valueEls + 1
          $s = $v.Current.Value
          if ($s -and $s.Length -gt 0) { $st.valueChars += $s.Length; [void]$vp.Append($s) }
        }
      }
    } catch { }

    if ($hasT -and $hasV) { $st.bothEls = $st.bothEls + 1 }

    try {
      $l = $null
      if ($el.TryGetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern, [ref]$l)) {
        if ($l -ne $null) {
          $st.legacyEls = $st.legacyEls + 1
          $s = $l.Current.Value
          if ($s -and $s.Length -gt 0) { $st.legacyChars += $s.Length; [void]$lp.Append($s) }
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

  try { Step $rootEl 0 } catch { $st.errors = $st.errors + 1 }
  $sw.Stop()
  $st['text'] = $tp.ToString()
  $st['value'] = $vp.ToString()
  $st['legacy'] = $lp.ToString()
  $st['elapsedMs'] = $sw.ElapsedMilliseconds
  return $st
}

# ---------------------------------------------------------------- enumerate

$windows = @()
$cb = [Hikari.D0C+EnumWindowsProc]{
  param($hWnd, $lParam)
  if (-not [Hikari.D0C]::IsWindowVisible($hWnd)) { return $true }
  if ([Hikari.D0C]::IsIconic($hWnd)) { return $true }
  [uint32]$ownerProcId = 0
  [void][Hikari.D0C]::GetWindowThreadProcessId($hWnd, [ref]$ownerProcId)
  try { $pname = (Get-Process -Id $ownerProcId -ErrorAction Stop).ProcessName } catch { return $true }
  if ($TARGETS -notcontains $pname) { return $true }
  $tb = New-Object System.Text.StringBuilder 512
  [void][Hikari.D0C]::GetWindowTextW($hWnd, $tb, $tb.Capacity)
  if ($tb.Length -lt 1) { return $true }
  $script:windows += [pscustomobject]@{ hwnd = $hWnd; pid = $ownerProcId; process = $pname; titleLen = $tb.Length }
  return $true
}
$script:windows = $windows
[void][Hikari.D0C]::EnumWindows($cb, [System.IntPtr]::Zero)
$windows = $script:windows

# Which top-level HWND is the OS foreground window? Recorded once, because the question this answers
# is "when the probe read window X, was X actually the window the user was looking at?" — and the
# answer is about the machine's state, not about X.
$fg = [Hikari.D0C]::GetForegroundWindow()
$fgProc = ''; $fgTitleLen = -1
try {
  [uint32]$fgPid = 0
  [void][Hikari.D0C]::GetWindowThreadProcessId($fg, [ref]$fgPid)
  $fgProc = (Get-Process -Id $fgPid -ErrorAction Stop).ProcessName
  $ftb = New-Object System.Text.StringBuilder 512
  [void][Hikari.D0C]::GetWindowTextW($fg, $ftb, $ftb.Capacity)
  $fgTitleLen = $ftb.Length
} catch { }

$out = [ordered]@{
  windowCount = $windows.Count
  foreground = [ordered]@{ hwnd = $fg.ToString(); process = $fgProc; titleLen = $fgTitleLen }
  windows = @()
}

# Resolve an element to the top-level HWND it lives in, by walking parents and taking the first
# non-zero NativeWindowHandle. Returns 0 if the walk cannot resolve one.
function Get-OwningHwnd($el) {
  $p = $el
  for ($i = 0; $i -lt 40 -and $p -ne $null; $i++) {
    try { $h = $p.Current.NativeWindowHandle } catch { return 0 }
    if ($h -ne 0) { return $h }
    try { $p = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($p) } catch { return 0 }
  }
  return 0
}

foreach ($w in $windows) {
  $row = [ordered]@{ process = $w.process; hwnd = $w.hwnd.ToString(); titleLen = $w.titleLen }
  $root = $null
  try { $root = [System.Windows.Automation.AutomationElement]::FromHandle($w.hwnd) } catch { }
  if ($root -eq $null) { $row['error'] = 'FromHandle null'; $out.windows += $row; continue }

  $cv = Invoke-Pass $root ([System.Windows.Automation.TreeWalker]::ControlViewWalker) $TIME_BUDGET
  $rv = Invoke-Pass $root ([System.Windows.Automation.TreeWalker]::RawViewWalker)     $TIME_BUDGET
  $tv = Invoke-Pass $root ([System.Windows.Automation.TreeWalker]::ContentViewWalker) $TIME_BUDGET

  $name = ''
  try { $name = $root.Current.Name } catch { }

  $cvT = $cv.text; $rvT = $rv.text; $tvT = $tv.text

  $row['textChars']   = [ordered]@{ controlView = $cvT.Length; rawView = $rvT.Length; contentView = $tvT.Length }
  $row['textHashes']  = [ordered]@{ controlView = (Get-TextHash $cvT); rawView = (Get-TextHash $rvT); contentView = (Get-TextHash $tvT) }

  # --- containment: is one strategy's text actually a subset of another's?
  $row['containment'] = [ordered]@{
    rawContainsControl   = ($cvT.Length -gt 0 -and $rvT.Contains($cvT))
    rawContainsContent   = ($tvT.Length -gt 0 -and $rvT.Contains($tvT))
    controlContainsContent = ($tvT.Length -gt 0 -and $cvT.Contains($tvT))
    controlContainsRaw   = ($rvT.Length -gt 0 -and $cvT.Contains($rvT))
  }

  # --- does the window Name (the title) ALSO appear inside the body text?
  # If it does, a reader that concatenates Name + body reports the title twice.
  $row['nameOverlap'] = [ordered]@{
    nameLen = $name.Length
    inControlView = (($name.Length -ge 4) -and $cvT.Contains($name))
    inRawView     = (($name.Length -ge 4) -and $rvT.Contains($name))
    occurrencesInRawView = (Count-Occurrences $rvT $name)
  }

  # --- visibility contamination: how much returned text is flagged offscreen?
  $row['visibility'] = [ordered]@{
    offscreenNodes = $cv.offscreenNodes
    controlViewOffscreenChars = $cv.offscreenTextChars
    controlViewOnscreenChars  = $cv.onscreenTextChars
    rawViewOffscreenChars     = $rv.offscreenTextChars
    rawViewOnscreenChars      = $rv.onscreenTextChars
  }

  # --- pattern census: which interfaces are actually available, and do they agree?
  $row['patterns'] = [ordered]@{
    controlView = [ordered]@{ textEls = $cv.textEls; valueEls = $cv.valueEls; both = $cv.bothEls; legacyEls = $cv.legacyEls }
    rawView     = [ordered]@{ textEls = $rv.textEls; valueEls = $rv.valueEls; both = $rv.bothEls; legacyEls = $rv.legacyEls }
    valueChars  = [ordered]@{ controlView = $cv.value.Length; rawView = $rv.value.Length }
    legacyChars = [ordered]@{ controlView = $cv.legacy.Length; rawView = $rv.legacy.Length }
    valueInsideText = ($cv.value.Length -gt 0 -and $cvT.Contains($cv.value))
    legacyInsideText = ($cv.legacy.Length -gt 0 -and $cvT.Contains($cv.legacy))
  }

  $row['truncation'] = [ordered]@{
    controlView = $cv.truncatedBy; rawView = $rv.truncatedBy; contentView = $tv.truncatedBy
    errors = [ordered]@{ controlView = $cv.errors; rawView = $rv.errors; contentView = $tv.errors }
  }
  $row['elapsedMs'] = [ordered]@{ controlView = $cv.elapsedMs; rawView = $rv.elapsedMs; contentView = $tv.elapsedMs }

  # --- focused element: is it even in this window? A reader that reads "the focused element" as if it
  # belonged to whatever window it happens to be iterating would be reading an unrelated app.
  try {
    $foc = [System.Windows.Automation.AutomationElement]::FocusedElement
    if ($foc -ne $null) {
      $ownHwnd = Get-OwningHwnd $foc
      $fChars = 0; $fTp = $null
      if ($foc.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$fTp)) {
        if ($fTp -ne $null) { $t = $fTp.DocumentRange.GetText(-1); if ($t) { $fChars = $t.Length } }
      }
      $row['focused'] = [ordered]@{
        controlType = $foc.Current.ControlType.ProgrammaticName -replace 'ControlType\.', ''
        owningHwnd  = $ownHwnd.ToString()
        isThisWindow = ($ownHwnd -ne 0 -and $ownHwnd -eq $w.hwnd.ToInt32())
        isForeground = ($ownHwnd -ne 0 -and $ownHwnd -eq $fg.ToInt32())
        textChars   = $fChars
      }
    } else { $row['focused'] = $null }
  } catch { $row['focused'] = 'error' }

  $out.windows += $row
}

$out | ConvertTo-Json -Depth 8 -Compress
