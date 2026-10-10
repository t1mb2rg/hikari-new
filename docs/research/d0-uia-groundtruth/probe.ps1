# HIKARI D0 ground-truth experiment — the UIA probe.
#
# Runs in its OWN process, reads the test window, and emits JSON on stdout. Every marker it
# finds is classified against a marker inventory supplied by the driver; any marker belonging
# to another window or another process is reported as misattribution rather than being filtered.
#
# Read-only: no ValuePattern.SetValue, no Invoke, no SetFocus, no clicks, no input.
#
# Two optional capabilities, both off by default:
#   -PixelProbe   capture the window with PrintWindow and report which marker colours are painted
#                 where the ground truth says they should be.
#   -HwndCoverage count elements carrying their own NativeWindowHandle.

param(
  [Parameter(Mandatory = $true)][int]$Hwnd,
  [ValidateSet('control', 'raw', 'content', 'targeted', 'focused')][string]$Strategy = 'control',
  [int]$MaxDepth = 40,
  [int]$MaxNodes = 4000,
  [int]$CharCap = 2000000,
  [string]$InventoryPath,      # truth.json from the test window
  [switch]$PixelProbe
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
if ($PixelProbe) { Add-Type -AssemblyName System.Drawing }

# ONE definition for both modes. Two divergent definitions of the same type name meant the
# client-area lookup silently did not exist in pixel mode, and a null client rect reads as
# "no evidence" rather than as an error.
Add-Type -Namespace H -Name G -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool PrintWindow(System.IntPtr h, System.IntPtr hdc, uint flags);
[DllImport("user32.dll")] public static extern bool GetWindowRect(System.IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern bool GetClientRect(System.IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern bool ClientToScreen(System.IntPtr h, ref POINT p);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr h);
[DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr h);
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint p);
public struct RECT { public int L, T, R, B; }
public struct POINT { public int X, Y; }
'@

$e = [System.Windows.Automation.AutomationElement]
$walker = switch ($Strategy) {
  'raw'     { [System.Windows.Automation.TreeWalker]::RawViewWalker }
  'content' { [System.Windows.Automation.TreeWalker]::ContentViewWalker }
  default   { [System.Windows.Automation.TreeWalker]::ControlViewWalker }
}

$root = $e::FromHandle([IntPtr]$Hwnd)
if (-not $root) {
  [ordered]@{ ok = $false; error = 'FromHandle returned null'; strategy = $Strategy } | ConvertTo-Json -Depth 6 -Compress
  exit 0
}

# ------------------------------------------------------------------ walk
# Declared before $st so the reference stored in $st points at the list that gets filled.
$script:offSample = New-Object System.Collections.ArrayList
$st = [ordered]@{
  nodes = 0; textEls = 0; textChars = 0; named = 0; namedNoText = 0
  offscreenNodes = 0; offscreenTextEls = 0; errors = 0
  maxDepth = 0; truncatedBy = ''
}
$st.offscreenSample = $script:offSample
$markers = New-Object System.Collections.ArrayList   # every GT-* string seen, with its carrier
$startMs = [int64]((Get-Date).ToUniversalTime() - (Get-Date '1970-01-01')).TotalMilliseconds

function Note-Marker($s, $depth, $src, $controlType, $offscreen, $rect, $ancestors) {
  if ($s -and $s.StartsWith('GT-')) {
    [void]$script:markers.Add([ordered]@{
      text = $s; depth = $depth; source = $src
      controlType = $controlType; isOffscreen = $offscreen
      rect = $rect; ancestors = $ancestors
    })
  }
}

# BoundingRectangle is UIA's own answer to "where is this element on screen". It is the only
# placement signal available WITHOUT private knowledge of the app, so whether a reader can
# derive "currently visible" from it is the constructive question this experiment has to answer.
function Rect-Of($el) {
  try {
    $b = $el.Current.BoundingRectangle
    if ($b.IsEmpty) { return [ordered]@{ empty = $true } }
    return [ordered]@{
      x = [int][math]::Round($b.X); y = [int][math]::Round($b.Y)
      w = [int][math]::Round($b.Width); h = [int][math]::Round($b.Height)
    }
  } catch { return [ordered]@{ error = $true } }
}

# The clip chain, as a READER could legitimately obtain it: TreeWalker.GetParent + BoundingRectangle
# on each ancestor. An ancestor clips its subtree, so intersecting the element rect with every
# ancestor rect is the closest UIA-only approximation of "would the renderer paint this". Recorded
# raw rather than evaluated here, so the verification can try the rule instead of assuming it works.
function Ancestors-Of($el, $maxUp = 14) {
  $chain = New-Object System.Collections.ArrayList
  try {
    $p = $el
    for ($i = 0; $i -lt $maxUp; $i++) {
      $p = [System.Windows.Automation.TreeWalker]::RawViewWalker.GetParent($p)
      if ($null -eq $p) { break }
      $ct = ''
      try { $ct = $p.Current.ControlType.ProgrammaticName } catch { }
      $scrollable = $false
      try { $scrollable = [bool]$p.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsScrollPatternAvailableProperty) } catch { }
      $poff = $false
      try { $poff = [bool]$p.Current.IsOffscreen } catch { }
      [void]$chain.Add([ordered]@{ ct = $ct; scrollable = $scrollable; offscreen = $poff; rect = (Rect-Of $p) })
    }
  } catch { }
  return $chain
}

