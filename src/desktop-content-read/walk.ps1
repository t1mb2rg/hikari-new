# The desktop content walk, as PowerShell.
#
# This is a file rather than a string assembled on a command line, and that is the whole of why it
# exists. The walk used to be built in uia.ts and handed to powershell.exe as -EncodedCommand, which
# makes it one CreateProcess command line: a hard limit of 32,767 characters, and base64 of UTF-16
# doubles the script inside it. Measured with that transport, the walk was 12,064 characters of
# script, 31,812 of base64, and 31,870 of command line -- 897 characters of base64 left, which is
# about 336 characters of script, which is four lines of comment. A bound that a comment can spend is
# not a bound, and the failure mode was not even legible: overrunning it made execFile throw
# spawn ENAMETOOLONG out of a Promise executor, so the walk rejected with a raw Error and the
# endpoint reported a failed read naming neither the script nor its size.
#
# The command line is now the interpreter plus this path plus eight small arguments -- measured at
# 169 characters -- and it does not grow when this file does.
#
# Nothing is interpolated into code here either. The handle and the expected process id used to be
# formatted into the script text, guarded by the argument that a decimal spelling of a safe integer
# cannot contain a quote or a semicolon; they arrive as -File arguments now, where PowerShell does
# not read them as code at all.
#
# KEEP THIS FILE PURE ASCII.
#
# PowerShell reads a .ps1 with no byte-order mark using the system ANSI code page -- 936 on the
# machine this was written on -- so a UTF-8 character in here is decoded into something else. That is
# not cosmetic. Measured on this machine: a UTF-8 character inside a string literal made the parser
# report a missing string terminator and exit 1, because the decoded bytes swallowed the closing
# quote; the same character in a comment survived. A byte-order mark would also work, and is a worse
# bargain: it is
# invisible, one editor setting away from being dropped, and then the file is silently wrong. Pure
# ASCII needs no mark and no care. A test asserts the shipped file is ASCII.
param(
  [long]$Handle,
  [long]$ExpectedPid,
  [int]$MaxDepth,
  [int]$MaxNodes,
  [int]$MaxChars,
  [double]$EdgeTolerance,
  [string]$ClientAreaId,
  [string]$UnidentifiedId
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -Namespace Hikari -Name ContentReadWindow -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool IsWindow(System.IntPtr hWnd);
[DllImport("user32.dll", SetLastError = true)] public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint lpdwProcessId);
[DllImport("user32.dll")] public static extern bool GetClientRect(System.IntPtr hWnd, out RECT r);
[DllImport("user32.dll")] public static extern bool ClientToScreen(System.IntPtr hWnd, ref POINT p);
public struct RECT { public int L; public int T; public int R; public int B; }
public struct POINT { public int X; public int Y; }
'@

$ScrollPatternAvailableProperty = [System.Windows.Automation.AutomationElement]::IsScrollPatternAvailableProperty

function Write-Result($value) {
  $json = $value | ConvertTo-Json -Depth 12 -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $output = [System.Console]::OpenStandardOutput()
  $output.Write($bytes, 0, $bytes.Length)
  $output.Flush()
}

function Fail($reason) {
  Write-Result ([ordered]@{ ok = $false; reason = $reason })
  exit 0
}

$target = [IntPtr]$Handle

# --- 3.4 guard 1, before the walk: the handle must still address the window the sample saw.
if (-not [Hikari.ContentReadWindow]::IsWindow($target)) { Fail 'window-gone' }
[uint32]$pidBefore = 0
[void][Hikari.ContentReadWindow]::GetWindowThreadProcessId($target, [ref]$pidBefore)
if ($ExpectedPid -gt 0 -and $pidBefore -ne $ExpectedPid) { Fail 'window-replaced' }

$automation = [System.Windows.Automation.AutomationElement]
$root = $null
try { $root = $automation::FromHandle($target) } catch { $root = $null }
if ($null -eq $root) { Fail 'element-unreadable' }
try { $null = $root.Current } catch { Fail 'element-unreadable' }

# --- the client area, in screen coordinates, as the stand-in frame.
$clientRect = $null
try {
  $r = New-Object Hikari.ContentReadWindow+RECT
  $p = New-Object Hikari.ContentReadWindow+POINT
  if ([Hikari.ContentReadWindow]::GetClientRect($target, [ref]$r)) {
    $p.X = 0; $p.Y = 0
    [void][Hikari.ContentReadWindow]::ClientToScreen($target, [ref]$p)
    $clientRect = [ordered]@{ x = [double]$p.X; y = [double]$p.Y; w = [double]($r.R - $r.L); h = [double]($r.B - $r.T) }
  }
} catch { $clientRect = $null }

