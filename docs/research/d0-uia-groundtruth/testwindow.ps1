# HIKARI D0 ground-truth experiment — the controlled test window.
#
# This process OWNS the synthetic content. It exists only so the UIA probe has a subject whose
# ground truth is known exactly. It contains no real content of any kind.
#
# Marker text is unique across the whole experiment, so a marker that appears in a read of
# window X but does not belong to window X is a provable misattribution.
#
# Three independent notions of "visible", deliberately kept separate:
#   1. layout   — this script's own geometry (scroll viewport intersection, WPF visibility, opacity)
#   2. pixels   — PrintWindow capture matched against the exact colour painted per row
#   3. UIA      — IsOffscreen, measured by the probe in a DIFFERENT process
# (1) and (2) are computed without UIA. (3) never is.
#
# Windows PowerShell 5.1. Synthetic content only; never drives a real application.

param(
  [Parameter(Mandatory = $true)][string]$WorkDir,
  [int]$Seconds = 1800,
  [switch]$WithSecondWindow
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase

New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
$truthPath = Join-Path $WorkDir 'truth.json'
$cmdPath   = Join-Path $WorkDir 'cmd.json'
$ackPath   = Join-Path $WorkDir 'ack.json'

function MarkerColor([int]$i) {
  $r = 20 + (($i * 37) % 200); $g = 20 + (($i * 61) % 200); $b = 20 + (($i * 97) % 200)
  [System.Windows.Media.Color]::FromRgb($r, $g, $b)
}

# ---------------------------------------------------------------- skeleton
$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="HIKARI-GT-W1" Width="900" Height="700"
        Background="White" WindowStartupLocation="Manual" Left="60" Top="60">
  <DockPanel>
    <Border DockPanel.Dock="Top" Background="#FF202020" Height="30" Name="HeaderBand">
      <TextBlock Name="HeaderText" Foreground="White" VerticalAlignment="Center" Margin="6,0,0,0"/>
    </Border>
    <StackPanel DockPanel.Dock="Bottom" Orientation="Horizontal" Name="BottomBar">
      <TextBox Name="EditBox" Width="320" Height="26" VerticalContentAlignment="Center"/>
      <Button Name="NameOnlyBtn" Width="200" Height="26" Margin="8,0,0,0"/>
      <Border Name="A11yOnlyBox" Width="20" Height="20" Margin="8,0,0,0" Background="#FF808080"/>
    </StackPanel>
    <TabControl Name="Tabs">
      <TabItem Header="Alpha" Name="TabAlpha">
        <DockPanel>
          <Border DockPanel.Dock="Left" Width="150" Background="#FFEDEDED">
            <ScrollViewer Name="SideScroll" VerticalScrollBarVisibility="Auto">
              <StackPanel Name="SidePanel"/>
            </ScrollViewer>
          </Border>
          <ScrollViewer Name="MainScroll" VerticalScrollBarVisibility="Auto">
            <StackPanel Name="MainPanel"/>
          </ScrollViewer>
        </DockPanel>
      </TabItem>
      <TabItem Header="Bravo" Name="TabBravo">
        <ScrollViewer Name="BravoScroll" VerticalScrollBarVisibility="Auto">
          <StackPanel Name="BravoPanel"/>
        </ScrollViewer>
      </TabItem>
      <TabItem Header="Hidden" Name="TabHidden">
        <StackPanel Name="HiddenPanel">
          <Border Name="CollapsedBox" Height="26"><TextBlock Name="CollapsedText"/></Border>
          <Border Name="HiddenBox" Height="26"><TextBlock Name="HiddenText"/></Border>
          <Border Name="ZeroOpacityBox" Height="26"><TextBlock Name="ZeroOpacityText"/></Border>
          <Border Name="VisibleBox" Height="26"><TextBlock Name="VisibleText"/></Border>
        </StackPanel>
      </TabItem>
    </TabControl>
  </DockPanel>
</Window>
"@

$W = [System.Windows.Markup.XamlReader]::Parse($xaml)
$script:W = $W
$script:Rows = New-Object System.Collections.ArrayList

# $declared: the classification this experiment assigns BEFORE any reading happens.
# $container: the ScrollViewer whose viewport the row must be inside, or $null.
function Add-Row([int]$i, [string]$text, [string]$region, [string]$tab, [string]$declared, $container, $vis) {
  $border = New-Object System.Windows.Controls.Border
  $border.Height = 26
  $border.HorizontalAlignment = 'Stretch'
  $col = MarkerColor $i
  $border.Background = New-Object System.Windows.Media.SolidColorBrush $col
  $tb = New-Object System.Windows.Controls.TextBlock
  $tb.Text = $text
  $tb.Foreground = [System.Windows.Media.Brushes]::Black
  $tb.VerticalAlignment = 'Center'
  $tb.Margin = New-Object System.Windows.Thickness 6, 0, 0, 0
  $border.Child = $tb
  if ($vis) { $border.Visibility = $vis }
  [void]$script:Rows.Add([pscustomobject]@{
    border = $border; text = $tb; markerText = $text; region = $region; tab = $tab
    declared = $declared; container = $container
    rgb = @($col.R, $col.G, $col.B)
  })
  return $border
}

# ---------------------------------------------------------------- header + inputs
$W.FindName('HeaderText').Text = 'GT-HDR-0001'
$hdr = New-Object System.Windows.Controls.Border
$hdr.Background = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(32, 32, 32))
[void]$script:Rows.Add([pscustomobject]@{
  border = $W.FindName('HeaderBand'); text = $W.FindName('HeaderText'); markerText = 'GT-HDR-0001'
  region = 'header'; tab = 'all'; declared = 'visible'; container = $null; rgb = @(32, 32, 32)
})

