# D0 UIA content-fidelity probe — READ ONLY, no GUI operation.
#
# What this script does: enumerates the top-level windows of named processes, and for each one runs
# the full UIA read-strategy matrix, reporting STRUCTURE AND SIZE ONLY.
#
# What it deliberately never does:
#   · it never transcribes window text. Every text store is reduced to a character count and a
#     SHA-256 prefix. Two reads can therefore be compared for change without either being read.
#   · it never calls a write pattern (no ValuePattern.SetValue, no InvokePattern, no SetFocus).
#   · it never clicks, types, scrolls, or brings a window to the foreground.
#
# Config arrives as base64 JSON in $env:HIKARI_PROBE_CONFIG_B64. See README.md for reproduction.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$cfg = [System.Text.Encoding]::UTF8.GetString(
  [System.Convert]::FromBase64String($env:HIKARI_PROBE_CONFIG_B64)) | ConvertFrom-Json

$MAX_NODES     = [int]$cfg.maxNodes
$MAX_DEPTH     = [int]$cfg.maxDepth
$TIME_BUDGET   = [int]$cfg.timeBudgetMs
$CHAR_CAP      = [int]$cfg.charCap
$DELAY_MS      = [int]$cfg.delayMs
$TARGETS       = @($cfg.targets)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

Add-Type -Namespace Hikari -Name D0 -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, System.IntPtr lParam);
public delegate bool EnumWindowsProc(System.IntPtr hWnd, System.IntPtr lParam);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(System.IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(System.IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint lpdwProcessId);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr hWnd);
'@

$SHA = [System.Security.Cryptography.SHA256]::Create()

function Get-TextHash([string]$s) {
  if ([string]::IsNullOrEmpty($s)) { return '-' }
  $b = [System.Text.Encoding]::UTF8.GetBytes($s)
  return ([System.BitConverter]::ToString($SHA.ComputeHash($b)) -replace '-', '').Substring(0, 12)
}

# Walk a tree and return counts only. $useCache switches between per-property COM round trips and a
# single batched CacheRequest — the difference is the point of measuring both.
function Invoke-Walk {
  param($rootEl, $walker, [bool]$useCache, [int]$budgetMs)

  $st = @{
    nodes = 0; named = 0; textEls = 0; textChars = 0
    offscreenTextEls = 0; offscreenTextChars = 0; onscreenTextChars = 0
    errors = 0; depth = 0; truncatedBy = ''
    ctl = @{}
  }
  $sb = New-Object System.Text.StringBuilder
  $sw = [System.Diagnostics.Stopwatch]::StartNew()

  $cr = $null
  if ($useCache) {
    $cr = New-Object System.Windows.Automation.CacheRequest
    [void]$cr.Add([System.Windows.Automation.AutomationElement]::NameProperty)
    [void]$cr.Add([System.Windows.Automation.AutomationElement]::ControlTypeProperty)
    [void]$cr.Add([System.Windows.Automation.AutomationElement]::IsOffscreenProperty)
    $cr.TreeScope = [System.Windows.Automation.TreeScope]::Subtree
    $cr.Activate()
  }

  function Step($el, $d) {
    if ($st.nodes -ge $MAX_NODES) { if (-not $st.truncatedBy) { $st.truncatedBy = 'nodes' }; return }
    if ($d -gt $MAX_DEPTH)        { if (-not $st.truncatedBy) { $st.truncatedBy = 'depth' }; return }
    if ($sw.ElapsedMilliseconds -gt $budgetMs) { $st.truncatedBy = 'time'; return }
    $st.nodes = $st.nodes + 1
    if ($d -gt $st.depth) { $st.depth = $d }

    $name = ''
    $ctName = '?'
    $offscreen = $false
    try {
      if ($useCache) {
        $name = $el.Cached.Name
        $ctlObj = $el.Cached.ControlType
        $offscreen = $el.Cached.IsOffscreen
      } else {
        $name = $el.Current.Name
        $ctlObj = $el.Current.ControlType
        $offscreen = $el.Current.IsOffscreen
      }
      if ($ctlObj -ne $null) { $ctName = $ctlObj.ProgrammaticName }
    } catch { $st.errors = $st.errors + 1 }

    if ($name -and $name.Length -gt 0) { $st.named = $st.named + 1 }
    if ($st.ctl.ContainsKey($ctName)) { $st.ctl[$ctName] = $st.ctl[$ctName] + 1 } else { $st.ctl[$ctName] = 1 }

    try {
      $tp = $null
      if ($el.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$tp)) {
        if ($tp -ne $null) {
          $st.textEls = $st.textEls + 1
          $t = $tp.DocumentRange.GetText(-1)
          if ($t -and $t.Length -gt 0) {
            $len = $t.Length
            if ($len -gt $CHAR_CAP) { $t = $t.Substring(0, $CHAR_CAP); $len = $CHAR_CAP }
            $st.textChars = $st.textChars + $len
            if ($offscreen) { $st.offscreenTextEls = $st.offscreenTextEls + 1; $st.offscreenTextChars = $st.offscreenTextChars + $len }
            else            { $st.onscreenTextChars = $st.onscreenTextChars + $len }
            [void]$sb.Append($t)
          }
        }
      }
    } catch { }

    try {
      if ($useCache) { $c = $walker.GetFirstChild($el, $cr) } else { $c = $walker.GetFirstChild($el) }
      while ($c -ne $null) {
        Step $c ($d + 1)
        if ($st.truncatedBy -eq 'time' -or $st.nodes -ge $MAX_NODES) { break }
        if ($useCache) { $c = $walker.GetNextSibling($c, $cr) } else { $c = $walker.GetNextSibling($c) }
      }
    } catch { $st.errors = $st.errors + 1 }
  }

  try { Step $rootEl 0 } catch { $st.errors = $st.errors + 1 }
  if ($useCache) { try { $cr.Deactivate() } catch { } }
  $sw.Stop()

  $st['textHash'] = Get-TextHash $sb.ToString()
  $st['elapsedMs'] = $sw.ElapsedMilliseconds
  return $st
}