function Step($el, $d) {
  if ($st.nodes -ge $MaxNodes) { if (-not $st.truncatedBy) { $st.truncatedBy = 'nodes' }; return }
  if ($d -gt $MaxDepth) { if (-not $st.truncatedBy) { $st.truncatedBy = 'depth' }; return }
  $st.nodes++
  if ($d -gt $st.maxDepth) { $st.maxDepth = $d }

  $name = ''; $ct = ''; $off = $false
  try { $name = $el.Current.Name } catch { $st.errors++ }
  try { $ct = $el.Current.ControlType.ProgrammaticName } catch { }
  try { $off = [bool]$el.Current.IsOffscreen } catch { }
  $rect = $null; $anc = $null
  if ($name -and $name.StartsWith('GT-')) { $rect = Rect-Of $el; $anc = Ancestors-Of $el }
  if ($off) {
    $st.offscreenNodes++
    # A count alone cannot say whether the flag tracked anything real. Keep a sample.
    if ($script:offSample.Count -lt 10) { [void]$script:offSample.Add([ordered]@{ name = $name; controlType = $ct; depth = $d }) }
  }
  if ($name) { $st.named++ }
  Note-Marker $name $d 'Name' $ct $off $rect $anc

  $hasText = $false
  try {
    $tp = $null
    if ($el.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$tp)) {
      if ($tp -ne $null) {
        $hasText = $true
        $st.textEls++
        if ($off) { $st.offscreenTextEls++ }
        try {
          $s = $tp.DocumentRange.GetText(-1)
          if ($s) {
            if ($s.Length -gt $CharCap) { $s = $s.Substring(0, $CharCap) }
            $st.textChars += $s.Length
            Note-Marker $s.Trim() $d 'TextPattern' $ct $off $rect
          }
        } catch { $st.errors++ }
      }
    }
  } catch { $st.errors++ }
  if ($name -and -not $hasText) { $st.namedNoText++ }

  # ValuePattern text is a separate channel; keep it separable from TextPattern text.
  try {
    $vp = $null
    if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
      if ($vp -ne $null) {
        try { Note-Marker ($vp.Current.Value) $d 'ValuePattern' $ct $off $rect } catch { }
      }
    }
  } catch { }

  try {
    $c = $walker.GetFirstChild($el)
    while ($c -ne $null) { Step $c ($d + 1); if ($st.truncatedBy -and $st.nodes -ge $MaxNodes) { return }; $c = $walker.GetNextSibling($c) }
  } catch { $st.errors++ }
}