$script:EditBox = $W.FindName('EditBox')
$script:EditBox.Text = 'GT-EDIT-INITIAL'
$btn = $W.FindName('NameOnlyBtn')
$btn.Content = 'GT-NAMEONLY-BTN'
[System.Windows.Automation.AutomationProperties]::SetName($btn, 'GT-NAMEONLY-A11Y')
[System.Windows.Automation.AutomationProperties]::SetName($W.FindName('A11yOnlyBox'), 'GT-A11YONLY-0001')

# The three input controls are part of the synthetic content too, so they enter the inventory
# rather than landing in "unknown". The text box is the only element in the whole window that
# exposes TextPattern, and the button carries TWO different strings (its Content and its
# accessible Name) with no text child at all.
$script:EditBoxRow = [pscustomobject]@{
  border = $script:EditBox; text = $null; markerText = 'GT-EDIT-INITIAL'
  region = 'inputs'; tab = 'all'; declared = 'editable'; container = $null
  rgb = @(0, 0, 0); dynamic = 'editBox'
}
[void]$script:Rows.Add($script:EditBoxRow)
[void]$script:Rows.Add([pscustomobject]@{
  border = $btn; text = $null; markerText = 'GT-NAMEONLY-A11Y'
  region = 'inputs'; tab = 'all'; declared = 'name-only-control'; container = $null
  rgb = @(0, 0, 0); dynamic = $null
})
[void]$script:Rows.Add([pscustomobject]@{
  border = $W.FindName('A11yOnlyBox'); text = $null; markerText = 'GT-A11YONLY-0001'
  region = 'inputs'; tab = 'all'; declared = 'automation-name-only'; container = $null
  rgb = @(128, 128, 128); dynamic = $null
})

# ---------------------------------------------------------------- fill regions
$mainScroll  = $W.FindName('MainScroll')
$sideScroll  = $W.FindName('SideScroll')
$bravoScroll = $W.FindName('BravoScroll')