# Compact form of a walk result, for output.
function Summarize($st) {
  return [ordered]@{
    nodes = $st.nodes; named = $st.named
    textEls = $st.textEls; textChars = $st.textChars
    onscreenChars = $st.onscreenTextChars; offscreenChars = $st.offscreenTextChars
    offscreenTextEls = $st.offscreenTextEls
    depth = $st.depth; errors = $st.errors
    truncatedBy = $st.truncatedBy; textHash = $st.textHash; elapsedMs = $st.elapsedMs
    controlTypes = (($st.ctl.GetEnumerator() | Sort-Object Value -Descending |
      Select-Object -First 6 | ForEach-Object { "$($_.Key -replace 'ControlType\.','')=$($_.Value)" }) -join ' ')
  }
}

# ---------------------------------------------------------------- enumerate windows

$windows = @()
$cb = [Hikari.D0+EnumWindowsProc]{
  param($hWnd, $lParam)
  [uint32]$ownerProcId = 0
  [void][Hikari.D0]::GetWindowThreadProcessId($hWnd, [ref]$ownerProcId)
  try { $pname = (Get-Process -Id $ownerProcId -ErrorAction Stop).ProcessName } catch { return $true }
  if ($TARGETS -notcontains $pname) { return $true }
  $tb = New-Object System.Text.StringBuilder 512
  [void][Hikari.D0]::GetWindowTextW($hWnd, $tb, $tb.Capacity)
  $cbuf = New-Object System.Text.StringBuilder 256
  [void][Hikari.D0]::GetClassNameW($hWnd, $cbuf, $cbuf.Capacity)
  $script:windows += [pscustomobject]@{
    hwnd = $hWnd; pid = $ownerProcId; process = $pname
    titleLen = $tb.Length; className = $cbuf.ToString()
    visible = [Hikari.D0]::IsWindowVisible($hWnd)
    iconic  = [Hikari.D0]::IsIconic($hWnd)
  }
  return $true
}
$script:windows = $windows
[void][Hikari.D0]::EnumWindows($cb, [System.IntPtr]::Zero)
$windows = $script:windows

