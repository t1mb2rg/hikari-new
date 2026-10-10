# HIKARI D0 ground-truth experiment — the foreign focus holder.
#
# A separate process whose ONLY job is to own the global keyboard focus while the probe reads
# the test window. Its marker text (GT-FOCUS-*) appears in no other window, so if a read of the
# test window comes back carrying GT-FOCUS-0001, the misattribution is proven rather than inferred.
#
# Synthetic content only.

param(
  [Parameter(Mandatory = $true)][string]$WorkDir,
  [int]$Seconds = 1800
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase

New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null

$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        Title="HIKARI-GT-FOCUS" Width="420" Height="140" Background="White"
        WindowStartupLocation="Manual" Left="500" Top="820" Topmost="True">
  <StackPanel Margin="10">
    <TextBlock Text="GT-FOCUS-LABEL" Foreground="Black"/>
    <TextBox Name="FocusBox" Height="28" VerticalContentAlignment="Center"/>
  </StackPanel>
</Window>
"@

$w = [System.Windows.Markup.XamlReader]::Parse($xaml)
$box = $w.FindName('FocusBox')
$box.Text = 'GT-FOCUS-0001'
$w.Show()

Add-Type -Namespace F -Name W -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h);
[DllImport("user32.dll")] public static extern System.IntPtr SetFocus(System.IntPtr h);
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
'@

$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(500)
$timer.Add_Tick({
  try {
    $h = (New-Object System.Windows.Interop.WindowInteropHelper($w)).Handle
    [void][F.W]::SetForegroundWindow($h)
    [void]$box.Focus()
    [System.Windows.Input.Keyboard]::Focus($box)
    $fg = [F.W]::GetForegroundWindow()
    [System.IO.File]::WriteAllText((Join-Path $WorkDir 'focus.json'), (@{
      pid = $PID
      hwnd = $h.ToString()
      foregroundHwnd = $fg.ToString()
      isForeground = ($fg -eq $h)
      marker = 'GT-FOCUS-0001'
      atMs = [int64]((Get-Date).ToUniversalTime() - (Get-Date '1970-01-01')).TotalMilliseconds
    } | ConvertTo-Json))
  } catch { }
})
$timer.Start()

$stop = New-Object System.Windows.Threading.DispatcherTimer
$stop.Interval = [TimeSpan]::FromSeconds($Seconds)
$stop.Add_Tick({ $w.Close(); [System.Windows.Threading.Dispatcher]::ExitAll() })
$stop.Start()

[System.Windows.Threading.Dispatcher]::Run()