$sp = $W.FindName('SidePanel')
for ($i = 1; $i -le 12; $i++) { [void]$sp.Children.Add((Add-Row ($i + 100) ("GT-SIDE-{0:D4}" -f $i) 'side' 'Alpha' 'visible' $sideScroll $null)) }
$mp = $W.FindName('MainPanel')
for ($i = 1; $i -le 60; $i++) { [void]$mp.Children.Add((Add-Row $i ("GT-A-{0:D4}" -f $i) 'main' 'Alpha' 'visible' $mainScroll $null)) }
$bp = $W.FindName('BravoPanel')
for ($i = 1; $i -le 40; $i++) { [void]$bp.Children.Add((Add-Row ($i + 200) ("GT-B-{0:D4}" -f $i) 'bravo' 'Bravo' 'visible' $bravoScroll $null)) }

# Hidden tab: four ways for content to exist while not being shown.
$hp = $W.FindName('HiddenPanel')
$hk = @(
  @('CollapsedBox',   'GT-H-COLLAPSED-0001',   'collapsed',    1400, 'Collapsed'),
  @('HiddenBox',      'GT-H-HIDDEN-0001',      'hidden',       1401, 'Hidden'),
  @('ZeroOpacityBox', 'GT-H-ZEROOPACITY-0001', 'zero-opacity', 1402, $null),
  @('VisibleBox',     'GT-H-VISIBLE-0001',     'visible',      1403, $null)
)
foreach ($k in $hk) {
  $box = $W.FindName($k[0])
  $txt = $W.FindName(($k[0] -replace 'Box$', 'Text'))
  $col = MarkerColor ([int]$k[3])
  $box.Background = New-Object System.Windows.Media.SolidColorBrush $col
  $txt.Text = $k[1]; $txt.Foreground = [System.Windows.Media.Brushes]::Black
  $txt.VerticalAlignment = 'Center'; $txt.Margin = New-Object System.Windows.Thickness 6, 0, 0, 0
  if ($k[4]) { $box.Visibility = $k[4] }
  if ($k[2] -eq 'zero-opacity') { $box.Opacity = 0 }
  [void]$script:Rows.Add([pscustomobject]@{
    border = $box; text = $txt; markerText = $k[1]; region = 'hidden-tab'; tab = 'Hidden'
    declared = $k[2]; container = $null; rgb = @($col.R, $col.G, $col.B)
  })
}

# ---------------------------------------------------------------- optional second window
$script:W2 = $null
if ($WithSecondWindow) {
  $x2 = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        Title="HIKARI-GT-W2" Width="420" Height="260" Background="White"
        WindowStartupLocation="Manual" Left="980" Top="60">
  <StackPanel Name="W2Panel"/>
</Window>
"@
  $script:W2 = [System.Windows.Markup.XamlReader]::Parse($x2)
  $p2 = $script:W2.FindName('W2Panel')
  for ($i = 1; $i -le 5; $i++) {
    $b = New-Object System.Windows.Controls.Border
    $b.Height = 26; $col = MarkerColor ($i + 300)
    $b.Background = New-Object System.Windows.Media.SolidColorBrush $col
    $t = New-Object System.Windows.Controls.TextBlock
    $t.Text = "GT-W2-{0:D4}" -f $i
    $t.Foreground = [System.Windows.Media.Brushes]::Black
    $t.VerticalAlignment = 'Center'; $t.Margin = New-Object System.Windows.Thickness 6, 0, 0, 0
    $b.Child = $t
    [void]$p2.Children.Add($b)
    [void]$script:Rows.Add([pscustomobject]@{
      border = $b; text = $t; markerText = $t.Text; region = 'w2'; tab = 'W2'
      declared = 'other-window'; container = $null; rgb = @($col.R, $col.G, $col.B)
    })
  }
  $script:W2.Show()
}

$W.Show()

# ---------------------------------------------------------------- truth
function Pct($el) {
  try { $p = $el.PointToScreen((New-Object System.Windows.Point 2, 2)); @([int][math]::Round($p.X), [int][math]::Round($p.Y)) }
  catch { $null }
}