$readAt = [System.DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fff', [System.Globalization.CultureInfo]::InvariantCulture) + 'Z'

$script:counted = [ordered]@{ truncatedBy = $null; scanned = 0; matched = 0; textChars = 0 }
$script:stopped = $false
$script:regions = [ordered]@{}
$script:order = New-Object System.Collections.ArrayList

function Stop-With($what) {
  if (-not $script:counted.truncatedBy) { $script:counted.truncatedBy = $what }
  $script:stopped = $true
}

function Region-For($frameId, $relation, $reason) {
  $regionKey = "$frameId|$relation|$reason"
  if (-not $script:regions.Contains($regionKey)) {
    $script:regions[$regionKey] = [ordered]@{
      id = $frameId
      viewportRelation = $relation
      notVisibleBecause = $reason
      nodes = (New-Object System.Collections.ArrayList)
    }
    [void]$script:order.Add($regionKey)
  }
  return $script:regions[$regionKey]
}

function Add-Node($frameId, $relation, $reason, $text, $channel, $depth) {
  if ($script:counted.textChars -ge $MaxChars) { Stop-With 'chars'; return $false }
  $remaining = $MaxChars - $script:counted.textChars
  if ($text.Length -gt $remaining) {
    $text = $text.Substring(0, $remaining)
    Stop-With 'chars'
  }
  $region = Region-For $frameId $relation $reason
  [void]$region.nodes.Add([ordered]@{ channel = $channel; text = $text; depth = $depth })
  $script:counted.textChars += $text.Length
  return $true
}

function Rect-Of($info) {
  try {
    $b = $info.BoundingRectangle
    if ($b.IsEmpty) { return $null }
    return [ordered]@{ x = $b.X; y = $b.Y; w = $b.Width; h = $b.Height }
  } catch { return $null }
}

function Relation-Of($rect, $frame) {
  if ($null -eq $rect -or $null -eq $frame) { return 'unknown' }
  if ($rect.w -le 0 -or $rect.h -le 0 -or $frame.w -le 0 -or $frame.h -le 0) { return 'unknown' }
  $x2 = [math]::Min($rect.x + $rect.w, $frame.x + $frame.w)
  $y2 = [math]::Min($rect.y + $rect.h, $frame.y + $frame.h)
  if (($x2 - [math]::Max($rect.x, $frame.x)) -le 0) { return 'outside' }
  if (($y2 - [math]::Max($rect.y, $frame.y)) -le 0) { return 'outside' }
  if (($rect.x -ge ($frame.x - $EdgeTolerance)) -and
      ($rect.y -ge ($frame.y - $EdgeTolerance)) -and
      (($rect.x + $rect.w) -le ($frame.x + $frame.w + $EdgeTolerance)) -and
      (($rect.y + $rect.h) -le ($frame.y + $frame.h + $EdgeTolerance))) { return 'inside' }
  return 'partial'
}

function Reason-Of($relation, $offscreen) {
  if ($offscreen) { return 'offscreen' }
  if ($relation -eq 'outside') { return 'clipped-by-ancestor' }
  return $null
}

function Element-Id($el) {
  try {
    $rid = $el.GetRuntimeId()
    if ($null -ne $rid -and $rid.Length -gt 0) { return ($rid -join '-') }
  } catch { }
  return $UnidentifiedId
}

function Step($el, $depth, $frameId, $frameRect) {
  if ($script:stopped) { return }
  if ($script:counted.scanned -ge $MaxNodes) { Stop-With 'nodes'; return }
  # Global, not per-branch, and deliberately: Stop-With sets a flag that every sibling loop in Step
  # checks, so reaching the depth bound ends the traversal instead of pruning the branch that reached
  # it. A window whose first child is deep therefore loses everything the walk had not reached yet.
  # Accepted as the first-slice semantics (F2 of the implementation mandate); per-branch pruning would
  # need this function to return a decision up the recursion instead of reading a shared flag. The
  # outward sentence in presentation.ts and the note beside READ_MAX_DEPTH in types.ts say the same
  # thing, and a test drives a synthetic window deep enough to tell the two semantics apart.
  if ($depth -gt $MaxDepth) { Stop-With 'depth'; return }
  $script:counted.scanned++

  $info = $null
  try { $info = $el.Current } catch { return }

  $name = ''
  $offscreen = $false
  $scrollable = $false
  try { $name = $info.Name } catch { }
  try { $offscreen = [bool]$info.IsOffscreen } catch { }
  # Read through the property accessor, NOT $info.IsScrollPatternAvailable.
  #
  # The convenience property on AutomationElementInformation was measured broken on this box: over
  # 2352 raw-view elements of a live Chromium window it returned false for every one of them, while
  # this accessor returned true for 58 and an independent eager TryGetCurrentPattern agreed on all 58
  # (the 58 disagreements between the two were all "convenience=false, both others=true"). Reading it
  # through the broken accessor silently disabled scroll framing: every region fell back to the window
  # client area, which is the R1 rule the ground truth scored at 7 wrong. Name and IsOffscreen read
  # fine off the same struct (2352/2352), so this is specific to the Is*PatternAvailable members.
  #
  # This is also the accessor the ground-truth probe scored 135/136 with (probe.ps1:107), so the fix
  # restores agreement with the measurement rather than introducing a new rule.
  try { $scrollable = [bool]$el.GetCurrentPropertyValue($ScrollPatternAvailableProperty) } catch { }

  $rect = Rect-Of $info

  # This element's own relation is to the frame it was reached through, and the order here is
  # load-bearing: the frame a scroll container *becomes* is the frame for what is under it, not for
  # itself.
  #
  # Measured before this was reordered, and the reorder is the fix: the assignment below used to run
  # first, so a scroll container's own relation was computed as Relation-Of($rect, $rect) -- always
  # 'inside' for a non-empty rect. R2 frames an element against its nearest scrollable *ancestor*, so
  # the two disagreed for exactly the containers themselves: msedge 7 of 20 scrollables, ChatGPT 9 of
  # 13, with instances like a rect of 1044,-14691,2,2 (sixteen thousand pixels above its frame) and one
  # of 2218,1494,192,37 (58px below a frame ending at y=1436) both reported as inside. Over-reporting in
  # the one direction 3.7 gives no cover for: inside is a claim about the frame, and these are outside
  # it.
  #
  # There are no backticks anywhere in this script's comments, here or below. That used to be a hard
  # requirement, when this text was a TypeScript template literal that a backtick would have ended;
  # it is now a .ps1 file and the requirement is gone. The rule is kept because every comment below
  # was written under it and it costs nothing, not because anything enforces it.
  $relation = Relation-Of $rect $frameRect
  $reason = Reason-Of $relation $offscreen

  # And now the frame for everything under this element. The rect is read once, on entry, which is what
  # makes this an O(1)-per-element derivation rather than an ancestor walk per element.
  #
  # $frameId and $childFrameId are two different frames from here down, and keeping them apart is the
  # whole of the correction above: this element's own text belongs to the frame it was *reached through*
  # -- $frameId, which is what $relation was just computed against -- while only what is under it
  # belongs to the frame this element becomes. Filing the element's own text under $childFrameId would
  # pair a region's frame with a relation measured against a different one, so a scrolled-out
  # container's own text would read as outside *the container* instead of outside the frame it sits in.
  $childFrameId = $frameId
  $childFrameRect = $frameRect
  if ($scrollable -and $null -ne $rect) {
    $childFrameId = Element-Id $el
    $childFrameRect = $rect
  }

  $contributed = $false
  if ($name -and $name.Trim().Length -gt 0) {
    if (Add-Node $frameId $relation $reason $name 'name' $depth) { $contributed = $true }
    if ($script:stopped) { return }
  }

  try {
    $tp = $null
    if ($el.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$tp)) {
      if ($null -ne $tp) {
        $text = ''
        try { $text = $tp.DocumentRange.GetText(-1) } catch { $text = '' }
        if ($text -and $text.Trim().Length -gt 0) {
          if (Add-Node $frameId $relation $reason $text 'text' $depth) { $contributed = $true }
          if ($script:stopped) { return }
        }
      }
    }
  } catch { }

  try {
    $vp = $null
    if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
      if ($null -ne $vp) {
        $value = ''
        try { $value = $vp.Current.Value } catch { $value = '' }
        if ($value -and $value.Trim().Length -gt 0) {
          if (Add-Node $frameId $relation $reason $value 'value' $depth) { $contributed = $true }
          if ($script:stopped) { return }
        }
      }
    }
  } catch { }

  if ($contributed) { $script:counted.matched++ }

  try {
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $child = $walker.GetFirstChild($el)
    while ($null -ne $child) {
      Step $child ($depth + 1) $childFrameId $childFrameRect
      if ($script:stopped) { return }
      $child = $walker.GetNextSibling($child)
    }
  } catch { }
}