if ($Strategy -eq 'targeted') {
  # Everything that can carry text, regardless of position in the tree.
  $cond = New-Object System.Windows.Automation.OrCondition(
    (New-Object System.Windows.Automation.PropertyCondition($e::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document)),
    (New-Object System.Windows.Automation.PropertyCondition($e::ControlTypeProperty, [System.Windows.Automation.ControlType]::Text)))
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
  $st.nodes = $all.Count
  for ($i = 0; $i -lt $all.Count; $i++) {
    $el = $all.Item($i)
    $name = ''; $ct = ''; $off = $false
    try { $name = $el.Current.Name } catch { }
    try { $ct = $el.Current.ControlType.ProgrammaticName } catch { }
    try { $off = [bool]$el.Current.IsOffscreen } catch { }
    if ($off) { $st.offscreenNodes++ }
    if ($name) { $st.named++ }
    Note-Marker $name 0 'Name' $ct $off
    try {
      $tp = $null
      if ($el.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$tp)) {
        if ($tp -ne $null) {
          $st.textEls++
          if ($off) { $st.offscreenTextEls++ }
          $s = $tp.DocumentRange.GetText(-1)
          if ($s) {
            if ($s.Length -gt $CharCap) { $s = $s.Substring(0, $CharCap) }
            $st.textChars += $s.Length
            Note-Marker $s.Trim() 0 'TextPattern' $ct $off
          }
        }
      }
    } catch { $st.errors++ }
  }
} elseif ($Strategy -eq 'focused') {
  # AUTOMATIONELEMENT.FOCUSELEMENT IS GLOBALLY SCOPED. Whatever the human has focused — in any
  # process on the desktop — comes back from this call, regardless of the handle passed in.
  # So the element is resolved, its owning window is established FIRST, and its text is only
  # ever recorded when that window is the requested target. Text belonging to any other window
  # is counted and then discarded unread: this experiment may measure that foreign content is
  # reachable, but it must not keep it.
  $fe = $e::FocusedElement
  if ($fe -eq $null) {
    $st.truncatedBy = 'no-focused-element'
  } else {
    $st.nodes = 1
    $owningHwnd = 0
    try {
      $cur = $fe; $hops = 0
      while ($cur -ne $null -and $hops -lt 80) {
        $h = 0
        try { $h = [int]$cur.Current.NativeWindowHandle } catch { }
        if ($h -ne 0) { $owningHwnd = $h; break }
        $cur = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($cur); $hops++
      }
    } catch { }
    $isMine = ($owningHwnd -eq [int]$Hwnd)
    $st.owningHwnd = $owningHwnd
    $st.isThisWindow = $isMine

    $name = ''; $ct = ''; $off = $false
    try { $name = $fe.Current.Name } catch { }
    try { $ct = $fe.Current.ControlType.ProgrammaticName } catch { }
    try { $off = [bool]$fe.Current.IsOffscreen } catch { }
    $st.controlType = $ct
    $st.uiaOffscreen = $off
    if ($isMine) { Note-Marker $name 0 'Name' $ct $off } else { if ($name) { $st.foreignNameChars = $name.Length } }

    $tp = $null
    try { [void]$fe.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$tp) } catch { }
    if ($tp -ne $null) {
      $st.textEls = 1
      $len = 0
      try { $s = $tp.DocumentRange.GetText(-1); if ($s) { $len = $s.Length } } catch { }
      if ($isMine) {
        if ($len -gt 0) { try { Note-Marker ($tp.DocumentRange.GetText(-1)).Trim() 0 'TextPattern' $ct $off } catch { } }
        $st.textChars = $len
      } else {
        # Counted, never stored. The string is dropped here and never enters an artifact.
        $st.foreignTextChars = $len
      }
    }
    $vp = $null
    try { [void]$fe.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp) } catch { }
    if ($vp -ne $null) {
      if ($isMine) { try { Note-Marker ($vp.Current.Value) 0 'ValuePattern' $ct $off } catch { } }
      else { try { $vv = $vp.Current.Value; if ($vv) { $st.foreignValueChars = $vv.Length } } catch { } }
    }
  }
} else {
  Step $root 0
}
$elapsed = [int64]((Get-Date).ToUniversalTime() - (Get-Date '1970-01-01')).TotalMilliseconds - $startMs