# Effective opacity walks the ancestor chain: an Opacity=0 row is laid out and IsVisible=true,
# yet paints nothing.
function EffectiveOpacity($el) {
  $o = 1.0
  $cur = $el
  while ($cur -ne $null) {
    try { $o = $o * [double]$cur.Opacity } catch { }
    try { $cur = [System.Windows.Media.VisualTreeHelper]::GetParent($cur) } catch { $cur = $null }
  }
  [math]::Round($o, 3)
}

function Get-Truth {
  $tabs = $W.FindName('Tabs')
  $sel = $tabs.SelectedIndex
  $out = New-Object System.Collections.ArrayList
  foreach ($r in $script:Rows) {
    $b = $r.border
    $inViewport = $null
    $fullyInside = $null
    if ($r.container) {
      try {
        $rel = $b.TransformToAncestor($r.container).Transform((New-Object System.Windows.Point 0, 0))
        $top = $rel.Y
        $bot = $rel.Y + $b.ActualHeight
        $vh  = $r.container.ViewportHeight
        # "Visible" as a binary is a trap at the viewport edge: a row can be half on screen.
        # Keep the two notions apart instead of collapsing them.
        $inViewport  = ($bot -gt 0) -and ($top -lt $vh)          # any part inside the viewport
        $fullyInside = ($top -ge -0.5) -and ($bot -le ($vh + 0.5))
      } catch { $inViewport = $null; $fullyInside = $null }
    }
    $op = EffectiveOpacity $b
    $tabActive = ($r.tab -eq 'all') -or ($r.tab -eq 'Alpha' -and $sel -eq 0) -or
                 ($r.tab -eq 'Bravo' -and $sel -eq 1) -or ($r.tab -eq 'Hidden' -and $sel -eq 2) -or
                 ($r.tab -eq 'W2')
    $isVisible = $false
    try { $isVisible = [bool]$b.IsVisible } catch { }
    # The experiment's own verdict, kept as two separate claims rather than one boolean.
    # "Visible" is a trap at the viewport edge: a row can be half on screen.
    $shown = $isVisible -and ($op -gt 0) -and $tabActive
    $expect  = $false
    $partial = $false
    if ($shown) {
      if ($r.container -eq $null) { $expect = $true }
      elseif ($fullyInside -eq $true) { $expect = $true }
      elseif ($inViewport -eq $true) { $partial = $true }
    }
    if ($r.region -eq 'w2') { $expect = $false; $partial = $false }   # W2 is never part of a W1 read
    # The text box marker tracks its live content, so an edited value is the new ground truth.
    $txt = $r.markerText
    if ($r.dynamic -eq 'editBox') { $txt = $script:EditBox.Text }
    [void]$out.Add([ordered]@{
      text                = $txt
      region              = $r.region
      tab                 = $r.tab
      declared            = $r.declared
      rgb                 = $r.rgb
      isVisibleWpf        = $isVisible
      effectiveOpacity    = $op
      tabActive           = [bool]$tabActive
      inViewport          = $inViewport
      fullyInsideViewport = $fullyInside
      expectVisible       = [bool]$expect
      expectPartial       = [bool]$partial
      samplePoint         = (Pct $b)
    })
  }
  [ordered]@{
    generatedAtMs = [int64]((Get-Date).ToUniversalTime() - (Get-Date '1970-01-01')).TotalMilliseconds
    w1 = [ordered]@{
      hwnd  = (New-Object System.Windows.Interop.WindowInteropHelper($W)).Handle.ToString()
      title = $W.Title; pid = $PID
    }
    w2 = if ($script:W2) { [ordered]@{ hwnd = (New-Object System.Windows.Interop.WindowInteropHelper($script:W2)).Handle.ToString(); title = $script:W2.Title } } else { $null }
    state = [ordered]@{
      selectedTab = $sel
      tabCount    = $tabs.Items.Count
      mainOffset  = [math]::Round($mainScroll.VerticalOffset, 1)
      mainViewportHeight = [math]::Round($mainScroll.ViewportHeight, 1)
      mainExtentHeight   = [math]::Round($mainScroll.ExtentHeight, 1)
      sideOffset  = [math]::Round($sideScroll.VerticalOffset, 1)
      bravoOffset = [math]::Round($bravoScroll.VerticalOffset, 1)
      editText    = $script:EditBox.Text
      windowState = $W.WindowState.ToString()
    }
    markers = $out
  }
}