Step $root 0 $ClientAreaId $clientRect

# --- 3.4 guard 1, after the walk: the handle must still address the same window.
if (-not [Hikari.ContentReadWindow]::IsWindow($target)) { Fail 'window-gone' }
[uint32]$pidAfter = 0
[void][Hikari.ContentReadWindow]::GetWindowThreadProcessId($target, [ref]$pidAfter)
if ($pidAfter -ne $pidBefore) { Fail 'window-replaced' }

# Emitted in first-seen order, which is the walk's own order and the only ordering this script is
# entitled to.
#
# The name is deliberately not the bare one. At script scope a bare regions variable and the
# script-scoped regions variable are the same variable, so a local of that name would silently replace
# the accumulator this loop is reading -- and PowerShell answers a list indexed by a string key with
# nothing rather than with an error, so the mistake reads as "every region came back empty" rather
# than as a crash. Measured: it did, on the first run against a real window.
$outputRegions = New-Object System.Collections.ArrayList
foreach ($regionKey in $script:order) {
  $entry = $script:regions[$regionKey]
  [void]$outputRegions.Add([ordered]@{
    id = $entry.id
    viewportRelation = $entry.viewportRelation
    notVisibleBecause = $entry.notVisibleBecause
    nodes = $entry.nodes
  })
}

Write-Result ([ordered]@{
  ok = $true
  readAt = $readAt
  regions = $outputRegions
  bounds = $script:counted
})