# ------------------------------------------------------------------ foreground / own window identity
$fg = [H.G]::GetForegroundWindow()
$fgPid = 0
[void][H.G]::GetWindowThreadProcessId($fg, [ref]$fgPid)
$ownPid = 0
[void][H.G]::GetWindowThreadProcessId([IntPtr]$Hwnd, [ref]$ownPid)

# ------------------------------------------------------------------ classify markers against the inventory
$cls = $null
if ($InventoryPath -and (Test-Path $InventoryPath)) {
  $inv = Get-Content $InventoryPath -Raw | ConvertFrom-Json
  $belongs = @{}
  foreach ($m in $inv.markers) { $belongs[$m.text] = $m }
  $cls = New-Object System.Collections.ArrayList
  foreach ($mk in $markers) {
    $txt = $mk.text
    # A TextPattern read returns a block; find every inventory marker contained in it.
    $hits = @($belongs.Keys | Where-Object { $txt.Contains($_) })
    if ($hits.Count -eq 0) {
      [void]$cls.Add([ordered]@{ text = $txt; source = $mk.source; verdict = 'unknown' })
    }
    foreach ($h in $hits) {
      $g = $belongs[$h]
      $verdict = 'visible'
      if (-not $g.expectVisible) {
        $verdict = switch ($g.declared) {
          'collapsed'    { 'HIDDEN-COLLAPSED' }
          'hidden'       { 'HIDDEN-VISIBILITY' }
          'zero-opacity' { 'HIDDEN-OPACITY' }
          'other-window' { 'OTHER-WINDOW' }
          default {
            if (-not $g.tabActive) { 'INACTIVE-TAB' }
            elseif ($g.expectPartial -eq $true) { 'PARTIAL-AT-EDGE' }
            elseif ($g.inViewport -eq $false) { 'SCROLLED-OUT' }
            else { 'NOT-EXPECTED' }
          }
        }
        if ($g.region -eq 'other-process') { $verdict = 'OTHER-PROCESS' }
      }
      [void]$cls.Add([ordered]@{
        text = $h; source = $mk.source; controlType = $mk.controlType
        uiaOffscreen = $mk.isOffscreen; verdict = $verdict
        declared = $g.declared; region = $g.region; tab = $g.tab
        expectVisible = [bool]$g.expectVisible
        expectPartial = ($g.expectPartial -eq $true)
        inViewport = $g.inViewport
        fullyInsideViewport = $g.fullyInsideViewport
      })
    }
  }
}

# ------------------------------------------------------------------ pixel probe
$px = $null
if ($PixelProbe -and $InventoryPath -and (Test-Path $InventoryPath)) {
  $inv = Get-Content $InventoryPath -Raw | ConvertFrom-Json
  $r = New-Object H.G+RECT
  [void][H.G]::GetWindowRect([IntPtr]$Hwnd, [ref]$r)
  $w = $r.R - $r.L; $h = $r.B - $r.T
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $hdc = $g.GetHdc()
  $ok = [H.G]::PrintWindow([IntPtr]$Hwnd, $hdc, 2)
  $g.ReleaseHdc($hdc); $g.Dispose()

  $rows = New-Object System.Collections.ArrayList
  foreach ($m in $inv.markers) {
    # Input controls paint no marker colour of their own, so the colour test does not apply.
    if ($m.region -eq 'inputs') { continue }
    if (-not $m.samplePoint) { continue }
    $sx = [int]$m.samplePoint[0]; $sy = [int]$m.samplePoint[1]
    $bx = $sx - $r.L; $by = $sy - $r.T
    $painted = $false; $got = $null
    if ($bx -ge 0 -and $bx -lt $w -and $by -ge 0 -and $by -lt $h) {
      try {
        $p = $bmp.GetPixel($bx, $by)
        $got = @([int]$p.R, [int]$p.G, [int]$p.B)
        $exp = @([int]$m.rgb[0], [int]$m.rgb[1], [int]$m.rgb[2])
        # Allow a small tolerance: colour is exact, but antialiasing near edges is not our subject.
        $painted = ([math]::Abs($got[0] - $exp[0]) -le 2) -and ([math]::Abs($got[1] - $exp[1]) -le 2) -and ([math]::Abs($got[2] - $exp[2]) -le 2)
      } catch { }
    }
    [void]$rows.Add([ordered]@{
      text = $m.text; region = $m.region; declared = $m.declared
      expectVisible = [bool]$m.expectVisible
      inBitmap = ($bx -ge 0 -and $bx -lt $w -and $by -ge 0 -and $by -lt $h)
      pixelAtSample = $got; paintedThere = [bool]$painted
    })
  }
  $bmp.Dispose()
  $px = [ordered]@{
    printWindowOk  = $ok
    windowVisible  = [H.G]::IsWindowVisible([IntPtr]$Hwnd)
    windowIconic   = [H.G]::IsIconic([IntPtr]$Hwnd)
    rect = @($r.L, $r.T, $w, $h)
    rows = $rows
  }
}