function Write-Truth { [System.IO.File]::WriteAllText($truthPath, ((Get-Truth) | ConvertTo-Json -Depth 6)) }

# ---------------------------------------------------------------- command channel
$script:lastCmdId = 0
$poll = New-Object System.Windows.Threading.DispatcherTimer
$poll.Interval = [TimeSpan]::FromMilliseconds(80)
$poll.Add_Tick({
  if (-not (Test-Path $cmdPath)) { return }
  $raw = $null
  try { $raw = [System.IO.File]::ReadAllText($cmdPath) } catch { return }
  if (-not $raw) { return }
  $cmd = $null; try { $cmd = $raw | ConvertFrom-Json } catch { return }
  if (-not $cmd -or -not $cmd.id) { return }
  if ([int]$cmd.id -le $script:lastCmdId) { return }

  $ok = $true; $note = ''
  try {
    switch ($cmd.op) {
      'selectTab' { $W.FindName('Tabs').SelectedIndex = [int]$cmd.index }
      'scroll'    { $W.FindName($(if ($cmd.target -eq 'side') { 'SideScroll' } else { 'MainScroll' })).ScrollToVerticalOffset([double]$cmd.offset) }
      'edit'      { $script:EditBox.Text = [string]$cmd.text }
      'minimize'  { $W.WindowState = 'Minimized' }
      'restore'   { $W.WindowState = 'Normal' }
      'hideW1'    { $W.Hide() }
      'showW1'    { $W.Show() }
      'truth'     {
        # No-op. Its purpose is the Write-Truth that follows every command: a state change is
        # applied to the WPF object model in this tick but is not LAID OUT until the dispatcher
        # goes idle. Reading geometry in the same tick as the change returns pre-change values.
        # Issuing this op after the previous one has settled snapshots the truth that is actually
        # true while the probe runs.
      }
      'block'     {
        # Deliberately stall the UI thread. While this runs the window cannot answer any message,
        # which is what makes it a controlled stand-in for an application that refuses to answer.
        Start-Sleep -Milliseconds ([int]$cmd.ms)
      }
      'quit' {
        Write-Truth
        [System.IO.File]::WriteAllText($ackPath, (@{ id = [int]$cmd.id; ok = $true; op = 'quit' } | ConvertTo-Json))
        $W.Close(); [System.Windows.Threading.Dispatcher]::ExitAll(); return
      }
      default { $ok = $false; $note = "unknown op $($cmd.op)" }
    }
  } catch { $ok = $false; $note = $_.Exception.Message }

  $script:lastCmdId = [int]$cmd.id
  Write-Truth
  [System.IO.File]::WriteAllText($ackPath, ([ordered]@{
    id = [int]$cmd.id; ok = $ok; op = $cmd.op; note = $note
    selectedTab = $W.FindName('Tabs').SelectedIndex
    mainOffset  = [math]::Round($mainScroll.VerticalOffset, 1)
    editText    = $script:EditBox.Text
  } | ConvertTo-Json))
})
$poll.Start()

Write-Truth
[System.IO.File]::WriteAllText((Join-Path $WorkDir 'ready.json'), (@{
  pid = $PID
  w1 = (New-Object System.Windows.Interop.WindowInteropHelper($W)).Handle.ToString()
  w2 = if ($script:W2) { (New-Object System.Windows.Interop.WindowInteropHelper($script:W2)).Handle.ToString() } else { $null }
} | ConvertTo-Json))

$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromSeconds($Seconds)
$timer.Add_Tick({ $W.Close(); [System.Windows.Threading.Dispatcher]::ExitAll() })
$timer.Start()

[System.Windows.Threading.Dispatcher]::Run()
Write-Host 'test window closed'