$out = [ordered]@{
  config = [ordered]@{ maxNodes = $MAX_NODES; maxDepth = $MAX_DEPTH; timeBudgetMs = $TIME_BUDGET; charCap = $CHAR_CAP; targets = $TARGETS }
  windowCount = $windows.Count
  windows = @()
}

# ---------------------------------------------------------------- per window

foreach ($w in $windows) {
  $row = [ordered]@{
    process = $w.process; hwnd = $w.hwnd.ToString(); pid = $w.pid
    titleLen = $w.titleLen; className = $w.className; visible = $w.visible; iconic = $w.iconic
  }

  $root = $null
  try { $root = [System.Windows.Automation.AutomationElement]::FromHandle($w.hwnd) } catch { }
  if ($root -eq $null) {
    $row['root'] = $null
    $row['error'] = 'FromHandle returned null'
    $out.windows += $row
    continue
  }

  $row['root'] = [ordered]@{
    nameLen = $root.Current.Name.Length
    controlType = $root.Current.ControlType.ProgrammaticName
    offscreen = $root.Current.IsOffscreen
  }

  # Tier A — a window a content reader would actually consider: visible and carrying a title.
  # Tier B — everything else: Chromium helper windows, crashpad, IME, hidden renderers.
  # Tier B is NOT skipped. "What would a reader wrongly report for this window" is one of the
  # questions being asked, and the helper windows are where that answer lives.
  $isCandidate = ($w.visible -and $w.titleLen -gt 0)
  if ($isCandidate) { $row['tier'] = 'A' } else { $row['tier'] = 'B' }

  if (-not $isCandidate) {
    $b = Invoke-Walk $root ([System.Windows.Automation.TreeWalker]::ControlViewWalker) $false 5000
    $row['cheap'] = Summarize $b
    $row['misleading'] = [ordered]@{
      rootNameLen = $root.Current.Name.Length
      bestTextChars = $b.textChars
      nameIsOnlySignal = (($root.Current.Name.Length -gt 0) -and ($b.textChars -eq 0))
    }
    $out.windows += $row
    continue
  }

  # --- strategy matrix
  $cv = Invoke-Walk $root ([System.Windows.Automation.TreeWalker]::ControlViewWalker) $false $TIME_BUDGET
  $rv = Invoke-Walk $root ([System.Windows.Automation.TreeWalker]::RawViewWalker)     $false $TIME_BUDGET
  $tv = Invoke-Walk $root ([System.Windows.Automation.TreeWalker]::ContentViewWalker) $false $TIME_BUDGET
  $cc = Invoke-Walk $root ([System.Windows.Automation.TreeWalker]::ControlViewWalker) $true  $TIME_BUDGET
  $rc = Invoke-Walk $root ([System.Windows.Automation.TreeWalker]::RawViewWalker)     $true  $TIME_BUDGET

  $row['controlView']        = Summarize $cv
  $row['rawView']            = Summarize $rv
  $row['contentView']        = Summarize $tv
  $row['controlViewCached']  = Summarize $cc
  $row['rawViewCached']      = Summarize $rc

  # --- the misleading-result hazard: a non-empty Name with no readable text at all.
  $row['misleading'] = [ordered]@{
    rootNameLen = $root.Current.Name.Length
    bestTextChars = [Math]::Max([Math]::Max($cv.textChars, $rv.textChars), $tv.textChars)
    nameIsOnlySignal = (($root.Current.Name.Length -gt 0) -and ($cv.textChars -eq 0) -and ($rv.textChars -eq 0) -and ($tv.textChars -eq 0))
  }

  # --- focused element, and whether it belongs to this window
  try {
    $foc = [System.Windows.Automation.AutomationElement]::FocusedElement
    if ($foc -ne $null) {
      $fsw = [System.Diagnostics.Stopwatch]::StartNew()
      $fTp = $null; $fChars = 0; $fHasText = $false
      if ($foc.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$fTp)) {
        if ($fTp -ne $null) { $fHasText = $true; $ft = $fTp.DocumentRange.GetText(-1); if ($ft) { $fChars = $ft.Length } }
      }
      $fsw.Stop()
      # walk up to see if this window is an ancestor
      $belongs = $false
      try {
        $p = $foc
        for ($i = 0; $i -lt 30 -and $p -ne $null; $i++) {
          if ($p.Current.NativeWindowHandle -eq $w.hwnd.ToInt32()) { $belongs = $true; break }
          $p = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($p)
        }
      } catch { }
      $row['focused'] = [ordered]@{
        controlType = $foc.Current.ControlType.ProgrammaticName
        nameLen = $foc.Current.Name.Length
        hasTextPattern = $fHasText; textChars = $fChars
        belongsToThisWindow = $belongs
        elapsedMs = $fsw.ElapsedMilliseconds
      }
    } else { $row['focused'] = $null }
  } catch { $row['focused'] = 'error' }

  # --- targeted search: the two control types a content reader would actually go after
  try {
    $cond = New-Object System.Windows.Automation.OrCondition(
      (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Document)),
      (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Text)))
    $tsw = [System.Diagnostics.Stopwatch]::StartNew()
    $found = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
    $tsw.Stop()
    $tChars = 0; $tEls = 0
    for ($i = 0; $i -lt $found.Count -and $i -lt 400; $i++) {
      try {
        $e = $found.Item($i)
        $tp = $null
        if ($e.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$tp)) {
          if ($tp -ne $null) { $tEls++; $t = $tp.DocumentRange.GetText(-1); if ($t) { $tChars += $t.Length } }
        }
      } catch { }
    }
    $row['targeted'] = [ordered]@{
      matched = $found.Count; scanned = [Math]::Min($found.Count, 400)
      withText = $tEls; textChars = $tChars; elapsedMs = $tsw.ElapsedMilliseconds
    }
  } catch { $row['targeted'] = 'error' }

  # --- children breakdown: can navigation/chrome be told apart from the body?
  $kids = @()
  try {
    $cw = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $c = $cw.GetFirstChild($root)
    $i = 0
    while ($c -ne $null -and $i -lt 12) {
      $kid = [ordered]@{ index = $i }
      try {
        $kid['controlType'] = $c.Current.ControlType.ProgrammaticName -replace 'ControlType\.', ''
        $kid['nameLen'] = $c.Current.Name.Length
        $kid['offscreen'] = $c.Current.IsOffscreen
      } catch { $kid['error'] = 'read' }
      $ks = Invoke-Walk $c $cw $false 4000
      $kid['nodes'] = $ks.nodes; $kid['textChars'] = $ks.textChars
      $kid['textHash'] = $ks.textHash; $kid['truncatedBy'] = $ks.truncatedBy
      $kids += $kid
      $i++
      try { $c = $cw.GetNextSibling($c) } catch { break }
    }
  } catch { }
  $row['children'] = $kids

  # --- freshness: same reads again after a delay. Hashes are compared, never printed as text.
  if ($DELAY_MS -gt 0) {
    Start-Sleep -Milliseconds $DELAY_MS
    $cv2 = Invoke-Walk $root ([System.Windows.Automation.TreeWalker]::ControlViewWalker) $false $TIME_BUDGET
    $rv2 = Invoke-Walk $root ([System.Windows.Automation.TreeWalker]::RawViewWalker)     $false $TIME_BUDGET
    $row['freshness'] = [ordered]@{
      delayMs = $DELAY_MS
      controlViewSame = ($cv2.textHash -eq $cv.textHash)
      controlViewHash2 = $cv2.textHash
      controlViewCharsDelta = ($cv2.textChars - $cv.textChars)
      rawViewSame = ($rv2.textHash -eq $rv.textHash)
      rawViewHash2 = $rv2.textHash
      rawViewCharsDelta = ($rv2.textChars - $rv.textChars)
    }
  }

  $out.windows += $row
}

$out | ConvertTo-Json -Depth 8 -Compress