# ------------------------------------------------------------------ client area, in screen coordinates
# Element bounding rectangles are in SCREEN coordinates and the window's own rect includes its
# frame, so "is this element on screen" needs the client area, not the window rect.
$client = $null
try {
  $cr = New-Object H.G+RECT
  $pt = New-Object H.G+POINT
  if ([H.G]::GetClientRect([IntPtr]$Hwnd, [ref]$cr)) {
    $pt.X = 0; $pt.Y = 0
    [void][H.G]::ClientToScreen([IntPtr]$Hwnd, [ref]$pt)
    $client = [ordered]@{ x = $pt.X; y = $pt.Y; w = $cr.R - $cr.L; h = $cr.B - $cr.T }
  }
} catch { }

# ------------------------------------------------------------------ scroll state, as UIA reports it
# If a reader must know which part of a scrolling region is showing, UIA has to expose it.
$scrolls = New-Object System.Collections.ArrayList
try {
  $cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::IsScrollPatternAvailableProperty, $true)
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
  for ($i = 0; $i -lt $all.Count; $i++) {
    $se = $all.Item($i)
    try {
      $sp = $se.GetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern)
      if ($sp -ne $null) {
        [void]$scrolls.Add([ordered]@{
          name = $se.Current.Name
          verticalScrollPercent = $sp.Current.VerticalScrollPercent
          verticalViewSize     = $sp.Current.VerticalViewSize
          verticallyScrollable = $sp.Current.VerticallyScrollable
          rect = (Rect-Of $se)
        })
      }
    } catch { }
  }
} catch { }

# ------------------------------------------------------------------ what does UIA itself say about the window?
# A content walk cannot report that the window is minimized; this asks UIA directly, so the
# report can say whether the information was available at all or only obtainable from Win32.
$win = [ordered]@{ rootOffscreen = $null; windowPattern = $false; visualState = $null; canMinimize = $null }
try { $win.rootOffscreen = [bool]$root.Current.IsOffscreen } catch { }
try {
  $wp = $null
  if ($root.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern, [ref]$wp)) {
    if ($wp -ne $null) {
      $win.windowPattern = $true
      try { $win.visualState = $wp.Current.WindowVisualState.ToString() } catch { }
      try { $win.canMinimize = [bool]$wp.Current.CanMinimize } catch { }
    }
  }
} catch { }

# ------------------------------------------------------------------ emit
$result = [ordered]@{
  ok = $true
  window = $win
  clientOnScreen = $client
  scrollables = $scrolls
  strategy = $Strategy
  hwnd = $Hwnd
  windowPid = $ownPid
  probePid = $PID
  foreground = [ordered]@{ hwnd = $fg.ToString(); pid = $fgPid; isTarget = ($fg -eq [IntPtr]$Hwnd) }
  walk = $st
  elapsedMs = $elapsed
  markers = $markers
  classified = $cls
  pixels = $px
}
$result | ConvertTo-Json -Depth 8 -Compress
